import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://cuckoo:cuckoo@localhost:5432/cuckoo',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv(valid)).toMatchObject({
      API_PORT: 3001,
      APP_URL: 'http://localhost:3000',
      REDIS_URL: 'redis://localhost:6379',
      ENCRYPTION_KEY_VERSION: 1,
      AUTH_RATE_LIMIT: 'on',
    });
  });

  it('rejects a short auth secret without echoing it', () => {
    const secret = 'too-short-secret';
    expect(() => loadEnv({ ...valid, BETTER_AUTH_SECRET: secret })).toThrow(/at least 32/);
    expect(() => loadEnv({ ...valid, BETTER_AUTH_SECRET: secret })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  });

  it('requires both Google credentials or neither', () => {
    expect(() => loadEnv({ ...valid, GOOGLE_CLIENT_ID: 'id' })).toThrow(/both/);
    expect(
      loadEnv({ ...valid, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }).GOOGLE_CLIENT_ID,
    ).toBe(undefined);
    expect(
      loadEnv({ ...valid, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })
        .GOOGLE_CLIENT_ID,
    ).toBe('id');
  });
});
