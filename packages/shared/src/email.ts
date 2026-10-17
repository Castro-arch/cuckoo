import { z } from 'zod';

/** BullMQ queue for outgoing email. Job data is encrypted (`@cuckoo/shared/crypto`). */
export const EMAIL_QUEUE = 'email';

export const emailMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('verify-email'),
    to: z.email(),
    name: z.string(),
    url: z.url(),
  }),
  z.object({
    kind: z.literal('reset-password'),
    to: z.email(),
    name: z.string(),
    url: z.url(),
  }),
  // Sent instead of a verification email when someone signs up with an existing address.
  z.object({
    kind: z.literal('existing-account-sign-up'),
    to: z.email(),
    name: z.string(),
    signInUrl: z.url(),
    resetPasswordUrl: z.url(),
  }),
]);

export type EmailMessage = z.infer<typeof emailMessageSchema>;
export type EmailKind = EmailMessage['kind'];

/** What is stored in Redis: only the key version and the AES-256-GCM ciphertext. */
export const emailJobDataSchema = z.object({
  keyVersion: z.number().int().positive(),
  /** base64 of format || iv || auth tag || ciphertext */
  ciphertext: z.string().min(1),
});

export type EmailJobData = z.infer<typeof emailJobDataSchema>;
