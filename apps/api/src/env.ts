import { z } from 'zod';

/** Treats `NAME=` in .env like an unset variable. */
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const envSchema = z
  .object({
    API_PORT: z.coerce.number().int().positive().default(3001),
    API_HOST: z.string().default('0.0.0.0'),
    /** Public origin of the web app; the browser reaches the API through it (ADR-0004). */
    APP_URL: z.url().default('http://localhost:3000'),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url().default('redis://localhost:6379'),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)'),
    /** base64 of 32 random bytes; AES-256-GCM for data at rest. */
    ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required (see .env.example)'),
    ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(32_767).default(1),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    AUTH_RATE_LIMIT: z.enum(['on', 'off']).default('on'),
  })
  .refine((env) => Boolean(env.GOOGLE_CLIENT_ID) === Boolean(env.GOOGLE_CLIENT_SECRET), {
    message: 'Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
    path: ['GOOGLE_CLIENT_ID'],
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
