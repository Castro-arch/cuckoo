import { describe, expect, it } from 'vitest';
import { isValidTimeZone } from './timezone.js';

describe('isValidTimeZone', () => {
  it.each(['Europe/Berlin', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'UTC'])(
    'accepts IANA name %s',
    (timeZone) => {
      expect(isValidTimeZone(timeZone)).toBe(true);
    },
  );

  it.each(['', 'Mars/Olympus_Mons', '+02:00', 'Europe/', ' Europe/Berlin'])(
    'rejects %j',
    (timeZone) => {
      expect(isValidTimeZone(timeZone)).toBe(false);
    },
  );
});
