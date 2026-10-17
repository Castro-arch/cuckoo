import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** `range && [start, end)`: true when the range overlaps the half-open interval. */
export function rangeOverlaps(range: AnyPgColumn | SQL, start: Date, end: Date): SQL<boolean> {
  return sql<boolean>`${range} && tstzrange(${start}::timestamptz, ${end}::timestamptz, '[)')`;
}
