import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createAuthHarness, uniqueEmail, type AuthHarness } from '../../test/auth-harness.js';
import { RedisCounter } from '../redis-counter.js';

const harnesses: AuthHarness[] = [];

afterAll(async () => {
  // One at a time: harnesses may share a namespace, and so the same queue.
  for (const h of harnesses) await h.close();
});

describe('RedisCounter', () => {
  it('allows exactly `max` of many concurrent requests', async () => {
    const redis = new Redis(inject('redisUrl'));
    const prefix = `test-${randomUUID()}:`;
    try {
      const counter = new RedisCounter(redis, prefix);
      const results = await Promise.all(
        Array.from({ length: 50 }, () => counter.consume('burst', { window: 60, max: 10 })),
      );

      expect(results.filter((r) => r.allowed)).toHaveLength(10);
      const rejected = results.filter((r) => !r.allowed);
      expect(rejected.every((r) => r.retryAfter! > 0 && r.retryAfter! <= 60)).toBe(true);
      expect(await redis.ttl(`${prefix}burst`)).toBeGreaterThan(0);
    } finally {
      await redis.del(`${prefix}burst`);
      await redis.quit();
    }
  });
});

describe('Better Auth rate limiting', () => {
  it('holds across API instances that share Redis', async () => {
    // Two auth instances, as two API processes would be, sharing one Redis namespace.
    const namespace = `test-${randomUUID()}`;
    const first = createAuthHarness({ rateLimitEnabled: true, namespace });
    const second = createAuthHarness({ rateLimitEnabled: true, namespace });
    harnesses.push(first, second);
    const ip = '198.51.100.7';
    const attempt = (h: AuthHarness) =>
      h.call('/sign-in/email', {
        ip,
        body: { email: uniqueEmail(), password: 'not the password, long enough' },
      });

    // The sign-in rule allows 5 per minute per IP: alternate between the two instances.
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await attempt(i % 2 === 0 ? first : second)).status);

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    // The counters live in Redis, not in process memory (Better Auth's memory store is a
    // module-level Map, so two instances in one test process would share it anyway).
    expect(await first.infra.redis.keys(`${namespace}:rate-limit:*`)).not.toHaveLength(0);

    // Another client IP is not affected.
    const other = await first.call('/sign-in/email', {
      ip: '198.51.100.8',
      body: { email: uniqueEmail(), password: 'not the password, long enough' },
    });
    expect(other.status).toBe(401);
  });
});
