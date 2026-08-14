import { Lifecycle } from './lifecycle.js';

export type ShutdownSignal = 'SIGTERM' | 'SIGINT';

export interface ShutdownContext {
  readonly signal: ShutdownSignal;
  readonly deadlineAt: number;
}

export type ShutdownExecution = (context: ShutdownContext) => Promise<void>;
export type ShutdownFailureHandler = (error: unknown) => void;
export type ForcedShutdownHandler = (context: ShutdownContext) => void;

type Clock = () => number;

interface DeadlineTimer {
  cancel(): void;
}

type DeadlineScheduler = (
  callback: () => void,
  delayMs: number,
) => DeadlineTimer;

const scheduleDeadline: DeadlineScheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);

  return {
    cancel(): void {
      clearTimeout(timer);
    },
  };
};

export interface ShutdownCoordinatorOptions {
  readonly lifecycle: Lifecycle;
  readonly shutdownTimeoutMs: number;
  readonly executeShutdown: ShutdownExecution;
  readonly forceShutdown: ForcedShutdownHandler;
  readonly onShutdownFailure?: ShutdownFailureHandler;
  readonly now?: Clock;
  readonly scheduleDeadline?: DeadlineScheduler;
}

export class ShutdownCoordinator {
  private readonly lifecycle: Lifecycle;
  private readonly shutdownTimeoutMs: number;
  private readonly executeShutdown: ShutdownExecution;
  private readonly forceShutdown: ForcedShutdownHandler;
  private readonly onShutdownFailure: ShutdownFailureHandler;
  private readonly now: Clock;
  private readonly scheduleDeadline: DeadlineScheduler;

  private handlersInstalled = false;
  private signalFailureObserved = false;
  private shutdownCompleted = false;
  private forceTriggered = false;
  private deadlineAt: number | undefined;
  private deadlineTimer: DeadlineTimer | undefined;
  private shutdownSequence: Promise<void> | undefined;

  private readonly sigtermHandler = (): void => {
    this.requestShutdownFromSignal('SIGTERM');
  };

  private readonly sigintHandler = (): void => {
    this.requestShutdownFromSignal('SIGINT');
  };

  public constructor(options: ShutdownCoordinatorOptions) {
    this.lifecycle = options.lifecycle;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs;
    this.executeShutdown = options.executeShutdown;
    this.forceShutdown = options.forceShutdown;
    this.onShutdownFailure = options.onShutdownFailure ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.scheduleDeadline = options.scheduleDeadline ?? scheduleDeadline;
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
    this.deadlineTimer = this.scheduleDeadline(() => {
      this.forceAtDeadline(context);
    }, this.shutdownTimeoutMs);

    const sequence = Promise.resolve().then(async () => {
      await this.executeShutdown(context);

      if (this.forceTriggered) {
        return;
      }

      this.shutdownCompleted = true;
      this.deadlineTimer?.cancel();
      this.lifecycle.markStopped();
    });

    this.shutdownSequence = sequence;
    return sequence;
  }

  private requestShutdownFromSignal(signal: ShutdownSignal): void {
    let sequence: Promise<void>;

    try {
      sequence = this.requestShutdown(signal);
    } catch (error) {
      this.onShutdownFailure(error);
      return;
    }

    if (this.signalFailureObserved) {
      return;
    }

    this.signalFailureObserved = true;
    void sequence.catch((error: unknown) => {
      this.onShutdownFailure(error);
    });
  }

  private forceAtDeadline(context: ShutdownContext): void {
    if (this.shutdownCompleted || this.forceTriggered) {
      return;
    }

    this.forceTriggered = true;
    this.forceShutdown(context);
  }
}
