import { eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { users } from './schema.js';

export async function isUsernameTaken(db: Database, username: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return rows.length > 0;
}
