import { ConfigurationValidationError } from '../config/env.validation.js';
import { writeSync } from 'node:fs';

type BootstrapLogWriter = (line: string) => void;

function writeStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

function writeStderrSynchronously(line: string): void {
  writeSync(process.stderr.fd, `${line}\n`);
}

export class BootstrapLogger {
  public constructor(
    private readonly write: BootstrapLogWriter = writeStderr,
    private readonly writeFatal: BootstrapLogWriter = writeStderrSynchronously,
  ) {}

  public startupFailed(error: unknown): void {
    if (error instanceof ConfigurationValidationError) {
      this.write(
        JSON.stringify({
          event: 'startup_failed',
          kind: 'configuration',
          field: error.field,
          rule: error.rule,
        }),
      );
      return;
    }

    this.write(JSON.stringify({ event: 'startup_failed', kind: 'bootstrap' }));
  }

  public shutdownFailed(): void {
    this.write(JSON.stringify({ event: 'shutdown_failed' }));
  }

  public shutdownStarted(): void {
    this.write(
      JSON.stringify({ event: 'shutdown_started', state: 'DRAINING' }),
    );
  }

  public forcedShutdown(): void {
    try {
      this.writeFatal(JSON.stringify({ event: 'forced_shutdown' }));
    } catch {
      // Best effort only: forceful termination must still proceed.
    }
  }
}
