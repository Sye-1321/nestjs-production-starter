import { type DynamicModule, Module } from '@nestjs/common';

import { Lifecycle } from '../../bootstrap/lifecycle.js';
import { DrainingGateMiddleware } from './draining-gate.middleware.js';
import { RequestContextMiddleware } from './request-context.middleware.js';
import { RequestContextStorage } from './request-context.js';

@Module({})
export class ContextModule {
  public static forRoot(lifecycle: Lifecycle): DynamicModule {
    return {
      global: true,
      module: ContextModule,
      providers: [
        { provide: Lifecycle, useValue: lifecycle },
        RequestContextStorage,
        RequestContextMiddleware,
        DrainingGateMiddleware,
      ],
      exports: [RequestContextStorage],
    };
  }
}
