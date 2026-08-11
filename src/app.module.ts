import { Module, type DynamicModule } from '@nestjs/common';

import { Lifecycle } from './bootstrap/lifecycle.js';
import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/config.types.js';
import { HealthModule } from './platform/health/health.module.js';
import type { ReadinessProbe } from './platform/health/readiness-probe.js';

@Module({})
export class AppModule {
  public static forRoot(
    config: AppConfig,
    lifecycle: Lifecycle,
    readinessProbe?: ReadinessProbe,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        HealthModule.forRoot(lifecycle, readinessProbe),
      ],
    };
  }
}
