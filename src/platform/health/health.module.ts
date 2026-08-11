import { Module, type DynamicModule } from '@nestjs/common';

import { Lifecycle } from '../../bootstrap/lifecycle.js';
import {
  LivenessController,
  ReadinessController,
} from './health.controller.js';
import { READINESS_PROBE, type ReadinessProbe } from './readiness-probe.js';
import { ReadinessService } from './readiness.service.js';

@Module({})
export class HealthModule {
  public static forRoot(
    lifecycle: Lifecycle,
    readinessProbe?: ReadinessProbe,
  ): DynamicModule {
    return {
      module: HealthModule,
      controllers: [LivenessController, ReadinessController],
      providers: [
        { provide: Lifecycle, useValue: lifecycle },
        { provide: READINESS_PROBE, useValue: readinessProbe ?? null },
        {
          provide: ReadinessService,
          useFactory: (
            configuredLifecycle: Lifecycle,
            configuredProbe: ReadinessProbe | null,
          ): ReadinessService =>
            new ReadinessService(configuredLifecycle, configuredProbe),
          inject: [Lifecycle, READINESS_PROBE],
        },
      ],
    };
  }
}
