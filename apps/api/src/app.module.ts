import { Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import type { Auth } from './auth/create-auth.js';
import { HealthController } from './health.controller.js';

export const AUTH = Symbol('AUTH');
const CLOSE_INFRASTRUCTURE = Symbol('CLOSE_INFRASTRUCTURE');

export interface AppModuleOptions {
  auth: Auth;
  /** Closes database, Redis and queue connections when the app shuts down. */
  closeInfrastructure: () => Promise<void>;
}

class InfrastructureShutdown implements OnApplicationShutdown {
  constructor(private readonly close: () => Promise<void>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }
}

@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        { provide: AUTH, useValue: options.auth },
        { provide: CLOSE_INFRASTRUCTURE, useValue: options.closeInfrastructure },
        {
          provide: InfrastructureShutdown,
          useFactory: (close: () => Promise<void>) => new InfrastructureShutdown(close),
          inject: [CLOSE_INFRASTRUCTURE],
        },
      ],
      exports: [AUTH],
    };
  }
}
