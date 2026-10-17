import { createServer, type Server } from 'node:http';
import type { HealthResponse } from '@cuckoo/shared';

export type HealthChecks = () => Record<string, 'up' | 'down'>;

/**
 * Minimal HTTP server so orchestrators can probe the worker.
 * GET / says hello; GET /health returns 200 when every check is up, 503 otherwise.
 */
export function createHealthServer(checks: HealthChecks): Server {
  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Hello from the Cuckoo worker' }));
      return;
    }

    if (req.method === 'GET' && path === '/health') {
      const results = checks();
      const healthy = Object.values(results).every((value) => value === 'up');
      const body: HealthResponse = {
        status: healthy ? 'ok' : 'degraded',
        service: 'worker',
        time: new Date().toISOString(),
        checks: results,
      };
      res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}
