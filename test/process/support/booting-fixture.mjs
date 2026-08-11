import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { BootstrapLogger } from '../../../dist/bootstrap/bootstrap-logger.js';
import { bootstrap } from '../../../dist/bootstrap/bootstrap.js';
import { parseEnvironment } from '../../../dist/config/env.validation.js';

const MARKER = 'PROCESS_TEST_BOOTING_PAUSED';
const SEAM_TIMEOUT_MS = 2_000;
const POLL_INTERVAL_MS = 5;

async function run() {
  let logger;

  try {
    const config = parseEnvironment(process.env);
    logger = new BootstrapLogger();

    await bootstrap({
      config,
      logger,
      processTestSeam: {
        async afterSignalHandlersInstalled(isBooting) {
          process.stdout.write(`${MARKER}\n`);
          const deadline = Date.now() + SEAM_TIMEOUT_MS;

          while (isBooting()) {
            if (Date.now() >= deadline) {
              throw new Error('Process-test BOOTING seam timed out');
            }

            await delay(POLL_INTERVAL_MS);
          }
        },
      },
    });
  } catch (error) {
    const failureLogger = logger ?? new BootstrapLogger();
    failureLogger.startupFailed(error);
    process.exitCode = 1;
  }
}

void run();
