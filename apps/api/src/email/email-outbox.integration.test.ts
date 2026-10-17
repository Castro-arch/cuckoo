import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthHarness, uniqueEmail, type AuthHarness } from '../../test/auth-harness.js';
import { EMAIL_JOB_OPTIONS } from './email-outbox.js';

let h: AuthHarness;

beforeAll(() => {
  h = createAuthHarness();
});

afterAll(async () => {
  await h.close();
});

describe('EmailOutbox', () => {
  it('stores only ciphertext and removes jobs once handled', async () => {
    const to = uniqueEmail();
    const url = 'http://localhost:3000/api/auth/reset-password/super-secret-token';

    expect(await h.infra.emailOutbox.send({ kind: 'reset-password', to, name: 'Jane', url })).toBe(
      'queued',
    );

    const [queued] = (await h.emails()).filter((e) => e.message.to === to);
    expect(queued!.message).toEqual({ kind: 'reset-password', to, name: 'Jane', url });
    expect(Object.keys(queued!.job.data).sort()).toEqual(['ciphertext', 'keyVersion']);
    const raw = JSON.stringify(queued!.job.data);
    expect(raw).not.toContain(to);
    expect(raw).not.toContain('super-secret-token');
    expect(queued!.job.opts).toMatchObject({
      removeOnComplete: true,
      removeOnFail: { age: 3600 },
      attempts: EMAIL_JOB_OPTIONS.attempts,
    });
  });

  it('does not put the recipient address in Redis keys', async () => {
    const to = uniqueEmail('keys');
    await h.infra.emailOutbox.send({
      kind: 'verify-email',
      to,
      name: 'Jane',
      url: 'http://localhost:3000/api/auth/verify-email?token=t',
    });

    const keys = await h.infra.redis.keys('*');
    expect(keys.some((key) => key.includes(to))).toBe(false);
  });

  it('suppresses emails over the per-recipient limit, case-insensitively', async () => {
    const to = uniqueEmail('limit');
    const notice = (address: string) =>
      h.infra.emailOutbox.send({
        kind: 'existing-account-sign-up',
        to: address,
        name: 'Jane',
        signInUrl: 'http://localhost:3000/login',
        resetPasswordUrl: 'http://localhost:3000/forgot-password',
      });

    expect(await notice(to)).toBe('queued');
    expect(await notice(to.toUpperCase())).toBe('suppressed');
    expect(await notice(uniqueEmail('limit'))).toBe('queued');
  });
});
