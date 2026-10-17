import { Temporal } from '../temporal.js';
import type { Interval } from './types.js';

const compare = Temporal.Instant.compare;

/** Sorts intervals and merges the ones that overlap or touch into disjoint intervals. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => compare(a.start, b.start));
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && compare(interval.start, last.end) <= 0) {
      if (compare(interval.end, last.end) > 0) {
        merged[merged.length - 1] = { start: last.start, end: interval.end };
      }
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/**
 * True when `interval` overlaps one of `disjoint` (sorted and merged, as returned by
 * `mergeIntervals`). Half-open: intervals that only touch do not overlap. O(log n).
 */
export function overlapsAny(disjoint: readonly Interval[], interval: Interval): boolean {
  // First interval that ends after `interval` starts; only it can overlap.
  let low = 0;
  let high = disjoint.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compare(disjoint[mid]!.end, interval.start) > 0) high = mid;
    else low = mid + 1;
  }
  const candidate = disjoint[low];
  return candidate !== undefined && compare(candidate.start, interval.end) < 0;
}
