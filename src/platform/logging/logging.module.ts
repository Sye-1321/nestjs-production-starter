import { type DynamicModule, Module } from '@nestjs/common';

import type { LogLevel } from '../../config/config.types.js';
import { ApplicationLogger } from './application-logger.js';
import { RequestLoggingMiddleware } from './request-logging.middleware.js';

@Module({})
export class LoggingModule {
  public static forRoot(logLevel: LogLevel): DynamicModule {
    return {
      global: true,
      module: LoggingModule,
      providers: [
        {
          provide: ApplicationLogger,
          useFactory: (): ApplicationLogger => new ApplicationLogger(logLevel),
        },
        RequestLoggingMiddleware,
      ],
      exports: [ApplicationLogger],
    };
  }
}
