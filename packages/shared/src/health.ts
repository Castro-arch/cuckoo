import { z } from 'zod';

export const serviceNameSchema = z.enum(['web', 'api', 'worker']);
export type ServiceName = z.infer<typeof serviceNameSchema>;

/** Body returned by every app's health endpoint. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: serviceNameSchema,
  time: z.iso.datetime(),
  checks: z.record(z.string(), z.enum(['up', 'down'])).optional(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
