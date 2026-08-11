import 'reflect-metadata';

import { BootstrapLogger } from './bootstrap/bootstrap-logger.js';
import { bootstrap } from './bootstrap/bootstrap.js';
import { parseEnvironment } from './config/env.validation.js';

async function run(): Promise<void> {
  let logger: BootstrapLogger | undefined;

  try {
    const config = parseEnvironment(process.env);
    logger = new BootstrapLogger();
    await bootstrap({ config, logger });
  } catch (error) {
    const failureLogger = logger ?? new BootstrapLogger();
    failureLogger.startupFailed(error);
    process.exitCode = 1;
  }
}

void run();
