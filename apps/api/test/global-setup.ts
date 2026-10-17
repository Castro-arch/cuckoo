import { createTestDatabase } from '@cuckoo/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

/** A throwaway, migrated database per run; Redis keys are namespaced per test harness. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  try {
    process.loadEnvFile('../../.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const serverUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
  if (!serverUrl || !redisUrl) {
    throw new Error(
      'Set TEST_DATABASE_URL (or DATABASE_URL) and TEST_REDIS_URL (or REDIS_URL) to run API integration tests.',
    );
  }

  const database = await createTestDatabase(serverUrl);
  project.provide('databaseUrl', database.url);
  project.provide('redisUrl', redisUrl);
  return database.drop;
}
