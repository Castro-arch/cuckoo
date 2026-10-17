import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_URL,
  createAuthHarness,
  PASSWORD,
  uniqueEmail,
  type AuthHarness,
} from '../test/auth-harness.js';
import { createApp } from './bootstrap.js';

let h: AuthHarness;
let app: NestExpressApplication;
let baseUrl: string;

beforeAll(async () => {
  h = createAuthHarness();
  app = await createApp({ auth: h.auth, closeInfrastructure: h.close }, { logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app.close(); // closes the harness infrastructure through the shutdown hook
});

describe('HTTP app', () => {
  it('serves Better Auth under /api/auth with its own body parsing', async () => {
    const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({
        email: uniqueEmail('http'),
        password: PASSWORD,
        name: 'Jane',
        timeZone: 'Europe/Berlin',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token: null, user: { name: 'Jane' } });
  });

  it('still serves Nest routes', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
  });
});
