import { Injectable } from '@nestjs/common';

import { Lifecycle } from '../../bootstrap/lifecycle.js';
import { DatabaseService } from '../database/database.service.js';

function isLifecycleReady(lifecycle: Lifecycle): boolean {
  return lifecycle.state === 'READY';
}

@Injectable()
export class ReadinessService {
  public constructor(
    private readonly lifecycle: Lifecycle,
    private readonly database: DatabaseService,
  ) {}

  public async isReady(): Promise<boolean> {
    if (!isLifecycleReady(this.lifecycle)) {
      return false;
    }

    try {
      await this.database.probe();
    } catch {
      return false;
    }

    return isLifecycleReady(this.lifecycle);
  }
}
