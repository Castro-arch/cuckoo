import {
  emailJobDataSchema,
  emailMessageSchema,
  type EmailJobData,
  type EmailMessage,
} from '../email.js';
import { decrypt, encrypt, type Keyring } from './aes-gcm.js';

/** Binds email job ciphertexts to this use, so they cannot be decrypted as anything else. */
const EMAIL_JOB_ASSOCIATED_DATA = 'cuckoo:email-job:v1';

/** Encrypts a message for the email queue. The job data contains no plaintext. */
export function encryptEmailMessage(keyring: Keyring, message: EmailMessage): EmailJobData {
  const plaintext = JSON.stringify(emailMessageSchema.parse(message));
  const { keyVersion, data } = encrypt(keyring, plaintext, EMAIL_JOB_ASSOCIATED_DATA);
  return { keyVersion, ciphertext: data.toString('base64') };
}

/** Decrypts and validates email job data. Only the worker calls this; never log the result. */
export function decryptEmailJob(keyring: Keyring, jobData: unknown): EmailMessage {
  const { keyVersion, ciphertext } = emailJobDataSchema.parse(jobData);
  const plaintext = decrypt(
    keyring,
    { keyVersion, data: Buffer.from(ciphertext, 'base64') },
    EMAIL_JOB_ASSOCIATED_DATA,
  );
  return emailMessageSchema.parse(JSON.parse(plaintext.toString('utf8')));
}
