import { Temporal } from '../temporal.js';
import { isValidTimeZone } from '../timezone.js';
import { mergeIntervals, overlapsAny } from './intervals.js';
import type {
  EventTypeRules,
  Interval,
  Slot,
  SlotEngineOptions,
  SlotQuery,
  TimeRange,
  Weekday,
} from './types.js';

/** Longest range a single query may cover, so a public request cannot cause unbounded work. */
export const MAX_SLOT_RANGE_DAYS = 62;

const MIDNIGHT = new Temporal.PlainTime();
const compare = Temporal.Instant.compare;

/**
 * Available slots for one event type, as UTC instants sorted ascending. Pure function.
 *
 * - Working hours for each owner-local date (an override replaces that date's weekly hours)
 *   become exact time in the schedule's zone. Times inside a DST gap move forward
 *   ('compatible'), and an end of 00:00 means the start of the next day. Touching hours
 *   merge, so a slot can span midnight.
 * - Slots step from the start of each merged block by `slotIntervalMinutes` (default: the
 *   duration) and must fit inside the block. Blocks are built from one day before the range,
 *   so hours running past midnight keep the same grid whichever day is asked for.
 * - A slot is kept when it starts inside the range and at or after now + minimum notice, when
 *   the slot widened by its buffers overlaps no busy interval (buffers may fall outside working
 *   hours), and when its owner-local day has fewer than `dailyLimit` event type bookings.
 *
 * @throws RangeError when the query is invalid or its range is longer than `maxRangeDays`.
 */
export function getAvailableSlots(query: SlotQuery, options: SlotEngineOptions = {}): Slot[] {
  validate(query, options.maxRangeDays ?? MAX_SLOT_RANGE_DAYS);

  const { schedule, eventType, range, now } = query;
  const { timeZone } = schedule;
  const step = eventType.slotIntervalMinutes ?? eventType.durationMinutes;
  const noticeEnd = now.add({ minutes: eventType.minimumNoticeMinutes });
  const notBefore = compare(noticeEnd, range.start) > 0 ? noticeEnd : range.start;
  const busy = mergeIntervals(query.busy);
  const fullDays = daysAtLimit(query.eventTypeBookings, timeZone, eventType.dailyLimit);

  const slots: Slot[] = [];
  for (const block of availability(query)) {
    for (let start = block.start; ; start = start.add({ minutes: step })) {
      const end = start.add({ minutes: eventType.durationMinutes });
      if (compare(end, block.end) > 0 || compare(start, range.end) >= 0) break;
      if (compare(start, notBefore) < 0) continue;
      const padded = {
        start: start.subtract({ minutes: eventType.bufferBeforeMinutes }),
        end: end.add({ minutes: eventType.bufferAfterMinutes }),
      };
      if (overlapsAny(busy, padded)) continue;
      if (fullDays.size > 0 && fullDays.has(ownerDate(start, timeZone))) continue;
      slots.push({ start, end });
    }
  }
  return slots;
}

/** Merged working-hour blocks around the range, in exact time. */
function availability({ schedule, overrides, range }: SlotQuery): Interval[] {
  const { timeZone, weekly } = schedule;
  const overrideRanges = new Map(overrides.map((o) => [o.date.toString(), o.ranges]));
  // One day before: blocks continuing past midnight keep their grid. One day after: a slot
  // starting just before the range ends can finish the next day.
  const first = range.start.toZonedDateTimeISO(timeZone).toPlainDate().subtract({ days: 1 });
  const last = range.end.toZonedDateTimeISO(timeZone).toPlainDate().add({ days: 1 });

  const blocks: Interval[] = [];
  for (
    let date = first;
    Temporal.PlainDate.compare(date, last) <= 0;
    date = date.add({ days: 1 })
  ) {
    const ranges = overrideRanges.get(date.toString()) ?? weekly[date.dayOfWeek as Weekday] ?? [];
    for (const timeRange of ranges) {
      const block = toInterval(date, timeRange, timeZone);
      // Both ends can land on the same instant when a range lies entirely in a DST gap.
      if (compare(block.start, block.end) < 0) blocks.push(block);
    }
  }
  return mergeIntervals(blocks);
}

function toInterval(
  date: Temporal.PlainDate,
  { start, end }: TimeRange,
  timeZone: string,
): Interval {
  return {
    start: date.toZonedDateTime({ timeZone, plainTime: start }).toInstant(),
    end: end.equals(MIDNIGHT)
      ? date.add({ days: 1 }).toZonedDateTime(timeZone).toInstant()
      : date.toZonedDateTime({ timeZone, plainTime: end }).toInstant(),
  };
}

/** Owner-local dates (`YYYY-MM-DD`) that already have `dailyLimit` bookings. */
function daysAtLimit(
  bookings: readonly Interval[],
  timeZone: string,
  dailyLimit: number | null,
): Set<string> {
  if (dailyLimit === null) return new Set();
  const counts = new Map<string, number>();
  for (const booking of bookings) {
    const day = ownerDate(booking.start, timeZone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count >= dailyLimit).map(([day]) => day));
}

function ownerDate(instant: Temporal.Instant, timeZone: string): string {
  return instant.toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

function validate(query: SlotQuery, maxRangeDays: number): void {
  const { schedule, overrides, eventType, busy, eventTypeBookings, range } = query;

  if (!isValidTimeZone(schedule.timeZone)) {
    throw new RangeError(`Unknown IANA time zone: "${schedule.timeZone}"`);
  }
  for (const [weekday, ranges] of Object.entries(schedule.weekly)) {
    if (!/^[1-7]$/.test(weekday)) throw new RangeError(`Invalid weekday ${weekday}; use 1-7`);
    ranges?.forEach((timeRange, i) => validateTimeRange(timeRange, `weekly[${weekday}][${i}]`));
  }

  const overrideDates = new Set<string>();
  for (const override of overrides) {
    const date = override.date.toString();
    if (overrideDates.has(date)) throw new RangeError(`More than one override for ${date}`);
    overrideDates.add(date);
    override.ranges.forEach((timeRange, i) =>
      validateTimeRange(timeRange, `override ${date}[${i}]`),
    );
  }

  validateEventType(eventType);

  validateInterval(range, 'range');
  requireInteger('maxRangeDays', maxRangeDays, 1);
  if (compare(range.end, range.start.add({ hours: 24 * maxRangeDays })) > 0) {
    throw new RangeError(`range must not be longer than ${maxRangeDays} days`);
  }
  busy.forEach((interval, i) => validateInterval(interval, `busy[${i}]`));
  eventTypeBookings.forEach((interval, i) => validateInterval(interval, `eventTypeBookings[${i}]`));
}

function validateTimeRange({ start, end }: TimeRange, label: string): void {
  if (!end.equals(MIDNIGHT) && Temporal.PlainTime.compare(end, start) <= 0) {
    throw new RangeError(
      `${label}: end ${end} must be after start ${start} (or 00:00 for midnight)`,
    );
  }
}

function validateEventType(rules: EventTypeRules): void {
  requireInteger('durationMinutes', rules.durationMinutes, 1);
  requireInteger('bufferBeforeMinutes', rules.bufferBeforeMinutes, 0);
  requireInteger('bufferAfterMinutes', rules.bufferAfterMinutes, 0);
  requireInteger('minimumNoticeMinutes', rules.minimumNoticeMinutes, 0);
  if (rules.dailyLimit !== null) requireInteger('dailyLimit', rules.dailyLimit, 1);
  if (rules.slotIntervalMinutes !== undefined) {
    requireInteger('slotIntervalMinutes', rules.slotIntervalMinutes, 1);
  }
}

function validateInterval({ start, end }: Interval, label: string): void {
  if (compare(end, start) <= 0) throw new RangeError(`${label}: end must be after start`);
}

function requireInteger(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer >= ${min}, got ${value}`);
  }
}
