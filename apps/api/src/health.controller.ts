import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@cuckoo/shared';

@Controller()
export class HealthController {
  @Get()
  hello(): { message: string } {
    return { message: 'Hello from the Cuckoo API' };
  }

  @Get('health')
  health(): HealthResponse {
    return { status: 'ok', service: 'api', time: new Date().toISOString() };
  }
}
