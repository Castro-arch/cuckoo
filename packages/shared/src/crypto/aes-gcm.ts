import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for data at rest (provider credentials, email job payloads). Server-only.
 *
 * Layout of `data`: format version (1 byte) || IV (12 bytes) || auth tag (16 bytes) || ciphertext.
 * The key version is stored next to it, so keys can be rotated. Every call binds an
 * `associatedData` label, so a ciphertext cannot be replayed in another context.
 */

const FORMAT_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

export interface EncryptionKey {
  version: number;
  key: Buffer;
}

export interface Keyring {
  /** Used for every new encryption. */
  current: EncryptionKey;
  /** All keys that can decrypt, by version (includes `current`). */
  byVersion: ReadonlyMap<number, Buffer>;
}

export interface Encrypted {
  keyVersion: number;
  data: Buffer;
}

export class DecryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DecryptionError';
  }
}

/** Parses a base64 32-byte key, e.g. from `ENCRYPTION_KEY`. Never include the key in errors. */
export function parseEncryptionKey(base64: string, version: number): EncryptionKey {
  if (!Number.isInteger(version) || version < 1 || version > 32_767) {
    throw new RangeError('Encryption key version must be an integer between 1 and 32767');
  }
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new RangeError(`Encryption key must be ${KEY_BYTES} bytes of base64`);
  }
  return { version, key };
}

export function createKeyring(
  current: EncryptionKey,
  previous: readonly EncryptionKey[] = [],
): Keyring {
  const byVersion = new Map<number, Buffer>();
  for (const { version, key } of [current, ...previous]) {
    if (byVersion.has(version)) throw new RangeError(`Duplicate encryption key version ${version}`);
    byVersion.set(version, key);
  }
  return { current, byVersion };
}

export function encrypt(
  keyring: Keyring,
  plaintext: Buffer | string,
  associatedData: string,
): Encrypted {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyring.current.key, iv);
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const data = Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), ciphertext]);
  return { keyVersion: keyring.current.version, data };
}

export function decrypt(keyring: Keyring, encrypted: Encrypted, associatedData: string): Buffer {
  const key = keyring.byVersion.get(encrypted.keyVersion);
  if (!key) throw new DecryptionError(`No encryption key with version ${encrypted.keyVersion}`);
  const { data } = encrypted;
  if (data.length < HEADER_BYTES || data[0] !== FORMAT_VERSION) {
    throw new DecryptionError('Unsupported or truncated ciphertext');
  }
  const iv = data.subarray(1, 1 + IV_BYTES);
  const tag = data.subarray(1 + IV_BYTES, HEADER_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data.subarray(HEADER_BYTES)), decipher.final()]);
  } catch (error) {
    throw new DecryptionError('Ciphertext failed authentication', { cause: error });
  }
}
