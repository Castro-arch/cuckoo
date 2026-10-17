import { z } from 'zod';

/** 3-40 characters: lowercase letters, digits and inner hyphens. Matches the DB CHECK. */
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/**
 * Usernames that clash with routes (`/{username}` is a public booking page) or could
 * impersonate the system or its operators. Any username starting with one of
 * `RESERVED_USERNAME_PREFIXES` is reserved too.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  // Routes and infrastructure
  'api',
  'auth',
  'oauth',
  'health',
  'healthz',
  'status',
  'static',
  'assets',
  'public',
  'embed',
  'app',
  'apps',
  'www',
  'mail',
  'email',
  'webhook',
  'webhooks',
  'docs',
  'blog',
  'new',
  // Account flows and pages
  'login',
  'logout',
  'signin',
  'sign-in',
  'signout',
  'sign-out',
  'signup',
  'sign-up',
  'register',
  'verify',
  'verify-email',
  'reset-password',
  'forgot-password',
  'settings',
  'dashboard',
  'account',
  'accounts',
  'profile',
  'onboarding',
  'billing',
  'booking',
  'bookings',
  'book',
  'calendar',
  'calendars',
  'event',
  'events',
  'availability',
  'schedule',
  'schedules',
  'team',
  'teams',
  'user',
  'users',
  'home',
  'about',
  'contact',
  'pricing',
  'legal',
  'privacy',
  'terms',
  'imprint',
  'security',
  'demo',
  'help',
  'support',
  // Impersonation of the system or its operators
  'root',
  'system',
  'sysadmin',
  'superuser',
  'owner',
  'staff',
  'official',
  'moderator',
  'mod',
  'noreply',
  'no-reply',
  'postmaster',
  'hostmaster',
  'webmaster',
  'abuse',
  'info',
  // Values that read as missing data
  'null',
  'undefined',
  'anonymous',
]);

export const RESERVED_USERNAME_PREFIXES: readonly string[] = ['cuckoo', 'admin'];

export function isReservedUsername(username: string): boolean {
  return (
    RESERVED_USERNAMES.has(username) ||
    RESERVED_USERNAME_PREFIXES.some((prefix) => username.startsWith(prefix))
  );
}

export const usernameSchema = z
  .string()
  .regex(USERNAME_PATTERN, {
    message:
      'Use 3-40 lowercase letters, digits or hyphens, starting and ending with a letter or digit',
  })
  .refine((username) => !isReservedUsername(username), { message: 'This username is reserved' });

const MAX_BASE_LENGTH = 32; // leaves room for a "-xxxxxx" suffix within 40 characters

/**
 * A username derived from an email address, e.g. `Jane.Doe+cal@example.com` -> `jane-doe`.
 * The result matches `USERNAME_PATTERN` but may be reserved or taken; callers add a suffix
 * with `withUsernameSuffix` in that case.
 */
export function usernameBaseFromEmail(email: string): string {
  const local = email.split('@')[0]?.split('+')[0] ?? '';
  const base = local
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // drop combining marks left by NFKD, so "é" becomes "e"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/, '');
  if (base.length === 0) return 'user';
  return base.length < 3 ? `${base}-user` : base;
}

/** `base` plus a short suffix, still matching `USERNAME_PATTERN`. */
export function withUsernameSuffix(base: string, suffix: string): string {
  return `${base.slice(0, MAX_BASE_LENGTH)}-${suffix}`;
}

/**
 * Valid, non-reserved usernames to try in order for an email: the derived base first (unless it
 * is reserved), then the base with each suffix. A reserved base gets a `u-` prefix, since a
 * suffix alone cannot un-reserve a reserved prefix such as `admin`.
 */
export function usernameCandidates(email: string, suffixes: readonly string[]): string[] {
  const derived = usernameBaseFromEmail(email);
  const base = isReservedUsername(derived) ? `u-${derived}`.slice(0, MAX_BASE_LENGTH) : derived;
  const candidates = [base, ...suffixes.map((suffix) => withUsernameSuffix(base, suffix))];
  return candidates.filter((candidate) => usernameSchema.safeParse(candidate).success);
}
