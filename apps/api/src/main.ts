import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();
await app.listen(env.API_PORT, env.API_HOST);
new Logger('Bootstrap').log(`api listening on http://localhost:${env.API_PORT}`);
