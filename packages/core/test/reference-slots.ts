import { GRID_LOOKBACK_DAYS } from '../src/slots/get-available-slots.js';
import type { Slot, SlotQuery, Weekday } from '../src/slots/types.js';
import { Temporal } from '../src/temporal.js';

const MINUTE = 60_000;
const MIDNIGHT = new Temporal.PlainTime();

/**
 * Reference implementation of `getAvailableSlots`, for tests only. Deliberately naive: it
 * walks the owner's time minute by minute and checks every rule directly, with no merging,
 * binary search or skipping ahead. Slow, but each step can be checked by reading it.
 *
 * Only valid for minute-aligned input (every time and instant on a whole minute), which the
 * property-test generators guarantee. It does not validate input.
 */
export function referenceSlots(query: SlotQuery): Slot[] {
  const { schedule, overrides, eventType, busy, eventTypeBookings, range, now } = query;
  const { timeZone, weekly } = schedule;

  const ownerDate = (epochMs: number) =>
    Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone).toPlainDate();
  const startOfDay = (date: Temporal.PlainDate) => date.toZonedDateTime(timeZone).epochMilliseconds;
  const wallClock = (date: Temporal.PlainDate, time: Temporal.PlainTime) =>
    date.toZonedDateTime({ timeZone, plainTime: time }).epochMilliseconds;

  // 1. Every working-hour range of every date around the range, in exact time.
  //    An override replaces the weekly hours of its date; an end of 00:00 is the next midnight.
  const firstDate = ownerDate(range.start.epochMilliseconds).subtract({
    days: GRID_LOOKBACK_DAYS + 1,
  });
  const lastDate = ownerDate(range.end.epochMilliseconds).add({ days: 2 });
  const workingHours: Array<{ start: number; end: number }> = [];
  for (
    let date = firstDate;
    Temporal.PlainDate.compare(date, lastDate) <= 0;
    date = date.add({ days: 1 })
  ) {
    const override = overrides.find((o) => o.date.equals(date));
    const ranges = override ? override.ranges : (weekly[date.dayOfWeek as Weekday] ?? []);
    for (const { start, end } of ranges) {
      workingHours.push({
        start: wallClock(date, start),
        end: end.equals(MIDNIGHT) ? startOfDay(date.add({ days: 1 })) : wallClock(date, end),
      });
    }
  }

  // 2. Minute by minute: is the owner available, and since when without interruption?
  const windowStart = startOfDay(firstDate);
  const windowEnd = startOfDay(lastDate.add({ days: 1 }));
  const available = new Map<number, boolean>();
  const availableSince = new Map<number, number>();
  for (let minute = windowStart; minute < windowEnd; minute += MINUTE) {
    const isAvailable = workingHours.some((h) => h.start <= minute && minute < h.end);
    available.set(minute, isAvailable);
    if (isAvailable) {
      const previous = available.get(minute - MINUTE) === true;
      availableSince.set(minute, previous ? availableSince.get(minute - MINUTE)! : minute);
    }
  }

  // 3. Every minute in the range is a candidate start; keep the ones every rule accepts.
  const duration = eventType.durationMinutes * MINUTE;
  const step = (eventType.slotIntervalMinutes ?? eventType.durationMinutes) * MINUTE;
  const earliestStart = now.epochMilliseconds + eventType.minimumNoticeMinutes * MINUTE;
  const slots: Slot[] = [];
  for (
    let start = range.start.epochMilliseconds;
    start < range.end.epochMilliseconds;
    start += MINUTE
  ) {
    const end = start + duration;

    // The whole slot is available.
    let fits = true;
    for (let minute = start; minute < end; minute += MINUTE) {
      if (available.get(minute) !== true) fits = false;
    }
    if (!fits) continue;

    // It is on the grid: whole steps from where its continuous availability began, unless
    // that was before midnight GRID_LOOKBACK_DAYS before the slot's day; then from the
    // slot's own midnight.
    const day = ownerDate(start);
    const since = availableSince.get(start)!;
    const anchor =
      since >= startOfDay(day.subtract({ days: GRID_LOOKBACK_DAYS })) ? since : startOfDay(day);
    if ((start - anchor) % step !== 0) continue;

    // Minimum notice.
    if (start < earliestStart) continue;

    // The slot plus its buffers overlaps no busy interval.
    const paddedStart = start - eventType.bufferBeforeMinutes * MINUTE;
    const paddedEnd = end + eventType.bufferAfterMinutes * MINUTE;
    const clashes = busy.some(
      (b) => b.start.epochMilliseconds < paddedEnd && paddedStart < b.end.epochMilliseconds,
    );
    if (clashes) continue;

    // The owner-local day has not reached the daily limit.
    if (eventType.dailyLimit !== null) {
      const bookedThatDay = eventTypeBookings.filter((b) =>
        ownerDate(b.start.epochMilliseconds).equals(day),
      ).length;
      if (bookedThatDay >= eventType.dailyLimit) continue;
    }

    slots.push({
      start: Temporal.Instant.fromEpochMilliseconds(start),
      end: Temporal.Instant.fromEpochMilliseconds(end),
    });
  }
  return slots;
}
