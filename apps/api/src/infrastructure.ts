import { createDatabase, type Database } from '@cuckoo/db';
import { EMAIL_QUEUE } from '@cuckoo/shared';
import { createKeyring, parseEncryptionKey, type Keyring } from '@cuckoo/shared/crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { EmailOutbox } from './email/email-outbox.js';
import { RedisCounter } from './redis-counter.js';

export interface InfrastructureConfig {
  databaseUrl: string;
  redisUrl: string;
  encryptionKey: string;
  encryptionKeyVersion: number;
  /** Namespaces Redis keys and BullMQ queues; tests use a unique one per run. */
  namespace?: string;
}

export interface Infrastructure {
  db: Database;
  redis: Redis;
  emailQueue: Queue;
  keyring: Keyring;
  emailOutbox: EmailOutbox;
  rateLimitCounter: RedisCounter;
  close: () => Promise<void>;
}

export function createInfrastructure(config: InfrastructureConfig): Infrastructure {
  const namespace = config.namespace ?? 'cuckoo';
  const database = createDatabase(config.databaseUrl);
  const redis = new Redis(config.redisUrl);
  const keyring = createKeyring(
    parseEncryptionKey(config.encryptionKey, config.encryptionKeyVersion),
  );
  const emailQueue = new Queue(EMAIL_QUEUE, { connection: redis, prefix: namespace });
  const emailOutbox = new EmailOutbox(
    emailQueue,
    keyring,
    new RedisCounter(redis, `${namespace}:email-limit:`),
  );

  return {
    db: database.db,
    redis,
    emailQueue,
    keyring,
    emailOutbox,
    rateLimitCounter: new RedisCounter(redis, `${namespace}:rate-limit:`),
    close: async () => {
      await emailQueue.close();
      await redis.quit();
      await database.close();
    },
  };
}
