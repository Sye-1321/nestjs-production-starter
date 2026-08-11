import { ConfigurationValidationError } from '../config/env.validation.js';

type BootstrapLogWriter = (line: string) => void;

function writeStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

export class BootstrapLogger {
  public constructor(
    private readonly write: BootstrapLogWriter = writeStderr,
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
}
