import { createHash } from 'node:crypto';
import type { EmailKind, EmailMessage } from '@cuckoo/shared';
import { encryptEmailMessage, type Keyring } from '@cuckoo/shared/crypto';
import type { Queue } from 'bullmq';
import type { CounterRule, RedisCounter } from '../redis-counter.js';

/**
 * Per-recipient limits, so nobody can use sign-up or reset forms to flood a victim's inbox.
 * Suppressed emails are silent: callers return the same response either way (ADR-0004).
 */
export const RECIPIENT_LIMITS: Record<EmailKind, CounterRule> = {
  'existing-account-sign-up': { window: 24 * 60 * 60, max: 1 },
  'reset-password': { window: 60 * 60, max: 3 },
  'verify-email': { window: 60 * 60, max: 3 },
};

/** Job options: never keep payloads around longer than needed. */
export const EMAIL_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: { age: 60 * 60 },
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
} as const;

export type SendResult = 'queued' | 'suppressed';

export class EmailOutbox {
  constructor(
    private readonly queue: Queue,
    private readonly keyring: Keyring,
    private readonly counter: RedisCounter,
  ) {}

  /**
   * Encrypts the message and enqueues it for the worker, unless the recipient reached its
   * limit for this kind of email. The job holds only ciphertext; its id is derived from a hash
   * of the message, so enqueueing the same message twice creates one job.
   */
  async send(message: EmailMessage): Promise<SendResult> {
    const recipient = sha256(message.to.toLowerCase());
    const { allowed } = await this.counter.consume(
      `${message.kind}:${recipient}`,
      RECIPIENT_LIMITS[message.kind],
    );
    if (!allowed) return 'suppressed';

    const data = encryptEmailMessage(this.keyring, message);
    const jobId = `${message.kind}-${sha256(JSON.stringify(message)).slice(0, 32)}`;
    await this.queue.add(message.kind, data, { ...EMAIL_JOB_OPTIONS, jobId });
    return 'queued';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
