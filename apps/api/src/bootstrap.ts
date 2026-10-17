import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule, type AppModuleOptions } from './app.module.js';

/**
 * Builds the HTTP app. Better Auth parses its own request bodies, so its handler is mounted on
 * Express before Nest's body parsers, which are then enabled for every other route.
 */
export async function createApp(
  options: AppModuleOptions,
  { logger = true }: { logger?: boolean } = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(options), {
    bodyParser: false,
    ...(logger ? {} : { logger: false }),
  });
  app.getHttpAdapter().getInstance().all('/api/auth/{*path}', toNodeHandler(options.auth));
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '100kb' });
  app.enableShutdownHooks();
  return app;
}
