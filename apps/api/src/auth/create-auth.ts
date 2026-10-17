import { randomInt } from 'node:crypto';
import { isValidTimeZone } from '@cuckoo/core';
import {
  accounts,
  isUsernameTaken,
  sessions,
  users,
  verifications,
  type Database,
} from '@cuckoo/db';
import { usernameCandidates, usernameSchema } from '@cuckoo/shared';
import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { z } from 'zod';
import type { EmailOutbox } from '../email/email-outbox.js';
import type { RedisCounter } from '../redis-counter.js';
import { withHashedSessionTokens } from './hashed-session-adapter.js';
import { passwordHasher } from './password.js';

export interface AuthDependencies {
  db: Database;
  emailOutbox: EmailOutbox;
  /** Shared Redis counters for rate limiting across API instances. */
  rateLimitCounter: RedisCounter;
}

export interface AuthConfig {
  /** Public origin of the web app, e.g. https://cuckoo.example.com. Auth lives at /api/auth. */
  appUrl: string;
  secret: string;
  google?: { clientId: string; clientSecret: string } | undefined;
  rateLimitEnabled: boolean;
}

/**
 * Endpoints that hand stored session tokens back to the client or reuse them in queries.
 * With hashed tokens they would leak hashes or silently fail to revoke (ADR-0004).
 */
export const DISABLED_AUTH_PATHS = [
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
];

const signUpExtrasSchema = z.looseObject({
  name: z.string().trim().min(1).max(100),
  timeZone: z.string().refine(isValidTimeZone),
});

export function createAuth(deps: AuthDependencies, config: AuthConfig) {
  const { db, emailOutbox, rateLimitCounter } = deps;
  const { appUrl } = config;

  return betterAuth({
    appName: 'Cuckoo',
    baseURL: appUrl,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [appUrl],
    telemetry: { enabled: false },
    // Better Auth logs email addresses at info level (e.g. duplicate sign-ups); keep it at warn
    // explicitly, whatever its default becomes.
    logger: { level: 'warn' },
    disabledPaths: DISABLED_AUTH_PATHS,

    database: withHashedSessionTokens(
      drizzleAdapter(db, {
        provider: 'pg',
        schema: { user: users, session: sessions, account: accounts, verification: verifications },
      }),
    ),

    advanced: {
      // Better Auth generates UUIDs itself, so synthetic users (enumeration protection) get
      // ids that look exactly like real ones.
      database: { generateId: 'uuid' },
      cookiePrefix: 'cuckoo',
      useSecureCookies: appUrl.startsWith('https://'),
    },

    user: {
      additionalFields: {
        // Set by the create hook, never by the client; not returned, so real and synthetic
        // sign-up responses have the same shape.
        username: { type: 'string', required: false, input: false, returned: false },
        timeZone: { type: 'string', required: false, input: true, returned: false },
      },
    },

    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },

    verification: { storeIdentifier: 'hashed' },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: passwordHasher,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await emailOutbox.send({ kind: 'reset-password', to: user.email, name: user.name, url });
      },
      onExistingUserSignUp: async ({ user }) => {
        await emailOutbox.send({
          kind: 'existing-account-sign-up',
          to: user.email,
          name: user.name,
          signInUrl: `${appUrl}/login`,
          resetPasswordUrl: `${appUrl}/forgot-password`,
        });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await emailOutbox.send({ kind: 'verify-email', to: user.email, name: user.name, url });
      },
    },

    ...(config.google && {
      socialProviders: {
        google: {
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
          // Login only proves identity; calendar access is a separate flow (ADR-0004).
          scope: ['openid', 'email', 'profile'],
        },
      },
    }),

    account: {
      accountLinking: {
        enabled: true,
        // Google is not trusted blindly: it must report the email as verified, and the local
        // account must be verified too (prevents pre-registration account takeover).
        trustedProviders: [],
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
      },
    },

    rateLimit: {
      enabled: config.rateLimitEnabled,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60 * 60, max: 10 },
        '/request-password-reset': { window: 60 * 60, max: 10 },
        '/send-verification-email': { window: 60 * 60, max: 10 },
      },
      customStorage: {
        consume: (key, rule) => rateLimitCounter.consume(key, rule),
      },
    },

    hooks: {
      // Validate before Better Auth looks the email up, so invalid input gets the same error
      // whether or not the address exists.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return;
        if (!signUpExtrasSchema.safeParse(ctx.body).success) {
          throw APIError.from('BAD_REQUEST', {
            message: 'A name and a valid IANA time zone are required',
            code: 'INVALID_SIGN_UP_DETAILS',
          });
        }
      }),
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              username: await assignUsername(db, user.email),
              timeZone: typeof user.timeZone === 'string' ? user.timeZone : 'UTC',
            },
          }),
        },
        update: {
          before: async (user) => {
            if ('username' in user && !usernameSchema.safeParse(user.username).success) {
              throw APIError.from('BAD_REQUEST', {
                message: 'Invalid or reserved username',
                code: 'INVALID_USERNAME',
              });
            }
          },
        },
      },
      account: {
        create: { before: async (account) => ({ data: withoutOAuthTokens(account) }) },
        update: { before: async (account) => ({ data: withoutOAuthTokens(account) }) },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Never keep provider tokens from login accounts; calendar tokens live elsewhere, encrypted. */
export function withoutOAuthTokens<T extends Record<string, unknown>>(account: T): T {
  return {
    ...account,
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: null,
  };
}

async function assignUsername(db: Database, email: string): Promise<string> {
  const suffixes = Array.from({ length: 5 }, () =>
    randomInt(36 ** 6)
      .toString(36)
      .padStart(6, '0'),
  );
  for (const candidate of usernameCandidates(email, suffixes)) {
    if (!(await isUsernameTaken(db, candidate))) return candidate;
  }
  throw new Error('Could not assign a free username');
}
