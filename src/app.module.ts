import { Module, type DynamicModule } from '@nestjs/common';

import { Lifecycle } from './bootstrap/lifecycle.js';
import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/config.types.js';
import { ContextModule } from './platform/context/context.module.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { ErrorsModule } from './platform/errors/errors.module.js';
import { HealthModule } from './platform/health/health.module.js';
import { LoggingModule } from './platform/logging/logging.module.js';
import { TaskModule } from './task/task.module.js';

@Module({})
export class AppModule {
  public static forRoot(
    config: AppConfig,
    lifecycle: Lifecycle,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        ContextModule.forRoot(lifecycle),
        LoggingModule.forRoot(config.logLevel),
        DatabaseModule.forRoot(config),
        ErrorsModule,
        HealthModule.forRoot(lifecycle),
        TaskModule,
      ],
    };
  }
}
