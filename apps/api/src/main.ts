import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createAuth } from './auth/create-auth.js';
import { createApp } from './bootstrap.js';
import { loadEnv } from './env.js';
import { createInfrastructure } from './infrastructure.js';

const env = loadEnv();
const infrastructure = createInfrastructure({
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  encryptionKey: env.ENCRYPTION_KEY,
  encryptionKeyVersion: env.ENCRYPTION_KEY_VERSION,
});
const auth = createAuth(infrastructure, {
  appUrl: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  google:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined,
  rateLimitEnabled: env.AUTH_RATE_LIMIT === 'on',
});

const app = await createApp({ auth, closeInfrastructure: infrastructure.close });
await app.listen(env.API_PORT, env.API_HOST);
new Logger('Bootstrap').log(`api listening on http://localhost:${env.API_PORT}`);
