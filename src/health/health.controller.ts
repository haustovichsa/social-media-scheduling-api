import { Controller, Get } from '@nestjs/common';

/** Liveness probe. Returns a static payload so orchestrators can check the process is up. */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
