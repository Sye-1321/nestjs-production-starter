import { Module, type DynamicModule } from '@nestjs/common';

import { Lifecycle } from '../../bootstrap/lifecycle.js';
import {
  LivenessController,
  ReadinessController,
} from './health.controller.js';
import { ReadinessService } from './readiness.service.js';

@Module({})
export class HealthModule {
  public static forRoot(lifecycle: Lifecycle): DynamicModule {
    return {
      module: HealthModule,
      controllers: [LivenessController, ReadinessController],
      providers: [
        { provide: Lifecycle, useValue: lifecycle },
        ReadinessService,
      ],
    };
  }
}
