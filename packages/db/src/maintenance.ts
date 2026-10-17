import { lt } from 'drizzle-orm';
import type { Database } from './client.js';
import { sessions, verifications } from './schema.js';

export interface DeletedAuthRecords {
  sessions: number;
  verifications: number;
}

/** Deletes sessions and verifications that expired before `now`. Run by a repeatable job. */
export async function deleteExpiredAuthRecords(
  db: Database,
  now: Date = new Date(),
): Promise<DeletedAuthRecords> {
  const deletedSessions = await db.delete(sessions).where(lt(sessions.expiresAt, now));
  const deletedVerifications = await db
    .delete(verifications)
    .where(lt(verifications.expiresAt, now));
  return {
    sessions: deletedSessions.rowCount ?? 0,
    verifications: deletedVerifications.rowCount ?? 0,
  };
}
