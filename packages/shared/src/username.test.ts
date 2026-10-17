import { describe, expect, it } from 'vitest';
import {
  isReservedUsername,
  RESERVED_USERNAMES,
  USERNAME_PATTERN,
  usernameBaseFromEmail,
  usernameCandidates,
  usernameSchema,
  withUsernameSuffix,
} from './username.js';

describe('usernameSchema', () => {
  it.each(['jane', 'jane-doe', 'j4ne', 'abc', 'a'.repeat(40)])('accepts %j', (username) => {
    expect(usernameSchema.safeParse(username).success).toBe(true);
  });

  it.each(['ab', 'a'.repeat(41), 'Jane', 'jane_doe', '-jane', 'jane-', 'jane.doe', 'jäne', ''])(
    'rejects the malformed username %j',
    (username) => {
      expect(usernameSchema.safeParse(username).success).toBe(false);
    },
  );

  it.each([
    'api',
    'admin',
    'auth',
    'health',
    'login',
    'logout',
    'signup',
    'settings',
    'dashboard',
    'demo',
    'help',
    'support',
    'static',
    'assets',
    'www',
    'root',
    'cuckoo',
  ])('rejects the reserved username %j', (username) => {
    const result = usernameSchema.safeParse(username);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('This username is reserved');
  });

  it.each(['cuckoo-team', 'cuckooapp', 'admin-1', 'administrator'])(
    'rejects %j by its reserved prefix',
    (username) => {
      expect(isReservedUsername(username)).toBe(true);
      expect(usernameSchema.safeParse(username).success).toBe(false);
    },
  );

  it('does not reserve names that merely contain a reserved word', () => {
    expect(isReservedUsername('jane-admin')).toBe(false);
    expect(isReservedUsername('my-cuckoo')).toBe(false);
  });

  it('lists only reserved names that would otherwise be valid, plus route names like _next', () => {
    const invalid = [...RESERVED_USERNAMES].filter((name) => !USERNAME_PATTERN.test(name));
    expect(invalid).toEqual([]);
    // `_next` cannot be a username at all: the pattern already rejects it.
    expect(usernameSchema.safeParse('_next').success).toBe(false);
  });
});

describe('usernameBaseFromEmail', () => {
  it.each([
    ['jane.doe@example.com', 'jane-doe'],
    ['Jane.Doe+calendar@example.com', 'jane-doe'],
    ['josé.ñúñez@example.com', 'jose-nunez'],
    ['__x__@example.com', 'x-user'],
    ['ab@example.com', 'ab-user'],
    ['+++@example.com', 'user'],
    [`${'a'.repeat(60)}@example.com`, 'a'.repeat(32)],
    [`${'a'.repeat(31)}.b@example.com`, 'a'.repeat(31)],
  ])('derives %j -> %j', (email, expected) => {
    const base = usernameBaseFromEmail(email);
    expect(base).toBe(expected);
    expect(USERNAME_PATTERN.test(base)).toBe(true);
  });

  it('keeps reserved bases as they are, for the caller to suffix', () => {
    expect(usernameBaseFromEmail('admin@example.com')).toBe('admin');
  });
});

describe('withUsernameSuffix', () => {
  it('stays within the pattern for the longest base', () => {
    const username = withUsernameSuffix('a'.repeat(32), 'x7k2p9');
    expect(username).toBe(`${'a'.repeat(32)}-x7k2p9`);
    expect(USERNAME_PATTERN.test(username)).toBe(true);
  });
});

describe('usernameCandidates', () => {
  it('tries the derived base first, then suffixed variants', () => {
    expect(usernameCandidates('jane.doe@example.com', ['a1b2c3', 'd4e5f6'])).toEqual([
      'jane-doe',
      'jane-doe-a1b2c3',
      'jane-doe-d4e5f6',
    ]);
  });

  it.each(['admin@example.com', 'support@example.com', 'cuckoo@example.com'])(
    'never offers a reserved name for %j',
    (email) => {
      const candidates = usernameCandidates(email, ['a1b2c3']);
      expect(candidates.length).toBe(2);
      for (const candidate of candidates) {
        expect(usernameSchema.safeParse(candidate).success).toBe(true);
      }
      expect(candidates[0]).toMatch(/^u-/);
    },
  );
});
