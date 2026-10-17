import { describe, expect, it } from 'vitest';
import { Temporal } from './temporal.js';

describe('Temporal re-export', () => {
  it('resolves IANA time zones, including DST gaps', () => {
    // 02:30 does not exist in Berlin on 2026-03-29 (clocks jump 02:00 -> 03:00).
    const zoned = Temporal.PlainDateTime.from('2026-03-29T02:30').toZonedDateTime('Europe/Berlin');
    expect(zoned.toString()).toBe('2026-03-29T03:30:00+02:00[Europe/Berlin]');
  });

  it('knows historical rules (Brazil had DST until 2019)', () => {
    const zoned = Temporal.PlainDate.from('2018-11-04').toZonedDateTime('America/Sao_Paulo');
    // Midnight was skipped, so the day started at 01:00.
    expect(zoned.toString()).toBe('2018-11-04T01:00:00-02:00[America/Sao_Paulo]');
  });
});
