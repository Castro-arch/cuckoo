import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EmailMessage } from '../email.js';
import { createKeyring, encrypt, parseEncryptionKey } from './aes-gcm.js';
import { decryptEmailJob, encryptEmailMessage } from './email-job.js';

const keyring = createKeyring(parseEncryptionKey(randomBytes(32).toString('base64'), 3));

const message: EmailMessage = {
  kind: 'reset-password',
  to: 'jane@example.test',
  name: 'Jane',
  url: 'https://cuckoo.example.test/api/auth/reset-password/s3cr3t-token',
};

describe('email job encryption', () => {
  it('stores only the key version and ciphertext, without any plaintext', () => {
    const jobData = encryptEmailMessage(keyring, message);
    expect(Object.keys(jobData).sort()).toEqual(['ciphertext', 'keyVersion']);
    expect(jobData.keyVersion).toBe(3);
    const serialized = JSON.stringify(jobData);
    for (const secret of ['jane@example.test', 'Jane', 's3cr3t-token', 'reset-password']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('round-trips through JSON, as BullMQ stores it', () => {
    const jobData = JSON.parse(JSON.stringify(encryptEmailMessage(keyring, message)));
    expect(decryptEmailJob(keyring, jobData)).toEqual(message);
  });

  it('refuses to encrypt an invalid message', () => {
    expect(() => encryptEmailMessage(keyring, { ...message, to: 'not-an-email' })).toThrow();
  });

  it('refuses job data that is not an encrypted email job', () => {
    expect(() => decryptEmailJob(keyring, { to: 'jane@example.test' })).toThrow();
    // Valid ciphertext, but bound to another context.
    const other = encrypt(keyring, JSON.stringify(message), 'something-else');
    expect(() =>
      decryptEmailJob(keyring, { keyVersion: 3, ciphertext: other.data.toString('base64') }),
    ).toThrow();
  });
});
