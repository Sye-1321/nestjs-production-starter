import { Lifecycle } from '../../bootstrap/lifecycle.js';
import type { ReadinessProbe } from './readiness-probe.js';

function isLifecycleReady(lifecycle: Lifecycle): boolean {
  return lifecycle.state === 'READY';
}

export class ReadinessService {
  public constructor(
    private readonly lifecycle: Lifecycle,
    private readonly probe: ReadinessProbe | null,
  ) {}

  public async isReady(): Promise<boolean> {
    if (!isLifecycleReady(this.lifecycle)) {
      return false;
    }

    if (this.probe === null) {
      return false;
    }

    let dependencyReady: boolean;

    try {
      dependencyReady = await this.probe.isReady();
    } catch {
      return false;
    }

    return dependencyReady && isLifecycleReady(this.lifecycle);
  }
}
