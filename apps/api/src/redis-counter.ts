import type { Redis } from 'ioredis';

/**
 * Fixed-window counters in Redis, shared by every API instance. One Lua script increments the
 * counter and sets its expiry atomically, so concurrent requests cannot all pass a stale read.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
`;

export interface CounterRule {
  /** Window length in seconds. */
  window: number;
  /** Requests allowed per window. */
  max: number;
}

export interface ConsumeResult {
  allowed: boolean;
  /** Seconds until the window resets, when not allowed. */
  retryAfter: number | null;
}

export class RedisCounter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  async consume(key: string, rule: CounterRule): Promise<ConsumeResult> {
    const [count, ttl] = (await this.redis.eval(
      CONSUME_SCRIPT,
      1,
      `${this.prefix}${key}`,
      rule.window,
    )) as [number, number];
    if (count <= rule.max) return { allowed: true, retryAfter: null };
    return { allowed: false, retryAfter: ttl > 0 ? ttl : rule.window };
  }
}
