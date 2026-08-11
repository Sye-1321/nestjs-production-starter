export type LifecycleState =
  'BOOTING' | 'READY' | 'DRAINING' | 'STOPPED' | 'FAILED_START';

export class LifecycleTransitionError extends Error {
  public readonly from: LifecycleState;
  public readonly to: LifecycleState;

  public constructor(from: LifecycleState, to: LifecycleState) {
    super(`Invalid lifecycle transition: ${from} -> ${to}`);
    this.name = 'LifecycleTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class Lifecycle {
  private currentState: LifecycleState = 'BOOTING';

  public get state(): LifecycleState {
    return this.currentState;
  }

  public markReady(): void {
    this.transitionFrom('BOOTING', 'READY');
  }

  public beginDraining(): void {
    if (this.currentState !== 'BOOTING' && this.currentState !== 'READY') {
      throw new LifecycleTransitionError(this.currentState, 'DRAINING');
    }

    this.currentState = 'DRAINING';
  }

  public markStopped(): void {
    this.transitionFrom('DRAINING', 'STOPPED');
  }

  public markFailedStart(): void {
    this.transitionFrom('BOOTING', 'FAILED_START');
  }

  private transitionFrom(from: LifecycleState, to: LifecycleState): void {
    if (this.currentState !== from) {
      throw new LifecycleTransitionError(this.currentState, to);
    }

    this.currentState = to;
  }
}
