import { Global, Module } from '@nestjs/common';

import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';
import { RequestMetricsMiddleware } from './request-metrics.middleware.js';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, RequestMetricsMiddleware],
  exports: [MetricsService],
})
export class MetricsModule {}
