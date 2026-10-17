import { describe, expect, it } from 'vitest';
import { Temporal } from '../temporal.js';
import { getAvailableSlots, MAX_SLOT_RANGE_DAYS } from './get-available-slots.js';
import type { EventTypeRules, Interval, Slot, SlotQuery, TimeRange, Weekday } from './types.js';

const BERLIN = 'Europe/Berlin';
const SAO_PAULO = 'America/Sao_Paulo';
const TOKYO = 'Asia/Tokyo';
const LONG_AGO = Temporal.Instant.from('2000-01-01T00:00:00Z');

function hours(start: string, end: string): TimeRange {
  return { start: Temporal.PlainTime.from(start), end: Temporal.PlainTime.from(end) };
}

const WEEKDAYS_9_TO_5: Partial<Record<Weekday, readonly TimeRange[]>> = {
  1: [hours('09:00', '17:00')],
  2: [hours('09:00', '17:00')],
  3: [hours('09:00', '17:00')],
  4: [hours('09:00', '17:00')],
  5: [hours('09:00', '17:00')],
};

const ONE_HOUR: EventTypeRules = {
  durationMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minimumNoticeMinutes: 0,
  dailyLimit: null,
};

/** The instant of a wall-clock time on a date in a zone. */
function at(date: string, time: string, timeZone: string): Temporal.Instant {
  return Temporal.PlainDate.from(date)
    .toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from(time) })
    .toInstant();
}

function between(start: Temporal.Instant, end: Temporal.Instant): Interval {
  return { start, end };
}

/** From the start of `first` to the start of the day after `last`, in `timeZone`. */
function days(timeZone: string, first: string, last: string = first): Interval {
  return {
    start: Temporal.PlainDate.from(first).toZonedDateTime(timeZone).toInstant(),
    end: Temporal.PlainDate.from(last).add({ days: 1 }).toZonedDateTime(timeZone).toInstant(),
  };
}

/** A Berlin owner working weekdays 09:00-17:00, booking one-hour meetings. */
function query(parts: Partial<SlotQuery> & Pick<SlotQuery, 'range'>): SlotQuery {
  return {
    schedule: { timeZone: BERLIN, weekly: WEEKDAYS_9_TO_5 },
    overrides: [],
    eventType: ONE_HOUR,
    busy: [],
    eventTypeBookings: [],
    now: LONG_AGO,
    ...parts,
  };
}

/** Slot starts as local date-times with offset, e.g. `2026-10-20T09:00+02:00`. */
function local(slots: Slot[], timeZone: string): string[] {
  return slots.map((slot) =>
    slot.start
      .toZonedDateTimeISO(timeZone)
      .toString({ smallestUnit: 'minute', timeZoneName: 'never' }),
  );
}

/** Slot starts as local wall-clock times, e.g. `09:00`. */
function times(slots: Slot[], timeZone: string): string[] {
  return slots.map((slot) =>
    slot.start.toZonedDateTimeISO(timeZone).toPlainTime().toString({ smallestUnit: 'minute' }),
  );
}

/** Slot starts in UTC, e.g. `2026-10-20T07:00Z`. */
function utc(slots: Slot[]): string[] {
  return slots.map((slot) => slot.start.toString({ smallestUnit: 'minute' }));
}

describe('weekly schedule', () => {
  it('returns the slots inside working hours as UTC instants', () => {
    const slots = getAvailableSlots(query({ range: days(BERLIN, '2026-10-20') }));

    expect(utc(slots)).toEqual([
      '2026-10-20T07:00Z',
      '2026-10-20T08:00Z',
      '2026-10-20T09:00Z',
      '2026-10-20T10:00Z',
      '2026-10-20T11:00Z',
      '2026-10-20T12:00Z',
      '2026-10-20T13:00Z',
      '2026-10-20T14:00Z',
    ]);
    expect(slots[0]?.end.toString()).toBe('2026-10-20T08:00:00Z');
  });

  it('steps by slotIntervalMinutes when it is set', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-20'),
        eventType: { ...ONE_HOUR, slotIntervalMinutes: 30 },
      }),
    );

    expect(times(slots, BERLIN)).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '12:00',
      '12:30',
      '13:00',
      '13:30',
      '14:00',
      '14:30',
      '15:00',
      '15:30',
      '16:00',
    ]);
  });

  it('returns no slots for an empty schedule', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-19', '2026-10-25'),
        schedule: { timeZone: BERLIN, weekly: {} },
      }),
    );

    expect(slots).toEqual([]);
  });

  it('returns no slots on a weekday without hours', () => {
    expect(getAvailableSlots(query({ range: days(BERLIN, '2026-10-24') }))).toEqual([]);
  });

  it('keeps the grid anchored to the working hours when the range starts mid-slot', () => {
    const slots = getAvailableSlots(
      query({ range: between(at('2026-10-20', '10:15', BERLIN), days(BERLIN, '2026-10-20').end) }),
    );

    expect(times(slots, BERLIN)).toEqual(['11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
  });
});

describe('DST in Europe/Berlin', () => {
  it('loses the skipped hour when clocks go forward (2026-03-29)', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-03-29'),
        schedule: { timeZone: BERLIN, weekly: { 7: [hours('00:00', '06:00')] } },
      }),
    );

    expect(local(slots, BERLIN)).toEqual([
      '2026-03-29T00:00+01:00',
      '2026-03-29T01:00+01:00',
      '2026-03-29T03:00+02:00',
      '2026-03-29T04:00+02:00',
      '2026-03-29T05:00+02:00',
    ]);
    expect(utc(slots)).toEqual([
      '2026-03-28T23:00Z',
      '2026-03-29T00:00Z',
      '2026-03-29T01:00Z',
      '2026-03-29T02:00Z',
      '2026-03-29T03:00Z',
    ]);
  });

  it('offers the repeated hour twice when clocks go back (2026-10-25)', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-25'),
        schedule: { timeZone: BERLIN, weekly: { 7: [hours('00:00', '06:00')] } },
      }),
    );

    expect(local(slots, BERLIN)).toEqual([
      '2026-10-25T00:00+02:00',
      '2026-10-25T01:00+02:00',
      '2026-10-25T02:00+02:00',
      '2026-10-25T02:00+01:00',
      '2026-10-25T03:00+01:00',
      '2026-10-25T04:00+01:00',
      '2026-10-25T05:00+01:00',
    ]);
  });

  it('shifts working hours that start inside the gap forward', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-03-29'),
        schedule: { timeZone: BERLIN, weekly: { 7: [hours('02:30', '04:00')] } },
        eventType: { ...ONE_HOUR, durationMinutes: 30 },
      }),
    );

    // 02:30 does not exist; 'compatible' disambiguation moves it to 03:30.
    expect(local(slots, BERLIN)).toEqual(['2026-03-29T03:30+02:00']);
  });

  it('keeps the same wall-clock hours on both sides of the transition', () => {
    const slots = getAvailableSlots(query({ range: days(BERLIN, '2026-03-27', '2026-03-30') }));

    const friday = ['09', '10', '11', '12', '13', '14', '15', '16'].map(
      (h) => `2026-03-27T${h}:00+01:00`,
    );
    const monday = ['09', '10', '11', '12', '13', '14', '15', '16'].map(
      (h) => `2026-03-30T${h}:00+02:00`,
    );
    expect(local(slots, BERLIN)).toEqual([...friday, ...monday]);
  });
});

describe('DST in America/Sao_Paulo (before 2019)', () => {
  it('starts the day at 01:00 when midnight was skipped (2018-11-04)', () => {
    const slots = getAvailableSlots(
      query({
        range: days(SAO_PAULO, '2018-11-04'),
        schedule: { timeZone: SAO_PAULO, weekly: { 7: [hours('00:00', '03:00')] } },
      }),
    );

    expect(local(slots, SAO_PAULO)).toEqual(['2018-11-04T01:00-02:00', '2018-11-04T02:00-02:00']);
    expect(utc(slots)).toEqual(['2018-11-04T03:00Z', '2018-11-04T04:00Z']);
  });

  it('offers 23:00 twice when midnight fell back to 23:00 (2018-02-17)', () => {
    const slots = getAvailableSlots(
      query({
        range: days(SAO_PAULO, '2018-02-17'),
        schedule: { timeZone: SAO_PAULO, weekly: { 6: [hours('22:00', '00:00')] } },
      }),
    );

    expect(local(slots, SAO_PAULO)).toEqual([
      '2018-02-17T22:00-02:00',
      '2018-02-17T23:00-02:00',
      '2018-02-17T23:00-03:00',
    ]);
  });
});

describe('owner and guest in different time zones', () => {
  it('collects slots from two owner days that fall on one guest day', () => {
    // Owner in São Paulo works evenings; the guest asks for their Tuesday in Berlin.
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-20'),
        schedule: {
          timeZone: SAO_PAULO,
          weekly: { 1: [hours('18:00', '23:00')], 2: [hours('18:00', '23:00')] },
        },
      }),
    );

    expect(local(slots, SAO_PAULO)).toEqual([
      '2026-10-19T19:00-03:00',
      '2026-10-19T20:00-03:00',
      '2026-10-19T21:00-03:00',
      '2026-10-19T22:00-03:00',
      '2026-10-20T18:00-03:00',
    ]);
    expect(local(slots, BERLIN)).toEqual([
      '2026-10-20T00:00+02:00',
      '2026-10-20T01:00+02:00',
      '2026-10-20T02:00+02:00',
      '2026-10-20T03:00+02:00',
      '2026-10-20T23:00+02:00',
    ]);
  });

  it("shows the owner's working day in the evening of a guest ahead in time", () => {
    const slots = getAvailableSlots(query({ range: days(TOKYO, '2026-10-20') }));

    expect(local(slots, TOKYO)).toEqual(
      ['16', '17', '18', '19', '20', '21', '22', '23'].map((h) => `2026-10-20T${h}:00+09:00`),
    );
  });
});

describe('buffers', () => {
  const busyTen = between(at('2026-10-20', '10:00', BERLIN), at('2026-10-20', '10:30', BERLIN));

  it('drops slots whose buffers overlap a busy interval', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-20'),
        eventType: {
          ...ONE_HOUR,
          durationMinutes: 30,
          bufferBeforeMinutes: 15,
          bufferAfterMinutes: 10,
        },
        busy: [busyTen],
      }),
    );

    // 09:30 (after-buffer to 10:10), 10:00 (overlaps) and 10:30 (before-buffer from 10:15) go.
    expect(times(slots, BERLIN)).toEqual([
      '09:00',
      '11:00',
      '11:30',
      '12:00',
      '12:30',
      '13:00',
      '13:30',
      '14:00',
      '14:30',
      '15:00',
      '15:30',
      '16:00',
      '16:30',
    ]);
  });

  it('allows slots that only touch a busy interval when there are no buffers', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-20'),
        eventType: { ...ONE_HOUR, durationMinutes: 30 },
        busy: [busyTen],
      }),
    );

    expect(times(slots, BERLIN).slice(0, 3)).toEqual(['09:00', '09:30', '10:30']);
  });

  it('lets buffers extend outside working hours when that time is free', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-20'),
        eventType: { ...ONE_HOUR, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 },
      }),
    );

    expect(times(slots, BERLIN)).toEqual([
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
    ]);
  });

  it('checks buffers against busy time outside working hours', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-20'),
        eventType: { ...ONE_HOUR, bufferBeforeMinutes: 15 },
        busy: [between(at('2026-10-20', '08:30', BERLIN), at('2026-10-20', '08:50', BERLIN))],
      }),
    );

    expect(times(slots, BERLIN)[0]).toBe('10:00');
  });
});

describe('minimum notice', () => {
  it('drops slots that start before now + minimum notice', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-20'),
        eventType: { ...ONE_HOUR, minimumNoticeMinutes: 60 },
        now: at('2026-10-20', '09:10', BERLIN),
      }),
    );

    expect(times(slots, BERLIN)).toEqual(['11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
  });

  it('keeps a slot that starts exactly at now + minimum notice', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-20'),
        eventType: { ...ONE_HOUR, minimumNoticeMinutes: 60 },
        now: at('2026-10-20', '09:00', BERLIN),
      }),
    );

    expect(times(slots, BERLIN)[0]).toBe('10:00');
  });

  it('returns no slots for a range in the past', () => {
    const slots = getAvailableSlots(
      query({ range: days(BERLIN, '2026-10-20'), now: at('2026-10-21', '12:00', BERLIN) }),
    );

    expect(slots).toEqual([]);
  });
});

describe('daily limit', () => {
  // 21:30 on Tuesday in São Paulo is already Wednesday in UTC.
  const lateTuesdayBooking = between(
    at('2026-10-20', '21:30', SAO_PAULO),
    at('2026-10-20', '22:00', SAO_PAULO),
  );

  function dailyLimitQuery(dailyLimit: number): SlotQuery {
    return query({
      range: days(SAO_PAULO, '2026-10-20', '2026-10-21'),
      schedule: { timeZone: SAO_PAULO, weekly: WEEKDAYS_9_TO_5 },
      eventType: { ...ONE_HOUR, dailyLimit },
      eventTypeBookings: [lateTuesdayBooking],
    });
  }

  it('drops every slot on an owner-local day that reached the limit', () => {
    const slots = getAvailableSlots(dailyLimitQuery(1));

    expect(local(slots, SAO_PAULO)).toEqual(
      ['09', '10', '11', '12', '13', '14', '15', '16'].map((h) => `2026-10-21T${h}:00-03:00`),
    );
  });

  it('keeps the day while it is under the limit', () => {
    expect(getAvailableSlots(dailyLimitQuery(2))).toHaveLength(16);
  });
});

describe('date overrides', () => {
  it('blocks a day with an empty override', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-20', '2026-10-21'),
        overrides: [{ date: Temporal.PlainDate.from('2026-10-20'), ranges: [] }],
      }),
    );

    expect(slots).toHaveLength(8);
    expect(local(slots, BERLIN)[0]).toBe('2026-10-21T09:00+02:00');
  });

  it('adds hours on a day that is normally off', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-24'),
        overrides: [
          { date: Temporal.PlainDate.from('2026-10-24'), ranges: [hours('10:00', '12:00')] },
        ],
      }),
    );

    expect(times(slots, BERLIN)).toEqual(['10:00', '11:00']);
  });

  it("replaces the weekday's hours", () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-20'),
        overrides: [
          {
            date: Temporal.PlainDate.from('2026-10-20'),
            ranges: [hours('13:00', '15:00'), hours('16:00', '17:00')],
          },
        ],
      }),
    );

    expect(times(slots, BERLIN)).toEqual(['13:00', '14:00', '16:00']);
  });
});

describe('midnight', () => {
  it('drops slots on both days around a busy interval that crosses midnight', () => {
    const slots = getAvailableSlots(
      query({
        range: days(BERLIN, '2026-10-20', '2026-10-21'),
        schedule: {
          timeZone: BERLIN,
          weekly: { 2: [hours('20:00', '00:00')], 3: [hours('00:00', '04:00')] },
        },
        busy: [between(at('2026-10-20', '22:30', BERLIN), at('2026-10-21', '01:30', BERLIN))],
      }),
    );

    expect(local(slots, BERLIN)).toEqual([
      '2026-10-20T20:00+02:00',
      '2026-10-20T21:00+02:00',
      '2026-10-21T02:00+02:00',
      '2026-10-21T03:00+02:00',
    ]);
  });

  it('offers slots that span midnight when hours continue into the next day', () => {
    const schedule = {
      timeZone: BERLIN,
      weekly: { 2: [hours('22:30', '00:00')], 3: [hours('00:00', '01:30')] },
    };

    const bothDays = getAvailableSlots(
      query({ range: days(BERLIN, '2026-10-20', '2026-10-21'), schedule }),
    );
    expect(local(bothDays, BERLIN)).toEqual([
      '2026-10-20T22:30+02:00',
      '2026-10-20T23:30+02:00',
      '2026-10-21T00:30+02:00',
    ]);

    // Asking only for Wednesday keeps the same grid, anchored on Tuesday 22:30.
    const wednesday = getAvailableSlots(query({ range: days(BERLIN, '2026-10-21'), schedule }));
    expect(local(wednesday, BERLIN)).toEqual(['2026-10-21T00:30+02:00']);
  });
});

describe('validation', () => {
  const valid = query({ range: days(BERLIN, '2026-10-20') });

  it('rejects an unknown time zone', () => {
    expect(() =>
      getAvailableSlots({ ...valid, schedule: { timeZone: 'Mars/Olympus_Mons', weekly: {} } }),
    ).toThrow(RangeError);
  });

  it('rejects a range that does not move forward', () => {
    const start = at('2026-10-20', '09:00', BERLIN);
    expect(() => getAvailableSlots({ ...valid, range: between(start, start) })).toThrow(RangeError);
  });

  it(`rejects a range longer than ${MAX_SLOT_RANGE_DAYS} days`, () => {
    const start = Temporal.Instant.from('2026-10-01T00:00:00Z');
    const longest = between(start, start.add({ hours: 24 * MAX_SLOT_RANGE_DAYS }));
    const tooLong = between(start, longest.end.add({ minutes: 1 }));

    expect(() => getAvailableSlots({ ...valid, range: longest })).not.toThrow();
    expect(() => getAvailableSlots({ ...valid, range: tooLong })).toThrow(RangeError);
  });

  it('accepts a custom maximum range', () => {
    expect(() =>
      getAvailableSlots(
        { ...valid, range: days(BERLIN, '2026-10-19', '2026-10-21') },
        {
          maxRangeDays: 2,
        },
      ),
    ).toThrow(RangeError);
  });

  it('rejects working hours that end before they start', () => {
    expect(() =>
      getAvailableSlots({
        ...valid,
        schedule: { timeZone: BERLIN, weekly: { 2: [hours('17:00', '09:00')] } },
      }),
    ).toThrow(RangeError);
  });

  it('rejects two overrides for the same date', () => {
    const date = Temporal.PlainDate.from('2026-10-20');
    expect(() =>
      getAvailableSlots({
        ...valid,
        overrides: [
          { date, ranges: [] },
          { date, ranges: [] },
        ],
      }),
    ).toThrow(RangeError);
  });

  it.each<[string, Partial<EventTypeRules>]>([
    ['a zero duration', { durationMinutes: 0 }],
    ['a fractional duration', { durationMinutes: 1.5 }],
    ['a negative buffer', { bufferBeforeMinutes: -5 }],
    ['a negative minimum notice', { minimumNoticeMinutes: -1 }],
    ['a zero daily limit', { dailyLimit: 0 }],
    ['a zero slot interval', { slotIntervalMinutes: 0 }],
  ])('rejects %s', (_, rules) => {
    expect(() => getAvailableSlots({ ...valid, eventType: { ...ONE_HOUR, ...rules } })).toThrow(
      RangeError,
    );
  });

  it('rejects a busy interval that does not move forward', () => {
    const start = at('2026-10-20', '09:00', BERLIN);
    expect(() => getAvailableSlots({ ...valid, busy: [between(start, start)] })).toThrow(
      RangeError,
    );
  });
});
