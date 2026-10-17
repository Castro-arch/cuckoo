import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { healthResponseSchema } from '@cuckoo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController] })
class HealthTestModule {}

describe('HealthController', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(HealthTestModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / says hello', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Hello from the Cuckoo API' });
  });

  it('GET /health returns a valid health response', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ status: 'ok', service: 'api' });
  });
});
