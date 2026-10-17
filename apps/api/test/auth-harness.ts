import { randomBytes, randomUUID } from 'node:crypto';
import type { EmailMessage } from '@cuckoo/shared';
import { decryptEmailJob } from '@cuckoo/shared/crypto';
import type { Job } from 'bullmq';
import { inject } from 'vitest';
import { createAuth, type Auth } from '../src/auth/create-auth.js';
import { createInfrastructure, type Infrastructure } from '../src/infrastructure.js';

export const APP_URL = 'http://localhost:3000';
export const PASSWORD = 'correct horse battery staple';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');

export interface AuthHarness {
  auth: Auth;
  infra: Infrastructure;
  /** POST (with a body) or GET to a Better Auth endpoint, as a browser on APP_URL would. */
  call: (
    path: string,
    options?: { body?: unknown; cookie?: string; ip?: string; method?: 'GET' | 'POST' },
  ) => Promise<Response>;
  /** Queued emails, decrypted the way the worker does. */
  emails: () => Promise<Array<{ job: Job; message: EmailMessage }>>;
  close: () => Promise<void>;
}

export function createAuthHarness(
  options: { rateLimitEnabled?: boolean; namespace?: string } = {},
): AuthHarness {
  const namespace = options.namespace ?? `test-${randomUUID()}`;
  const infra = createInfrastructure({
    databaseUrl: inject('databaseUrl'),
    redisUrl: inject('redisUrl'),
    encryptionKey: ENCRYPTION_KEY,
    encryptionKeyVersion: 7,
    namespace,
  });
  const auth = createAuth(infra, {
    appUrl: APP_URL,
    secret: 'integration-test-secret-that-is-long-enough',
    rateLimitEnabled: options.rateLimitEnabled ?? false,
  });

  return {
    auth,
    infra,
    call: (path, { body, cookie, ip = '203.0.113.10', method = body ? 'POST' : 'GET' } = {}) =>
      auth.handler(
        new Request(path.startsWith('http') ? path : `${APP_URL}/api/auth${path}`, {
          method,
          headers: {
            origin: APP_URL,
            'x-forwarded-for': ip,
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(cookie ? { cookie } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      ),
    emails: async () => {
      const jobs = await infra.emailQueue.getJobs(['waiting', 'delayed', 'prioritized']);
      return jobs.map((job) => ({ job, message: decryptEmailJob(infra.keyring, job.data) }));
    },
    close: async () => {
      await infra.emailQueue.pause();
      await infra.emailQueue.obliterate({ force: true });
      const keys = await infra.redis.keys(`${namespace}:*`);
      if (keys.length > 0) await infra.redis.del(...keys);
      await infra.close();
    },
  };
}

/** A unique address per test, so tests never collide in the shared database. */
export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
}

/** `name=value` of the session cookie from a response, ready for a Cookie header. */
export function sessionCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .find((cookie) => cookie.startsWith('cuckoo.session_token='));
}

/** The raw session token inside a signed session cookie (`token.signature`). */
export function rawSessionToken(cookie: string): string {
  return decodeURIComponent(cookie.split('=')[1]!).split('.')[0]!;
}

/** Median duration of `fn` in milliseconds. */
export async function medianMs(runs: number, fn: (i: number) => Promise<unknown>): Promise<number> {
  const durations: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn(i);
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  return durations[Math.floor(durations.length / 2)]!;
}
