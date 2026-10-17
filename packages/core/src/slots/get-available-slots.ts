import { mergeSpans, overlapsAny, type Span } from '../intervals.js';
import { Temporal } from '../temporal.js';
import { isValidTimeZone } from '../timezone.js';
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

/** How many days back continuous availability keeps its grid anchor (ADR-0003). */
export const GRID_LOOKBACK_DAYS = 1;

const MIDNIGHT = new Temporal.PlainTime();
const MINUTE_MS = 60_000;
const MAX_DURATION_MINUTES = 24 * 60;

/**
 * Available slots for one event type, as UTC instants sorted ascending. Pure function.
 *
 * - Working hours for each owner-local date (an override replaces that date's weekly hours)
 *   become exact time in the schedule's zone. Times inside a DST gap move forward
 *   ('compatible'), and an end of 00:00 means the start of the next day. Touching hours
 *   merge into continuous availability, so a slot can span midnight.
 * - Grid (ADR-0003): slots on owner-local day D start every `slotIntervalMinutes` (default:
 *   the duration) from an anchor, and must fit inside continuous availability. The anchor is
 *   where that continuous availability began, if it began at or after owner-local midnight
 *   `GRID_LOOKBACK_DAYS` days before D; otherwise (e.g. around-the-clock availability) it is
 *   owner-local midnight of D itself. The anchor depends only on the schedule, never on the
 *   requested range, so any range returns the same slots where ranges overlap.
 * - A slot is kept when it starts inside the range and at or after now + minimum notice, when
 *   the slot widened by its buffers overlaps no busy interval (buffers may fall outside working
 *   hours), and when its owner-local day has fewer than `dailyLimit` event type bookings.
 *
 * Works in whole milliseconds; sub-millisecond parts of instants are ignored.
 *
 * @throws RangeError when the query is invalid or its range is longer than `maxRangeDays`.
 */
export function getAvailableSlots(query: SlotQuery, options: SlotEngineOptions = {}): Slot[] {
  validate(query, options.maxRangeDays ?? MAX_SLOT_RANGE_DAYS);

  const { schedule, eventType, range, now } = query;
  const { timeZone } = schedule;
  const duration = eventType.durationMinutes * MINUTE_MS;
  const step = (eventType.slotIntervalMinutes ?? eventType.durationMinutes) * MINUTE_MS;
  const bufferBefore = eventType.bufferBeforeMinutes * MINUTE_MS;
  const bufferAfter = eventType.bufferAfterMinutes * MINUTE_MS;
  const rangeEnd = range.end.epochMilliseconds;
  const notBefore = Math.max(
    range.start.epochMilliseconds,
    now.epochMilliseconds + eventType.minimumNoticeMinutes * MINUTE_MS,
  );
  const busy = mergeSpans(query.busy.map(toSpan));
  const fullDays = daysAtLimit(query.eventTypeBookings, timeZone, eventType.dailyLimit);

  const firstDay = ownerDate(range.start, timeZone);
  const lastDay = ownerDate(range.end, timeZone);
  // Back far enough to tell whether availability began before the lookback midnight of the
  // first day; forward far enough for a slot of up to 24 hours starting on the last day.
  const blocks = availability(
    query,
    firstDay.subtract({ days: GRID_LOOKBACK_DAYS + 1 }),
    lastDay.add({ days: 2 }),
  );

  const slots: Span[] = [];
  for (
    let day = firstDay;
    Temporal.PlainDate.compare(day, lastDay) <= 0;
    day = day.add({ days: 1 })
  ) {
    if (fullDays.has(day.toString())) continue;
    const dayStart = startOfDay(day, timeZone);
    const dayEnd = startOfDay(day.add({ days: 1 }), timeZone);
    const lookbackStart = startOfDay(day.subtract({ days: GRID_LOOKBACK_DAYS }), timeZone);

    for (const block of blocks) {
      if (block.start >= dayEnd) break;
      if (block.end <= dayStart) continue;
      const anchor = block.start >= lookbackStart ? block.start : dayStart;
      // First grid point at or after the day, the block and the earliest allowed start.
      const from = Math.max(dayStart, block.start, notBefore);
      const first = anchor + Math.ceil((from - anchor) / step) * step;
      for (
        let start = first;
        start < dayEnd && start < rangeEnd && start + duration <= block.end;
        start += step
      ) {
        const padded = { start: start - bufferBefore, end: start + duration + bufferAfter };
        if (!overlapsAny(busy, padded)) slots.push({ start, end: start + duration });
      }
    }
  }
  return slots.map(({ start, end }) => ({
    start: Temporal.Instant.fromEpochMilliseconds(start),
    end: Temporal.Instant.fromEpochMilliseconds(end),
  }));
}

/** Continuous availability from `first` to `last` (owner-local dates), in epoch ms. */
function availability(
  { schedule, overrides }: SlotQuery,
  first: Temporal.PlainDate,
  last: Temporal.PlainDate,
): Span[] {
  const { timeZone, weekly } = schedule;
  const overrideRanges = new Map(overrides.map((o) => [o.date.toString(), o.ranges]));
  const blocks: Span[] = [];
  for (
    let date = first;
    Temporal.PlainDate.compare(date, last) <= 0;
    date = date.add({ days: 1 })
  ) {
    const ranges = overrideRanges.get(date.toString()) ?? weekly[date.dayOfWeek as Weekday] ?? [];
    for (const timeRange of ranges) {
      const block = workingHours(date, timeRange, timeZone);
      // Both ends can land on the same instant when a range lies entirely in a DST gap.
      if (block.start < block.end) blocks.push(block);
    }
  }
  return mergeSpans(blocks);
}

function workingHours(date: Temporal.PlainDate, { start, end }: TimeRange, timeZone: string): Span {
  return {
    start: date.toZonedDateTime({ timeZone, plainTime: start }).epochMilliseconds,
    end: end.equals(MIDNIGHT)
      ? startOfDay(date.add({ days: 1 }), timeZone)
      : date.toZonedDateTime({ timeZone, plainTime: end }).epochMilliseconds,
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
    const day = ownerDate(booking.start, timeZone).toString();
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count >= dailyLimit).map(([day]) => day));
}

function startOfDay(date: Temporal.PlainDate, timeZone: string): number {
  return date.toZonedDateTime(timeZone).epochMilliseconds;
}

function ownerDate(instant: Temporal.Instant, timeZone: string): Temporal.PlainDate {
  return instant.toZonedDateTimeISO(timeZone).toPlainDate();
}

function toSpan({ start, end }: Interval): Span {
  return { start: start.epochMilliseconds, end: end.epochMilliseconds };
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
  if (Temporal.Instant.compare(range.end, range.start.add({ hours: 24 * maxRangeDays })) > 0) {
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
  if (rules.durationMinutes > MAX_DURATION_MINUTES) {
    throw new RangeError(`durationMinutes must be at most ${MAX_DURATION_MINUTES}`);
  }
  requireInteger('bufferBeforeMinutes', rules.bufferBeforeMinutes, 0);
  requireInteger('bufferAfterMinutes', rules.bufferAfterMinutes, 0);
  requireInteger('minimumNoticeMinutes', rules.minimumNoticeMinutes, 0);
  if (rules.dailyLimit !== null) requireInteger('dailyLimit', rules.dailyLimit, 1);
  if (rules.slotIntervalMinutes !== undefined) {
    requireInteger('slotIntervalMinutes', rules.slotIntervalMinutes, 1);
  }
}

function validateInterval({ start, end }: Interval, label: string): void {
  if (Temporal.Instant.compare(end, start) <= 0) {
    throw new RangeError(`${label}: end must be after start`);
  }
}

function requireInteger(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer >= ${min}, got ${value}`);
  }
}
