import { Injectable } from '@nestjs/common';

import { Lifecycle } from '../../bootstrap/lifecycle.js';
import { DatabaseService } from '../database/database.service.js';
import { MetricsService } from '../metrics/metrics.service.js';

function isLifecycleReady(lifecycle: Lifecycle): boolean {
  return lifecycle.state === 'READY';
}

@Injectable()
export class ReadinessService {
  public constructor(
    private readonly lifecycle: Lifecycle,
    private readonly database: DatabaseService,
    private readonly metrics: MetricsService,
  ) {}

  public async isReady(): Promise<boolean> {
    if (!isLifecycleReady(this.lifecycle)) {
      this.metrics.setDependencyReady(false);
      return false;
    }

    try {
      await this.database.probe();
    } catch {
      this.metrics.setDependencyReady(false);
      return false;
    }

    const ready = isLifecycleReady(this.lifecycle);
    this.metrics.setDependencyReady(ready);
    return ready;
  }
}
