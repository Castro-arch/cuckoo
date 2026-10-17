import { z } from 'zod';

const envSchema = z.object({
  REDIS_URL: z.url().default('redis://localhost:6379'),
  WORKER_PORT: z.coerce.number().int().positive().default(3002),
  WORKER_HOST: z.string().default('0.0.0.0'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
