import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createKeyring,
  decrypt,
  DecryptionError,
  encrypt,
  parseEncryptionKey,
  type Encrypted,
} from './aes-gcm.js';

const keyBase64 = () => randomBytes(32).toString('base64');
const keyring = createKeyring(parseEncryptionKey(keyBase64(), 1));

describe('parseEncryptionKey', () => {
  it.each([16, 31, 33, 64])('rejects a %i-byte key', (bytes) => {
    expect(() => parseEncryptionKey(randomBytes(bytes).toString('base64'), 1)).toThrow(RangeError);
  });

  it.each([0, -1, 1.5, 40_000])('rejects key version %d', (version) => {
    expect(() => parseEncryptionKey(keyBase64(), version)).toThrow(RangeError);
  });

  it('never puts the key in the error message', () => {
    const secret = randomBytes(31).toString('base64');
    expect(() => parseEncryptionKey(secret, 1)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  });
});

describe('encrypt / decrypt', () => {
  it('round-trips and never returns the plaintext in the ciphertext', () => {
    const encrypted = encrypt(keyring, 'https://example.test/reset?token=secret', 'ctx');
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.data.toString('utf8')).not.toContain('secret');
    expect(decrypt(keyring, encrypted, 'ctx').toString('utf8')).toBe(
      'https://example.test/reset?token=secret',
    );
  });

  it('uses a fresh IV for every encryption', () => {
    const a = encrypt(keyring, 'same', 'ctx').data.toString('hex');
    const b = encrypt(keyring, 'same', 'ctx').data.toString('hex');
    expect(a).not.toBe(b);
  });

  it('rejects a ciphertext bound to another context', () => {
    const encrypted = encrypt(keyring, 'payload', 'email-job');
    expect(() => decrypt(keyring, encrypted, 'calendar-credentials')).toThrow(DecryptionError);
  });

  it.each([
    ['the format byte', 0],
    ['the IV', 5],
    ['the auth tag', 20],
    ['the ciphertext', 30],
  ])('detects tampering with %s', (_, index) => {
    const encrypted = encrypt(keyring, 'payload that is long enough', 'ctx');
    const data = Buffer.from(encrypted.data);
    data[index] = (data[index]! + 1) % 256;
    expect(() => decrypt(keyring, { ...encrypted, data }, 'ctx')).toThrow(DecryptionError);
  });

  it('rejects truncated data and unknown key versions', () => {
    const encrypted = encrypt(keyring, 'payload', 'ctx');
    const truncated: Encrypted = { ...encrypted, data: encrypted.data.subarray(0, 10) };
    expect(() => decrypt(keyring, truncated, 'ctx')).toThrow(DecryptionError);
    expect(() => decrypt(keyring, { ...encrypted, keyVersion: 2 }, 'ctx')).toThrow(DecryptionError);
  });

  it('decrypts with a previous key after rotation and encrypts with the current one', () => {
    const v1 = parseEncryptionKey(keyBase64(), 1);
    const v2 = parseEncryptionKey(keyBase64(), 2);
    const old = encrypt(createKeyring(v1), 'old secret', 'ctx');

    const rotated = createKeyring(v2, [v1]);
    expect(decrypt(rotated, old, 'ctx').toString()).toBe('old secret');
    expect(encrypt(rotated, 'new secret', 'ctx').keyVersion).toBe(2);
  });

  it('rejects a keyring with duplicate versions', () => {
    const v1 = parseEncryptionKey(keyBase64(), 1);
    expect(() => createKeyring(v1, [parseEncryptionKey(keyBase64(), 1)])).toThrow(RangeError);
  });
});
