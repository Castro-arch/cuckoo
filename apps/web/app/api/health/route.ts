import type { HealthResponse } from '@cuckoo/shared';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const body: HealthResponse = { status: 'ok', service: 'web', time: new Date().toISOString() };
  return Response.json(body);
}
