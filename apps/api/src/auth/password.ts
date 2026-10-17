import { hash, verify, type Algorithm, type Options } from '@node-rs/argon2';

/**
 * argon2id with OWASP's recommended minimum parameters (19 MiB, 2 iterations, 1 lane).
 * `Algorithm` is a const enum in @node-rs/argon2's types, so its value (Argon2id = 2) is
 * written as a typed literal to stay compatible with isolatedModules.
 */
const ARGON2ID = 2 as Algorithm;

const OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const passwordHasher = {
  hash: (password: string): Promise<string> => hash(password, OPTIONS),
  verify: ({ hash: stored, password }: { hash: string; password: string }): Promise<boolean> =>
    verify(stored, password),
};
