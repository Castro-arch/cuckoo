import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from './client.js';
import { bookings } from './schema.js';
import { rangeOverlaps } from './sql.js';
import { bookingValues, createOwner, type Owner } from '../test/fixtures.js';
import {
  CHECK_VIOLATION,
  DATA_EXCEPTION,
  EXCLUSION_VIOLATION,
  expectPgError,
} from '../test/pg-error.js';

let handle: DatabaseHandle;

beforeAll(() => {
  handle = createDatabase(inject('databaseUrl'));
});

afterAll(async () => {
  await handle.close();
});

/** 2026-10-20 at the given UTC time, e.g. at('09:30'). */
function at(time: string): Date {
  return new Date(`2026-10-20T${time}:00Z`);
}

function book(owner: Owner, start: string, end: string) {
  return handle.db
    .insert(bookings)
    .values(bookingValues(owner, at(start), at(end)))
    .returning();
}

function cancel(id: string) {
  return handle.db
    .update(bookings)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(eq(bookings.id, id));
}

describe('bookings_no_overlap', () => {
  it.each([
    ['overlaps the start of', '08:45', '09:15'],
    ['overlaps the end of', '09:15', '09:45'],
    ['is contained in', '09:10', '09:20'],
    ['contains', '08:00', '10:00'],
    ['is identical to', '09:00', '09:30'],
  ])('rejects a booking that %s an existing one', async (_, start, end) => {
    const owner = await createOwner(handle.db);
    await book(owner, '09:00', '09:30');

    await expectPgError(book(owner, start, end), {
      code: EXCLUSION_VIOLATION,
      constraint: 'bookings_no_overlap',
    });
  });

  it('allows back-to-back bookings for the same owner', async () => {
    const owner = await createOwner(handle.db);
    await book(owner, '09:00', '09:30');
    await book(owner, '09:30', '10:00');
    await book(owner, '08:30', '09:00');

    const rows = await handle.db.select().from(bookings).where(eq(bookings.ownerId, owner.userId));
    expect(rows).toHaveLength(3);
  });

  it('allows overlapping bookings for different owners', async () => {
    await book(await createOwner(handle.db), '09:00', '09:30');
    const [other] = await book(await createOwner(handle.db), '09:00', '09:30');

    expect(other?.status).toBe('confirmed');
  });

  it('allows a booking that overlaps a cancelled one', async () => {
    const owner = await createOwner(handle.db);
    const [first] = await book(owner, '09:00', '09:30');
    await cancel(first!.id);

    const [second] = await book(owner, '09:15', '09:45');
    expect(second?.status).toBe('confirmed');
  });

  it('rejects reactivating a cancelled booking that now overlaps', async () => {
    const owner = await createOwner(handle.db);
    const [first] = await book(owner, '09:00', '09:30');
    await cancel(first!.id);
    await book(owner, '09:15', '09:45');

    await expectPgError(
      handle.db
        .update(bookings)
        .set({ status: 'confirmed', cancelledAt: null })
        .where(eq(bookings.id, first!.id)),
      { code: EXCLUSION_VIOLATION, constraint: 'bookings_no_overlap' },
    );
  });
});

describe('bookings_valid_range', () => {
  it('rejects end_at equal to start_at', async () => {
    await expectPgError(book(await createOwner(handle.db), '09:00', '09:00'), {
      code: CHECK_VIOLATION,
      constraint: 'bookings_valid_range',
    });
  });

  it('rejects end_at before start_at', async () => {
    // The tstzrange constructor fails before the CHECK runs (ADR-0002).
    await expectPgError(book(await createOwner(handle.db), '10:00', '09:00'), {
      code: DATA_EXCEPTION,
    });
  });
});

describe('during', () => {
  it('is generated as the half-open range [start_at, end_at)', async () => {
    const [row] = await book(await createOwner(handle.db), '09:00', '09:30');

    expect(row?.during).toMatch(/^\[.+\)$/);
    const [result] = await handle.db
      .select({
        lastMinute: rangeOverlaps(bookings.during, at('09:29'), at('09:30')),
        afterEnd: rangeOverlaps(bookings.during, at('09:30'), at('10:00')),
      })
      .from(bookings)
      .where(eq(bookings.id, row!.id));
    expect(result).toEqual({ lastMinute: true, afterEnd: false });
  });
});

describe('rangeOverlaps', () => {
  it('finds the bookings overlapping a window, excluding adjacent ones', async () => {
    const owner = await createOwner(handle.db);
    await book(owner, '08:00', '09:00'); // ends at the window start
    const [inside] = await book(owner, '09:15', '09:45');
    await book(owner, '10:00', '11:00'); // starts at the window end
    await book(await createOwner(handle.db), '09:00', '10:00'); // other owner

    const rows = await handle.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.ownerId, owner.userId),
          rangeOverlaps(bookings.during, at('09:00'), at('10:00')),
        ),
      );

    expect(rows).toEqual([{ id: inside!.id }]);
  });
});
