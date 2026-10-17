import { describe, expect, it } from 'vitest';
import { passwordHasher } from './password.js';

describe('passwordHasher', () => {
  it('hashes with argon2id and the OWASP parameters', async () => {
    const hash = await passwordHasher.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await passwordHasher.hash('correct horse battery staple');
    await expect(
      passwordHasher.verify({ hash, password: 'correct horse battery staple' }),
    ).resolves.toBe(true);
    await expect(
      passwordHasher.verify({ hash, password: 'Correct horse battery staple' }),
    ).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([passwordHasher.hash('same'), passwordHasher.hash('same')]);
    expect(a).not.toBe(b);
  });
});
