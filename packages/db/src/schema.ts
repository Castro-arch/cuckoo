import { sql } from 'drizzle-orm';
import { check, customType, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * PostgreSQL `tstzrange`, kept as its text form (e.g. `["2026-10-20 09:00:00+00","…")`).
 * Application code uses `start_at`/`end_at`; the range exists for constraints and
 * overlap queries (see `rangeOverlaps`). ADR-0002.
 */
export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => 'tstzrange',
});

export const bookingStatus = pgEnum('booking_status', ['confirmed', 'cancelled']);

/**
 * Double booking is impossible at the DB level: `bookings_no_overlap`
 * (EXCLUDE USING gist on owner_id + during, ignoring cancelled rows) is created in a
 * custom migration because Drizzle cannot express exclusion constraints. ADR-0002.
 */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // FK to the users table is added when that table exists.
    ownerId: uuid('owner_id').notNull(),
    status: bookingStatus('status').notNull().default('confirmed'),
    startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }).notNull(),
    // Half-open so back-to-back bookings (one ends 10:00, next starts 10:00) never conflict.
    during: tstzrange('during')
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(start_at, end_at, '[)')`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [check('bookings_valid_range', sql`${table.endAt} > ${table.startAt}`)],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
