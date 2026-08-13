import { Controller, Get, Header } from '@nestjs/common';
import { Registry } from 'prom-client';

import { MetricsService } from './metrics.service.js';

@Controller('metrics')
export class MetricsController {
  public constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', Registry.PROMETHEUS_CONTENT_TYPE)
  public scrape(): Promise<string> {
    return this.metrics.render();
  }
}
