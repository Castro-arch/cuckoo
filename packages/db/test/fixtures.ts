import { randomBytes, randomUUID } from 'node:crypto';
import type { Database } from '../src/client.js';
import { eventTypes, schedules, users, type NewBooking } from '../src/schema.js';

export interface Owner {
  userId: string;
  scheduleId: string;
  eventTypeId: string;
}

/** A fresh user with one schedule and one event type, so tests never share rows. */
export async function createOwner(db: Database): Promise<Owner> {
  const suffix = randomUUID().slice(0, 8);
  const [user] = await db
    .insert(users)
    .values({
      email: `owner-${suffix}@example.test`,
      name: 'Test Owner',
      username: `owner-${suffix}`,
      timeZone: 'Europe/Berlin',
    })
    .returning({ id: users.id });
  const [schedule] = await db
    .insert(schedules)
    .values({ ownerId: user!.id, name: 'Working hours', timeZone: 'Europe/Berlin' })
    .returning({ id: schedules.id });
  const [eventType] = await db
    .insert(eventTypes)
    .values({
      ownerId: user!.id,
      scheduleId: schedule!.id,
      slug: 'intro',
      title: 'Intro call',
      durationMinutes: 30,
      locationKind: 'jitsi',
    })
    .returning({ id: eventTypes.id });
  return { userId: user!.id, scheduleId: schedule!.id, eventTypeId: eventType!.id };
}

/** Values for a confirmed booking of the owner's event type. */
export function bookingValues(owner: Owner, startAt: Date, endAt: Date) {
  return {
    ownerId: owner.userId,
    eventTypeId: owner.eventTypeId,
    startAt,
    endAt,
    guestName: 'Guest',
    guestEmail: 'guest@example.test',
    guestTimeZone: 'America/Sao_Paulo',
    manageTokenHash: randomBytes(32).toString('base64url'),
  } satisfies NewBooking;
}
