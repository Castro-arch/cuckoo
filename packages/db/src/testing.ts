import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDatabase } from './client.js';
import { runMigrations } from './migrate.js';

export interface TestDatabase {
  /** Connection string of the throwaway database. */
  url: string;
  /** Drops the throwaway database. */
  drop: () => Promise<void>;
}

/**
 * Test-only (`@cuckoo/db/testing`): creates a throwaway database on the server in `serverUrl`,
 * applies every migration, and returns its URL. Never touches the database named in the URL.
 */
export async function createTestDatabase(serverUrl: string): Promise<TestDatabase> {
  const name = `cuckoo_test_${process.pid}_${randomUUID().slice(0, 8)}`;
  await withAdminClient(serverUrl, (client) => client.query(`CREATE DATABASE "${name}"`));

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const { db, close } = createDatabase(url.toString());
  try {
    await runMigrations(db);
  } finally {
    await close();
  }

  return {
    url: url.toString(),
    drop: () =>
      withAdminClient(serverUrl, (client) =>
        client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
      ),
  };
}

async function withAdminClient(
  serverUrl: string,
  run: (client: pg.Client) => Promise<unknown>,
): Promise<void> {
  const client = new pg.Client({ connectionString: serverUrl });
  try {
    await client.connect();
  } catch (error) {
    const host = new URL(serverUrl).host;
    throw new Error(
      `Cannot connect to PostgreSQL at ${host}. Start it with "docker compose up -d --wait db".`,
      { cause: error },
    );
  }
  try {
    await run(client);
  } finally {
    await client.end();
  }
}
