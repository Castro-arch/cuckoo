import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { healthResponseSchema } from '@cuckoo/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createHealthServer, type HealthChecks } from './health-server.js';

let server: Server | undefined;

async function start(checks: HealthChecks): Promise<string> {
  server = createHealthServer(checks);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve));
  server = undefined;
});

describe('worker health server', () => {
  it('GET / says hello', async () => {
    const baseUrl = await start(() => ({}));
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Hello from the Cuckoo worker' });
  });

  it('returns 200 when every check is up', async () => {
    const baseUrl = await start(() => ({ redis: 'up', worker: 'up' }));
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ status: 'ok', service: 'worker' });
  });

  it('returns 503 when a check is down', async () => {
    const baseUrl = await start(() => ({ redis: 'down', worker: 'up' }));
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(503);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.status).toBe('degraded');
    expect(body.checks).toEqual({ redis: 'down', worker: 'up' });
  });

  it('returns 404 for unknown routes', async () => {
    const baseUrl = await start(() => ({}));
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });
});
