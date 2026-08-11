import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { ReadinessService } from './readiness.service.js';

@Controller('health')
export class LivenessController {
  @Get('live')
  public live(): { readonly status: 'live' } {
    return { status: 'live' };
  }
}

@Controller('health')
export class ReadinessController {
  public constructor(private readonly readinessService: ReadinessService) {}

  @Get('ready')
  public async ready(): Promise<{ readonly status: 'ready' }> {
    if (!(await this.readinessService.isReady())) {
      throw new ServiceUnavailableException({ status: 'not_ready' });
    }

    return { status: 'ready' };
  }
}
