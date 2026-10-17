import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createDatabase } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Creates a throwaway database on the configured server, applies every migration,
 * and drops it after the run. Never touches the database named in the URL itself.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  try {
    process.loadEnvFile('../../.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const serverUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!serverUrl) {
    throw new Error('Set TEST_DATABASE_URL or DATABASE_URL (see .env.example) to run DB tests.');
  }

  const databaseName = `cuckoo_test_${process.pid}_${Date.now()}`;
  await withAdminClient(serverUrl, (client) => client.query(`CREATE DATABASE "${databaseName}"`));

  const testUrl = new URL(serverUrl);
  testUrl.pathname = `/${databaseName}`;
  const { db, close } = createDatabase(testUrl.toString());
  try {
    await runMigrations(db);
  } finally {
    await close();
  }

  project.provide('databaseUrl', testUrl.toString());

  return async () => {
    await withAdminClient(serverUrl, (client) =>
      client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`),
    );
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
