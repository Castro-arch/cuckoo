import type { Temporal } from '../temporal.js';

/** ISO weekday, as Temporal's `dayOfWeek`: 1 = Monday ... 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Wall-clock range in the schedule's time zone, end exclusive.
 * `end` must be after `start`, except `end` = 00:00, which means midnight at the end of the day.
 */
export interface TimeRange {
  start: Temporal.PlainTime;
  end: Temporal.PlainTime;
}

export interface WeeklySchedule {
  /** IANA time zone name, e.g. `Europe/Berlin`. */
  timeZone: string;
  /** Wall-clock ranges per weekday; a missing weekday is unavailable. */
  weekly: Partial<Record<Weekday, readonly TimeRange[]>>;
}

/** Replaces the weekly hours for one date in the schedule's time zone. `ranges: []` blocks the day. */
export interface DateOverride {
  date: Temporal.PlainDate;
  ranges: readonly TimeRange[];
}

export interface EventTypeRules {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  /** Max bookings of this event type per owner-local day; `null` = unlimited. */
  dailyLimit: number | null;
  /** Step between slot starts; defaults to `durationMinutes`. */
  slotIntervalMinutes?: number;
}

/** Half-open `[start, end)` in exact time. */
export interface Interval {
  start: Temporal.Instant;
  end: Temporal.Instant;
}

export interface SlotQuery {
  schedule: WeeklySchedule;
  overrides: readonly DateOverride[];
  eventType: EventTypeRules;
  /**
   * Everything that blocks time: the owner's bookings and external calendar events.
   * Callers expand each existing booking by its own event type's buffers; the engine only
   * applies the buffers of the event type being booked.
   */
  busy: readonly Interval[];
  /** Existing bookings of this event type, counted toward `dailyLimit` only. */
  eventTypeBookings: readonly Interval[];
  /** Slots whose start falls in `[range.start, range.end)`. */
  range: Interval;
  now: Temporal.Instant;
}

export type Slot = Interval;

export interface SlotEngineOptions {
  /** Longest accepted `range`, in days of exact time. Defaults to `MAX_SLOT_RANGE_DAYS`. */
  maxRangeDays?: number;
}
