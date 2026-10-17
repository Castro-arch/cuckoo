/** Half-open `[start, end)` on a numeric axis, e.g. epoch milliseconds. */
export interface Span {
  start: number;
  end: number;
}

/** Sorts spans and merges the ones that overlap or touch into disjoint spans. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) {
      if (span.end > last.end) merged[merged.length - 1] = { start: last.start, end: span.end };
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/**
 * True when `span` overlaps one of `disjoint` (sorted and merged, as returned by
 * `mergeSpans`). Half-open: spans that only touch do not overlap. O(log n).
 */
export function overlapsAny(disjoint: readonly Span[], span: Span): boolean {
  // First span that ends after `span` starts; only it can overlap.
  let low = 0;
  let high = disjoint.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (disjoint[mid]!.end > span.start) high = mid;
    else low = mid + 1;
  }
  const candidate = disjoint[low];
  return candidate !== undefined && candidate.start < span.end;
}
