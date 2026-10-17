import { createHash, randomUUID } from 'node:crypto';
import { accounts, sessions, users, verifications } from '@cuckoo/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_URL,
  createAuthHarness,
  medianMs,
  PASSWORD,
  rawSessionToken,
  sessionCookie,
  uniqueEmail,
  type AuthHarness,
} from '../../test/auth-harness.js';
import { hashSessionToken, REDACTED_SESSION_TOKEN } from './hashed-session-adapter.js';

let h: AuthHarness;

beforeAll(() => {
  h = createAuthHarness();
});

afterAll(async () => {
  await h.close();
});

const signUp = (email: string, extra: Record<string, unknown> = {}) =>
  h.call('/sign-up/email', {
    body: { email, password: PASSWORD, name: 'Jane', timeZone: 'Europe/Berlin', ...extra },
  });

const signIn = (email: string, password = PASSWORD) =>
  h.call('/sign-in/email', { body: { email, password } });

const requestReset = (email: string) =>
  h.call('/request-password-reset', { body: { email, redirectTo: `${APP_URL}/reset-password` } });

/** Signs up and verifies through the real link in the (decrypted) verification email. */
async function verifiedUser(email = uniqueEmail()): Promise<{ email: string; cookie: string }> {
  await signUp(email);
  const verification = (await h.emails()).find(
    (e) => e.message.kind === 'verify-email' && e.message.to === email,
  );
  if (verification?.message.kind !== 'verify-email') throw new Error('No verification email');
  const response = await h.call(verification.message.url);
  const cookie = sessionCookie(response);
  if (!cookie) throw new Error(`Verification did not sign in (status ${response.status})`);
  return { email, cookie };
}

async function userByEmail(email: string) {
  const [user] = await h.infra.db.select().from(users).where(eq(users.email, email));
  return user;
}

/** Structure of a JSON value with leaf values replaced by their kind, for shape comparisons. */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, shapeOf(v)]),
    );
  }
  if (typeof value === 'string') {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
      return 'uuid';
    }
    if (!Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value)) return 'date';
  }
  return value === null ? 'null' : typeof value;
}

async function snapshot(response: Response) {
  return {
    status: response.status,
    hasSessionCookie: sessionCookie(response) !== undefined,
    body: shapeOf(await response.json()),
  };
}

/** Timing difference small enough that it does not reveal which branch ran. */
function expectComparable(a: number, b: number) {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(40, 0.5 * Math.max(a, b)));
}

describe('sign-up', () => {
  it('queues an encrypted verification email and does not sign in', async () => {
    const email = uniqueEmail();
    const response = await signUp(email);

    expect(response.status).toBe(200);
    expect(sessionCookie(response)).toBeUndefined();
    const sent = (await h.emails()).filter((e) => e.message.to === email);
    expect(sent.map((e) => e.message.kind)).toEqual(['verify-email']);
    expect(JSON.stringify(sent[0]!.job.data)).not.toContain(email);
  });

  it('answers an existing email exactly like a new one', async () => {
    const existing = uniqueEmail();
    await signUp(existing);

    const forNew = await snapshot(await signUp(uniqueEmail()));
    const forExisting = await snapshot(await signUp(existing));

    expect(forExisting).toEqual(forNew);
    expect(forNew.body).toMatchObject({ token: 'null', user: { id: 'uuid' } });
  });

  it('sends the existing-account notice at most once per address per day', async () => {
    const email = uniqueEmail();
    await signUp(email);
    await signUp(email);
    await signUp(email);

    const notices = (await h.emails()).filter(
      (e) => e.message.to === email && e.message.kind === 'existing-account-sign-up',
    );
    expect(notices).toHaveLength(1);
  });

  it('rejects an invalid time zone the same way for new and existing emails', async () => {
    const existing = uniqueEmail();
    await signUp(existing);

    const forNew = await snapshot(await signUp(uniqueEmail(), { timeZone: 'Mars/Olympus_Mons' }));
    const forExisting = await snapshot(await signUp(existing, { timeZone: 'Mars/Olympus_Mons' }));

    expect(forNew.status).toBe(400);
    expect(forExisting).toEqual(forNew);
  });

  it('stores the time zone and a generated username, never a reserved one', async () => {
    const domain = `${randomUUID().slice(0, 8)}.example.test`;
    await signUp(`admin@${domain}`, { timeZone: 'America/Sao_Paulo' });
    await signUp(`jane.doe@${domain}`);
    await signUp(`jane.doe+other@x${domain}`);

    const admin = await userByEmail(`admin@${domain}`);
    expect(admin).toMatchObject({ username: 'u-admin', timeZone: 'America/Sao_Paulo' });
    expect((await userByEmail(`jane.doe@${domain}`))?.username).toBe('jane-doe');
    expect((await userByEmail(`jane.doe+other@x${domain}`))?.username).toMatch(
      /^jane-doe-[a-z0-9]{6}$/,
    );
  });

  it('ignores a username sent by the client', async () => {
    const email = uniqueEmail('client');
    await signUp(email, { username: 'support' });

    expect((await userByEmail(email))?.username).not.toBe('support');
  });
});

describe('sign-in', () => {
  it('answers an unknown email exactly like a wrong password', async () => {
    const { email } = await verifiedUser();

    const unknown = await snapshot(await signIn(uniqueEmail()));
    const wrongPassword = await snapshot(await signIn(email, 'wrong password, long enough'));

    expect(unknown.status).toBe(401);
    expect(wrongPassword).toEqual(unknown);
  });

  it('refuses an unverified account only when the password is correct', async () => {
    const email = uniqueEmail();
    await signUp(email);

    expect((await signIn(email, 'wrong password, long enough')).status).toBe(401);
    expect((await signIn(email)).status).toBe(403);
  });

  it('stores only a hash of the session token, and the cookie still works', async () => {
    const { email } = await verifiedUser();
    const response = await signIn(email);
    const cookie = sessionCookie(response)!;
    const raw = rawSessionToken(cookie);
    const user = await userByEmail(email);

    const stored = await h.infra.db.select().from(sessions).where(eq(sessions.userId, user!.id));
    expect(stored.map((s) => s.token)).toContain(hashSessionToken(raw));
    expect(stored.map((s) => s.token)).not.toContain(raw);

    const session = (await (await h.call('/get-session', { cookie })).json()) as {
      session: { token: string; userId: string };
      user: { email: string };
    };
    expect(session).toMatchObject({ user: { email }, session: { userId: user!.id } });
    expect(session.session.token).not.toBe(REDACTED_SESSION_TOKEN);
  });

  it('signs out by deleting the session row', async () => {
    const { email, cookie } = await verifiedUser();
    const user = await userByEmail(email);

    const response = await h.call('/sign-out', { body: {}, cookie });

    expect(response.status).toBe(200);
    expect(await h.infra.db.select().from(sessions).where(eq(sessions.userId, user!.id))).toEqual(
      [],
    );
    expect(await (await h.call('/get-session', { cookie })).json()).toBeNull();
  });
});

describe('password reset', () => {
  it('answers an unknown email exactly like a known one', async () => {
    const { email } = await verifiedUser();

    const known = await snapshot(await requestReset(email));
    const unknown = await snapshot(await requestReset(uniqueEmail()));

    expect(known.status).toBe(200);
    expect(unknown).toEqual(known);
  });

  it('stores the reset token only as a hash', async () => {
    const { email } = await verifiedUser();
    const user = await userByEmail(email);
    await requestReset(email);

    const reset = (await h.emails()).find(
      (e) => e.message.to === email && e.message.kind === 'reset-password',
    );
    if (reset?.message.kind !== 'reset-password') throw new Error('No reset email');
    const token = new URL(reset.message.url).pathname.split('/').at(-1)!;
    const rows = await h.infra.db
      .select()
      .from(verifications)
      .where(eq(verifications.value, user!.id));

    const expected = createHash('sha256').update(`reset-password:${token}`).digest('base64url');
    expect(rows.map((r) => r.identifier)).toContain(expected);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('sends at most 3 reset emails per address per hour, with identical responses', async () => {
    const { email } = await verifiedUser();

    const responses = [];
    for (let i = 0; i < 5; i++) responses.push(await snapshot(await requestReset(email)));

    expect(new Set(responses.map((r) => JSON.stringify(r))).size).toBe(1);
    const resets = (await h.emails()).filter(
      (e) => e.message.to === email && e.message.kind === 'reset-password',
    );
    expect(resets).toHaveLength(3);
  });
});

describe('timing', () => {
  it('takes comparable time for unknown emails and wrong passwords at sign-in', async () => {
    const { email } = await verifiedUser();
    const unknown = await medianMs(5, () => signIn(uniqueEmail()));
    const wrong = await medianMs(5, () => signIn(email, 'wrong password, long enough'));
    expectComparable(unknown, wrong);
  });

  it('takes comparable time for new and existing emails at sign-up', async () => {
    const existing = uniqueEmail();
    await signUp(existing);
    const forNew = await medianMs(5, () => signUp(uniqueEmail()));
    const forExisting = await medianMs(5, () => signUp(existing));
    expectComparable(forNew, forExisting);
  });

  it('takes comparable time for known and unknown emails at password reset', async () => {
    const { email } = await verifiedUser();
    const known = await medianMs(5, () => requestReset(email));
    const unknown = await medianMs(5, () => requestReset(uniqueEmail()));
    expectComparable(known, unknown);
  });
});

describe('hooks and disabled endpoints', () => {
  it('never stores provider tokens on accounts, on create or on update', async () => {
    const { email } = await verifiedUser();
    const user = await userByEmail(email);
    const ctx = await h.auth.$context;

    const account = await ctx.internalAdapter.linkAccount({
      userId: user!.id,
      providerId: 'google',
      accountId: `google-${randomUUID()}`,
      accessToken: 'ya29.secret',
      refreshToken: '1//secret',
      idToken: 'eyJ.secret',
      scope: 'openid email profile',
    });
    await ctx.internalAdapter.updateAccount(account.id, { accessToken: 'ya29.refreshed' });

    const [stored] = await h.infra.db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(stored).toMatchObject({
      accessToken: null,
      refreshToken: null,
      idToken: null,
      scope: null,
    });
  });

  it('rejects reserved or malformed usernames on update', async () => {
    const { email } = await verifiedUser();
    const user = await userByEmail(email);
    const ctx = await h.auth.$context;

    await expect(ctx.internalAdapter.updateUser(user!.id, { username: 'admin' })).rejects.toThrow();
    await expect(
      ctx.internalAdapter.updateUser(user!.id, { username: 'Not Valid' }),
    ).rejects.toThrow();
    await ctx.internalAdapter.updateUser(user!.id, {
      username: `jane-${randomUUID().slice(0, 6)}`,
    });
  });

  it.each([
    ['GET', '/list-sessions'],
    ['POST', '/revoke-session'],
    ['POST', '/revoke-sessions'],
    ['POST', '/revoke-other-sessions'],
  ] as const)('disables %s %s', async (method, path) => {
    const { cookie } = await verifiedUser();
    const response = await h.call(path, { method, cookie, ...(method === 'POST' && { body: {} }) });
    expect(response.status).toBe(404);
  });
});
