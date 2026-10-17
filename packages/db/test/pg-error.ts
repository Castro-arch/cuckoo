import { DrizzleQueryError } from 'drizzle-orm';
import { expect } from 'vitest';

export const FOREIGN_KEY_VIOLATION = '23503';
export const UNIQUE_VIOLATION = '23505';
export const CHECK_VIOLATION = '23514';
export const EXCLUSION_VIOLATION = '23P01';
export const DATA_EXCEPTION = '22000';
export const INVALID_DATETIME_FORMAT = '22007';

/** Asserts the query fails with the given PostgreSQL error (unwrapping Drizzle's wrapper). */
export async function expectPgError(
  query: PromiseLike<unknown>,
  expected: { code: string; constraint?: string },
): Promise<void> {
  const error = await Promise.resolve(query).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, 'expected the query to be rejected').toBeDefined();
  const pgError = error instanceof DrizzleQueryError ? error.cause : error;
  expect(pgError).toMatchObject(expected);
}
