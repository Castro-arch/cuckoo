import { describe, expect, it } from 'vitest';
import { mergeSpans, overlapsAny, type Span } from './intervals.js';

const span = (start: number, end: number): Span => ({ start, end });

describe('mergeSpans', () => {
  it('returns an empty list for no spans', () => {
    expect(mergeSpans([])).toEqual([]);
  });

  it('sorts spans by start', () => {
    expect(mergeSpans([span(5, 6), span(1, 2)])).toEqual([span(1, 2), span(5, 6)]);
  });

  it('merges overlapping spans', () => {
    expect(mergeSpans([span(1, 4), span(3, 6)])).toEqual([span(1, 6)]);
  });

  it('merges spans that touch', () => {
    expect(mergeSpans([span(1, 3), span(3, 5)])).toEqual([span(1, 5)]);
  });

  it('absorbs spans contained in another', () => {
    expect(mergeSpans([span(1, 10), span(2, 3), span(4, 5)])).toEqual([span(1, 10)]);
  });

  it('keeps gaps between spans', () => {
    expect(mergeSpans([span(1, 2), span(3, 4)])).toEqual([span(1, 2), span(3, 4)]);
  });

  it('does not mutate its input', () => {
    const input = [span(5, 6), span(1, 2)];
    mergeSpans(input);
    expect(input).toEqual([span(5, 6), span(1, 2)]);
  });
});

describe('overlapsAny', () => {
  const disjoint = mergeSpans([span(10, 20), span(30, 40), span(50, 60)]);

  it('is false for an empty list', () => {
    expect(overlapsAny([], span(0, 100))).toBe(false);
  });

  it.each([
    ['inside a span', span(12, 15)],
    ['across a span start', span(25, 31)],
    ['across a span end', span(39, 45)],
    ['covering several spans', span(0, 100)],
  ])('is true %s', (_, candidate) => {
    expect(overlapsAny(disjoint, candidate)).toBe(true);
  });

  it.each([
    ['touching a span end', span(20, 30)],
    ['touching a span start', span(45, 50)],
    ['before every span', span(0, 10)],
    ['after every span', span(60, 70)],
  ])('is false %s', (_, candidate) => {
    expect(overlapsAny(disjoint, candidate)).toBe(false);
  });

  it('finds the right span among many', () => {
    const many = mergeSpans(Array.from({ length: 1000 }, (_, i) => span(i * 10, i * 10 + 5)));
    expect(overlapsAny(many, span(5_004, 5_006))).toBe(true);
    expect(overlapsAny(many, span(5_005, 5_010))).toBe(false);
  });
});
