import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { bookingValues, createOwner } from '../test/fixtures.js';
import {
  CHECK_VIOLATION,
  expectPgError,
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
} from '../test/pg-error.js';
import { createDatabase, type DatabaseHandle } from './client.js';
import { deleteExpiredAuthRecords } from './maintenance.js';
import {
  bookings,
  calendarConnections,
  calendars,
  dateOverrideRanges,
  dateOverrides,
  eventTypes,
  scheduleRules,
  schedules,
  sessions,
  users,
  verifications,
} from './schema.js';

let handle: DatabaseHandle;

beforeAll(() => {
  handle = createDatabase(inject('databaseUrl'));
});

afterAll(async () => {
  await handle.close();
});

const db = () => handle.db;

function userValues(overrides: Partial<typeof users.$inferInsert> = {}) {
  const suffix = randomUUID().slice(0, 8);
  return {
    email: `user-${suffix}@example.test`,
    name: 'User',
    username: `user-${suffix}`,
    timeZone: 'Europe/Berlin',
    ...overrides,
  };
}

function eventTypeValues(ownerId: string, scheduleId: string) {
  return {
    ownerId,
    scheduleId,
    slug: `call-${randomUUID().slice(0, 8)}`,
    title: 'Call',
    durationMinutes: 30,
    locationKind: 'jitsi' as const,
  };
}

function connectionValues(ownerId: string, provider: 'google' | 'caldav' = 'google') {
  return {
    ownerId,
    provider,
    accountIdentifier: randomUUID(),
    displayName: 'Work',
    caldavUrl: provider === 'caldav' ? 'https://dav.example.test/' : null,
    credentials: Buffer.from([1, 2, 3]),
    credentialsKeyVersion: 1,
  };
}

describe('users', () => {
  it('rejects an email that is not lowercase', async () => {
    await expectPgError(
      db()
        .insert(users)
        .values(userValues({ email: 'Mixed@Example.test' })),
      {
        code: CHECK_VIOLATION,
        constraint: 'users_email_lowercase',
      },
    );
  });

  it.each(['ab', 'Upper', '-leading', 'trailing-', 'under_score', 'a'.repeat(41)])(
    'rejects the username %j',
    async (username) => {
      await expectPgError(db().insert(users).values(userValues({ username })), {
        code: CHECK_VIOLATION,
        constraint: 'users_username_format',
      });
    },
  );

  it('rejects a duplicate username', async () => {
    const username = `dup-${randomUUID().slice(0, 8)}`;
    await db().insert(users).values(userValues({ username }));
    await expectPgError(db().insert(users).values(userValues({ username })), {
      code: UNIQUE_VIOLATION,
      constraint: 'users_username_unique',
    });
  });
});

describe('schedule rules and overrides', () => {
  it('accepts 24:00 as the end of the day', async () => {
    const owner = await createOwner(db());
    await db()
      .insert(scheduleRules)
      .values({ scheduleId: owner.scheduleId, weekday: 5, startTime: '18:00', endTime: '24:00' });
  });

  it.each([0, 8])('rejects weekday %i', async (weekday) => {
    const owner = await createOwner(db());
    await expectPgError(
      db()
        .insert(scheduleRules)
        .values({ scheduleId: owner.scheduleId, weekday, startTime: '09:00', endTime: '17:00' }),
      { code: CHECK_VIOLATION, constraint: 'schedule_rules_weekday' },
    );
  });

  it.each([
    ['equal', '09:00', '09:00'],
    ['reversed', '17:00', '09:00'],
  ])('rejects %s rule times', async (_, startTime, endTime) => {
    const owner = await createOwner(db());
    await expectPgError(
      db()
        .insert(scheduleRules)
        .values({ scheduleId: owner.scheduleId, weekday: 1, startTime, endTime }),
      { code: CHECK_VIOLATION, constraint: 'schedule_rules_valid_range' },
    );
  });

  it('allows one override per date, with or without ranges', async () => {
    const owner = await createOwner(db());
    const [blocked] = await db()
      .insert(dateOverrides)
      .values({ scheduleId: owner.scheduleId, date: '2026-12-24' })
      .returning();
    const [extra] = await db()
      .insert(dateOverrides)
      .values({ scheduleId: owner.scheduleId, date: '2026-12-27' })
      .returning();
    await db()
      .insert(dateOverrideRanges)
      .values({ overrideId: extra!.id, startTime: '10:00', endTime: '12:00' });

    expect(blocked?.date).toBe('2026-12-24');
    await expectPgError(
      db().insert(dateOverrides).values({ scheduleId: owner.scheduleId, date: '2026-12-24' }),
      { code: UNIQUE_VIOLATION, constraint: 'date_overrides_schedule_date_unique' },
    );
  });

  it('rejects override ranges that end before they start', async () => {
    const owner = await createOwner(db());
    const [override] = await db()
      .insert(dateOverrides)
      .values({ scheduleId: owner.scheduleId, date: '2026-12-24' })
      .returning();
    await expectPgError(
      db()
        .insert(dateOverrideRanges)
        .values({ overrideId: override!.id, startTime: '12:00', endTime: '10:00' }),
      { code: CHECK_VIOLATION, constraint: 'date_override_ranges_valid_range' },
    );
  });
});

describe('event types', () => {
  it("rejects another owner's schedule", async () => {
    const owner = await createOwner(db());
    const other = await createOwner(db());
    await expectPgError(
      db().insert(eventTypes).values(eventTypeValues(owner.userId, other.scheduleId)),
      { code: FOREIGN_KEY_VIOLATION, constraint: 'event_types_schedule_same_owner_fk' },
    );
  });

  it('rejects deleting a schedule that an event type uses', async () => {
    const owner = await createOwner(db());
    await expectPgError(db().delete(schedules).where(eq(schedules.id, owner.scheduleId)), {
      code: FOREIGN_KEY_VIOLATION,
      constraint: 'event_types_schedule_same_owner_fk',
    });
  });

  it('rejects a duplicate slug for the same owner, but not for another owner', async () => {
    const owner = await createOwner(db());
    const other = await createOwner(db());
    const values = eventTypeValues(owner.userId, owner.scheduleId);
    await db().insert(eventTypes).values(values);
    await db()
      .insert(eventTypes)
      .values({ ...eventTypeValues(other.userId, other.scheduleId), slug: values.slug });

    await expectPgError(db().insert(eventTypes).values(values), {
      code: UNIQUE_VIOLATION,
      constraint: 'event_types_owner_slug_unique',
    });
  });

  it.each<[string, string, Partial<typeof eventTypes.$inferInsert>]>([
    ['an invalid slug', 'event_types_slug_format', { slug: 'Not A Slug' }],
    ['a zero duration', 'event_types_duration', { durationMinutes: 0 }],
    ['a duration over 24 hours', 'event_types_duration', { durationMinutes: 1441 }],
    ['a negative buffer', 'event_types_buffer_before', { bufferBeforeMinutes: -1 }],
    ['a negative minimum notice', 'event_types_minimum_notice', { minimumNoticeMinutes: -1 }],
    ['a zero daily limit', 'event_types_daily_limit', { dailyLimit: 0 }],
    ['a zero slot interval', 'event_types_slot_interval', { slotIntervalMinutes: 0 }],
    [
      'an in-person location without an address',
      'event_types_location_details',
      { locationKind: 'in_person' },
    ],
  ])('rejects %s', async (_, constraint, overrides) => {
    const owner = await createOwner(db());
    await expectPgError(
      db()
        .insert(eventTypes)
        .values({ ...eventTypeValues(owner.userId, owner.scheduleId), ...overrides }),
      { code: CHECK_VIOLATION, constraint },
    );
  });
});

describe('calendar connections and calendars', () => {
  it.each<[string, Partial<ReturnType<typeof connectionValues>>]>([
    ['a CalDAV connection without a URL', { provider: 'caldav', caldavUrl: null }],
    ['a Google connection with a CalDAV URL', { caldavUrl: 'https://dav.example.test/' }],
  ])('rejects %s', async (_, overrides) => {
    const owner = await createOwner(db());
    await expectPgError(
      db()
        .insert(calendarConnections)
        .values({ ...connectionValues(owner.userId), ...overrides }),
      { code: CHECK_VIOLATION, constraint: 'calendar_connections_caldav_url' },
    );
  });

  it("rejects a calendar on another owner's connection", async () => {
    const owner = await createOwner(db());
    const other = await createOwner(db());
    const [connection] = await db()
      .insert(calendarConnections)
      .values(connectionValues(other.userId))
      .returning();
    await expectPgError(
      db().insert(calendars).values({
        ownerId: owner.userId,
        connectionId: connection!.id,
        externalId: 'primary',
        name: 'Primary',
      }),
      { code: FOREIGN_KEY_VIOLATION, constraint: 'calendars_connection_same_owner_fk' },
    );
  });

  it('allows at most one booking target per owner', async () => {
    const owner = await createOwner(db());
    const [google] = await db()
      .insert(calendarConnections)
      .values(connectionValues(owner.userId))
      .returning();
    const [caldav] = await db()
      .insert(calendarConnections)
      .values(connectionValues(owner.userId, 'caldav'))
      .returning();
    await db().insert(calendars).values({
      ownerId: owner.userId,
      connectionId: google!.id,
      externalId: 'primary',
      name: 'Primary',
      isBookingTarget: true,
    });
    await db().insert(calendars).values({
      ownerId: owner.userId,
      connectionId: caldav!.id,
      externalId: 'https://dav.example.test/cal/',
      name: 'Personal',
    });

    await expectPgError(
      db().insert(calendars).values({
        ownerId: owner.userId,
        connectionId: caldav!.id,
        externalId: 'https://dav.example.test/other/',
        name: 'Other',
        isBookingTarget: true,
      }),
      { code: UNIQUE_VIOLATION, constraint: 'calendars_one_booking_target_per_owner' },
    );
  });
});

describe('bookings', () => {
  const start = new Date('2026-10-20T09:00:00Z');
  const end = new Date('2026-10-20T09:30:00Z');

  it("rejects another owner's event type", async () => {
    const owner = await createOwner(db());
    const other = await createOwner(db());
    await expectPgError(
      db()
        .insert(bookings)
        .values({ ...bookingValues(owner, start, end), eventTypeId: other.eventTypeId }),
      { code: FOREIGN_KEY_VIOLATION, constraint: 'bookings_event_type_same_owner_fk' },
    );
  });

  it.each<[string, Partial<typeof bookings.$inferInsert>]>([
    ['cancelled without cancelled_at', { status: 'cancelled' }],
    ['confirmed with cancelled_at', { cancelledAt: new Date() }],
  ])('rejects a booking %s', async (_, overrides) => {
    const owner = await createOwner(db());
    await expectPgError(
      db()
        .insert(bookings)
        .values({ ...bookingValues(owner, start, end), ...overrides }),
      { code: CHECK_VIOLATION, constraint: 'bookings_cancelled_at' },
    );
  });

  it('rejects deleting a user who still has bookings', async () => {
    const owner = await createOwner(db());
    await db()
      .insert(bookings)
      .values(bookingValues(owner, start, end));

    await expectPgError(db().delete(users).where(eq(users.id, owner.userId)), {
      code: FOREIGN_KEY_VIOLATION,
      constraint: 'bookings_owner_id_users_id_fk',
    });
  });

  it('deletes the configuration of a user without bookings', async () => {
    const owner = await createOwner(db());
    await db().insert(calendarConnections).values(connectionValues(owner.userId));
    await db()
      .insert(sessions)
      .values({ userId: owner.userId, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) });

    await db().delete(users).where(eq(users.id, owner.userId));

    const remaining = await Promise.all([
      db().select().from(schedules).where(eq(schedules.ownerId, owner.userId)),
      db().select().from(eventTypes).where(eq(eventTypes.ownerId, owner.userId)),
      db().select().from(calendarConnections).where(eq(calendarConnections.ownerId, owner.userId)),
      db().select().from(sessions).where(eq(sessions.userId, owner.userId)),
    ]);
    expect(remaining.map((rows) => rows.length)).toEqual([0, 0, 0, 0]);
  });
});

describe('deleteExpiredAuthRecords', () => {
  it('deletes only sessions and verifications that expired before now', async () => {
    const owner = await createOwner(db());
    const now = new Date('2030-01-01T12:00:00Z');
    const past = new Date('2030-01-01T11:59:59Z');
    const future = new Date('2030-01-01T12:00:01Z');
    const tag = randomUUID();
    await db()
      .insert(sessions)
      .values([
        { userId: owner.userId, token: `expired-${tag}`, expiresAt: past },
        { userId: owner.userId, token: `valid-${tag}`, expiresAt: future },
      ]);
    await db()
      .insert(verifications)
      .values([
        { identifier: `expired-${tag}`, value: 'x', expiresAt: past },
        { identifier: `valid-${tag}`, value: 'x', expiresAt: future },
      ]);

    const deleted = await deleteExpiredAuthRecords(db(), now);

    expect(deleted.sessions).toBeGreaterThanOrEqual(1);
    expect(deleted.verifications).toBeGreaterThanOrEqual(1);
    const sessionTokens = (
      await db().select().from(sessions).where(eq(sessions.userId, owner.userId))
    ).map((s) => s.token);
    expect(sessionTokens).toEqual([`valid-${tag}`]);
    const left = await db().select().from(verifications).where(eq(verifications.value, 'x'));
    expect(left.map((v) => v.identifier)).toContain(`valid-${tag}`);
    expect(left.map((v) => v.identifier)).not.toContain(`expired-${tag}`);
  });
});
