import { Lifecycle } from './lifecycle.js';

export type ShutdownSignal = 'SIGTERM' | 'SIGINT';

export interface ShutdownContext {
  readonly signal: ShutdownSignal;
  readonly deadlineAt: number;
}

export type ShutdownExecution = (context: ShutdownContext) => Promise<void>;

type Clock = () => number;

export interface ShutdownCoordinatorOptions {
  readonly lifecycle: Lifecycle;
  readonly shutdownTimeoutMs: number;
  readonly executeShutdown: ShutdownExecution;
  readonly now?: Clock;
}

export class ShutdownCoordinator {
  private readonly lifecycle: Lifecycle;
  private readonly shutdownTimeoutMs: number;
  private readonly executeShutdown: ShutdownExecution;
  private readonly now: Clock;

  private handlersInstalled = false;
  private deadlineAt: number | undefined;
  private shutdownSequence: Promise<void> | undefined;

  private readonly sigtermHandler = (): void => {
    void this.requestShutdown('SIGTERM');
  };

  private readonly sigintHandler = (): void => {
    void this.requestShutdown('SIGINT');
  };

  public constructor(options: ShutdownCoordinatorOptions) {
    this.lifecycle = options.lifecycle;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs;
    this.executeShutdown = options.executeShutdown;
    this.now = options.now ?? Date.now;
  }

  public get shutdownDeadlineAt(): number | undefined {
    return this.deadlineAt;
  }

  public installSignalHandlers(): void {
    if (this.handlersInstalled) {
      return;
    }

    process.on('SIGTERM', this.sigtermHandler);
    process.on('SIGINT', this.sigintHandler);
    this.handlersInstalled = true;
  }

  public removeSignalHandlers(): void {
    if (!this.handlersInstalled) {
      return;
    }

    process.off('SIGTERM', this.sigtermHandler);
    process.off('SIGINT', this.sigintHandler);
    this.handlersInstalled = false;
  }

  public requestShutdown(signal: ShutdownSignal): Promise<void> {
    if (this.shutdownSequence !== undefined) {
      return this.shutdownSequence;
    }

    const firstSignalTime = this.now();
    const deadlineAt = firstSignalTime + this.shutdownTimeoutMs;

    this.lifecycle.beginDraining();
    this.deadlineAt = deadlineAt;

    const context: ShutdownContext = Object.freeze({ signal, deadlineAt });
    const sequence = Promise.resolve().then(async () => {
      await this.executeShutdown(context);
      this.lifecycle.markStopped();
    });

    this.shutdownSequence = sequence;
    return sequence;
  }
}
