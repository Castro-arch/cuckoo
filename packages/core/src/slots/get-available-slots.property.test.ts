import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Temporal } from '../temporal.js';
import { referenceSlots } from '../../test/reference-slots.js';
import { getAvailableSlots } from './get-available-slots.js';
import type {
  DateOverride,
  EventTypeRules,
  Interval,
  Slot,
  SlotQuery,
  TimeRange,
  Weekday,
} from './types.js';

// Zones with DST gaps/overlaps (including a 30-minute shift and a midnight one) and odd offsets.
const ZONES = [
  'UTC',
  'Europe/Berlin',
  'America/Sao_Paulo',
  'America/New_York',
  'Australia/Lord_Howe',
  'Asia/Kathmandu',
] as const;

// Start dates a few days before DST transitions in those zones, plus a quiet one.
const ANCHORS = [
  '2026-03-26',
  '2026-10-22',
  '2018-11-01',
  '2018-02-14',
  '2026-04-02',
  '2026-06-15',
];

const MINUTES_PER_DAY = 24 * 60;
const MIDNIGHT = Temporal.PlainTime.from('00:00');

function plainTime(minutes: number): Temporal.PlainTime {
  return minutes >= MINUTES_PER_DAY
    ? MIDNIGHT
    : Temporal.PlainTime.from({ hour: Math.floor(minutes / 60), minute: minutes % 60 });
}

const partOfDayArb: fc.Arbitrary<TimeRange> = fc
  .tuple(fc.integer({ min: 0, max: 95 }), fc.integer({ min: 1, max: 48 }))
  .map(([startQuarter, lengthQuarters]) => {
    const start = startQuarter * 15;
    return {
      start: plainTime(start),
      end: plainTime(Math.min(start + lengthQuarters * 15, MINUTES_PER_DAY)),
    };
  });

// Whole days chain into around-the-clock availability, which exercises the grid anchoring.
const timeRangeArb: fc.Arbitrary<TimeRange> = fc.oneof(
  { arbitrary: partOfDayArb, weight: 4 },
  { arbitrary: fc.constant({ start: MIDNIGHT, end: MIDNIGHT }), weight: 1 },
);

const rangesArb = fc.array(timeRangeArb, { maxLength: 3 });

const randomWeeklyArb = fc
  .array(fc.option(rangesArb, { nil: undefined }), { minLength: 7, maxLength: 7 })
  .map((perDay) => {
    const weekly: Partial<Record<Weekday, readonly TimeRange[]>> = {};
    perDay.forEach((ranges, index) => {
      if (ranges) weekly[(index + 1) as Weekday] = ranges;
    });
    return weekly;
  });

// Around the clock every day: availability that never starts, where grid anchoring matters most.
const aroundTheClock = [{ start: MIDNIGHT, end: MIDNIGHT }];
const aroundTheClockWeekly: Partial<Record<Weekday, readonly TimeRange[]>> = {
  1: aroundTheClock,
  2: aroundTheClock,
  3: aroundTheClock,
  4: aroundTheClock,
  5: aroundTheClock,
  6: aroundTheClock,
  7: aroundTheClock,
};

const weeklyArb = fc.oneof(
  { arbitrary: randomWeeklyArb, weight: 3 },
  { arbitrary: fc.constant(aroundTheClockWeekly), weight: 1 },
);

const eventTypeArb: fc.Arbitrary<EventTypeRules> = fc
  .record({
    // 45 and 50 do not divide a day, so a wrongly anchored grid shows up.
    durationMinutes: fc.constantFrom(15, 30, 45, 50, 60, 90),
    bufferBeforeMinutes: fc.integer({ min: 0, max: 12 }).map((n) => n * 5),
    bufferAfterMinutes: fc.integer({ min: 0, max: 12 }).map((n) => n * 5),
    minimumNoticeMinutes: fc.integer({ min: 0, max: 48 }).map((n) => n * 30),
    dailyLimit: fc.option(fc.integer({ min: 1, max: 3 }), { nil: null }),
    slotIntervalMinutes: fc.option(fc.constantFrom(15, 30, 45, 50, 60), { nil: undefined }),
  })
  .map(({ slotIntervalMinutes, ...rules }) =>
    slotIntervalMinutes === undefined ? rules : { ...rules, slotIntervalMinutes },
  );

const intervalSpecArb = fc.record({
  offsetMinutes: fc.integer({ min: -24 * 60, max: 11 * 24 * 60 }),
  lengthMinutes: fc.integer({ min: 15, max: 600 }),
});
type IntervalSpec = { offsetMinutes: number; lengthMinutes: number };

function makeQueryArb(maxRangeHours: number): fc.Arbitrary<SlotQuery> {
  return fc
    .record({
      timeZone: fc.constantFrom(...ZONES),
      anchor: fc.constantFrom(...ANCHORS),
      startOffsetHours: fc.integer({ min: 0, max: 72 }),
      lengthHours: fc.integer({ min: 1, max: maxRangeHours }),
      weekly: weeklyArb,
      overrides: fc.uniqueArray(
        fc.record({ dayOffset: fc.integer({ min: -1, max: 12 }), ranges: rangesArb }),
        { selector: (override) => override.dayOffset, maxLength: 4 },
      ),
      eventType: eventTypeArb,
      busy: fc.array(intervalSpecArb, { maxLength: 8 }),
      bookings: fc.array(intervalSpecArb, { maxLength: 6 }),
      nowOffsetMinutes: fc.integer({ min: -3 * 24 * 60, max: 3 * 24 * 60 }),
    })
    .map((spec) => {
      const anchor = Temporal.PlainDate.from(spec.anchor);
      const rangeStart = anchor
        .toZonedDateTime(spec.timeZone)
        .toInstant()
        .add({ hours: spec.startOffsetHours });
      const toInterval = ({ offsetMinutes, lengthMinutes }: IntervalSpec): Interval => {
        const start = rangeStart.add({ minutes: offsetMinutes });
        return { start, end: start.add({ minutes: lengthMinutes }) };
      };
      const overrides: DateOverride[] = spec.overrides.map(({ dayOffset, ranges }) => ({
        date: anchor.add({ days: dayOffset }),
        ranges,
      }));

      return {
        schedule: { timeZone: spec.timeZone, weekly: spec.weekly },
        overrides,
        eventType: spec.eventType,
        busy: spec.busy.map(toInterval),
        eventTypeBookings: spec.bookings.map(toInterval),
        range: { start: rangeStart, end: rangeStart.add({ hours: spec.lengthHours }) },
        now: rangeStart.add({ minutes: spec.nowOffsetMinutes }),
      };
    });
}

const queryArb = makeQueryArb(10 * 24);
// The minute-by-minute oracle is slow, so it gets short ranges.
const smallQueryArb = makeQueryArb(36);

const ms = (instant: Temporal.Instant) => instant.epochMilliseconds;

function overlaps(a: Interval, b: Interval): boolean {
  return ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
}

function ownerDate(instant: Temporal.Instant, timeZone: string): string {
  return instant.toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/**
 * Independent oracle: each date's effective ranges as [startMs, endMs), not merged.
 * Mirrors the documented conversion rules ('compatible' disambiguation, 00:00 end = next day).
 */
function availabilityMs(query: SlotQuery): Array<[number, number]> {
  const { timeZone, weekly } = query.schedule;
  const first = query.range.start.toZonedDateTimeISO(timeZone).toPlainDate().subtract({ days: 2 });
  const last = query.range.end.toZonedDateTimeISO(timeZone).toPlainDate().add({ days: 2 });
  const result: Array<[number, number]> = [];
  for (
    let date = first;
    Temporal.PlainDate.compare(date, last) <= 0;
    date = date.add({ days: 1 })
  ) {
    const override = query.overrides.find((o) => o.date.equals(date));
    const ranges = override ? override.ranges : (weekly[date.dayOfWeek as Weekday] ?? []);
    for (const { start, end } of ranges) {
      const startMs = date.toZonedDateTime({ timeZone, plainTime: start }).epochMilliseconds;
      const endMs = end.equals(MIDNIGHT)
        ? date.add({ days: 1 }).toZonedDateTime(timeZone).epochMilliseconds
        : date.toZonedDateTime({ timeZone, plainTime: end }).epochMilliseconds;
      if (endMs > startMs) result.push([startMs, endMs]);
    }
  }
  return result;
}

const RUNS = { numRuns: 150 };

describe('getAvailableSlots properties', () => {
  it('never returns a slot whose buffers overlap a busy interval', () => {
    fc.assert(
      fc.property(queryArb, (query) => {
        const { bufferBeforeMinutes, bufferAfterMinutes } = query.eventType;
        for (const slot of getAvailableSlots(query)) {
          const padded = {
            start: slot.start.subtract({ minutes: bufferBeforeMinutes }),
            end: slot.end.add({ minutes: bufferAfterMinutes }),
          };
          expect(query.busy.some((busy) => overlaps(padded, busy))).toBe(false);
        }
      }),
      RUNS,
    );
  });

  it('returns only slots that lie fully inside availability', () => {
    fc.assert(
      fc.property(queryArb, (query) => {
        const available = availabilityMs(query);
        const isAvailable = (t: number) => available.some(([start, end]) => start <= t && t < end);
        for (const slot of getAvailableSlots(query)) {
          expect(ms(slot.end) - ms(slot.start)).toBe(query.eventType.durationMinutes * 60_000);
          for (let t = ms(slot.start); t < ms(slot.end); t += 60_000) {
            expect(isAvailable(t)).toBe(true);
          }
        }
      }),
      RUNS,
    );
  });

  it('returns slots sorted ascending without duplicates', () => {
    fc.assert(
      fc.property(queryArb, (query) => {
        const starts = getAvailableSlots(query).map((slot) => ms(slot.start));
        for (let i = 1; i < starts.length; i++) {
          expect(starts[i]).toBeGreaterThan(starts[i - 1]!);
        }
      }),
      RUNS,
    );
  });

  it('starts every slot inside the range and at or after now + minimum notice', () => {
    fc.assert(
      fc.property(queryArb, (query) => {
        const earliest = ms(query.now.add({ minutes: query.eventType.minimumNoticeMinutes }));
        for (const slot of getAvailableSlots(query)) {
          expect(ms(slot.start)).toBeGreaterThanOrEqual(earliest);
          expect(ms(slot.start)).toBeGreaterThanOrEqual(ms(query.range.start));
          expect(ms(slot.start)).toBeLessThan(ms(query.range.end));
        }
      }),
      RUNS,
    );
  });

  it('offers no slot on an owner-local day that already reached the daily limit', () => {
    fc.assert(
      fc.property(queryArb, (query) => {
        const { dailyLimit } = query.eventType;
        if (dailyLimit === null) return;
        const { timeZone } = query.schedule;
        const booked = new Map<string, number>();
        for (const booking of query.eventTypeBookings) {
          const day = ownerDate(booking.start, timeZone);
          booked.set(day, (booked.get(day) ?? 0) + 1);
        }
        for (const slot of getAvailableSlots(query)) {
          expect(booked.get(ownerDate(slot.start, timeZone)) ?? 0).toBeLessThan(dailyLimit);
        }
      }),
      RUNS,
    );
  });

  it('returns exactly the slots of the naive minute-by-minute reference', () => {
    fc.assert(
      fc.property(smallQueryArb, (query) => {
        expect(asMs(getAvailableSlots(query))).toEqual(asMs(referenceSlots(query)));
      }),
      { numRuns: 100 },
    );
  });

  it('returns the same slots in the intersection of two overlapping ranges', () => {
    const extensionHours = fc.integer({ min: 0, max: 4 * 24 });
    fc.assert(
      fc.property(
        queryArb,
        fc.tuple(extensionHours, extensionHours, extensionHours, extensionHours),
        (query, [before1, after1, before2, after2]) => {
          // Both ranges contain query.range; their intersection is at least that.
          const rangeA = {
            start: query.range.start.subtract({ hours: before1 }),
            end: query.range.end.add({ hours: after1 }),
          };
          const rangeB = {
            start: query.range.start.subtract({ hours: before2 }),
            end: query.range.end.add({ hours: after2 }),
          };
          const from = Math.max(ms(rangeA.start), ms(rangeB.start));
          const to = Math.min(ms(rangeA.end), ms(rangeB.end));
          const inIntersection = (slots: Slot[]) =>
            asMs(slots).filter(([start]) => from <= start && start < to);

          expect(inIntersection(getAvailableSlots({ ...query, range: rangeA }))).toEqual(
            inIntersection(getAvailableSlots({ ...query, range: rangeB })),
          );
        },
      ),
      RUNS,
    );
  });
});

function asMs(slots: Slot[]): Array<[number, number]> {
  return slots.map((slot) => [ms(slot.start), ms(slot.end)]);
}
