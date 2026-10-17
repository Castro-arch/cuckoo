import type { TestProject } from 'vitest/node';
import { createTestDatabase } from '../src/testing.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** One throwaway, fully migrated database per test run, dropped at the end. */
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

  const database = await createTestDatabase(serverUrl);
  project.provide('databaseUrl', database.url);
  return database.drop;
}
