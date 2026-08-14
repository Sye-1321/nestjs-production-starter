import process from 'node:process';

import { BootstrapLogger } from '../../../dist/bootstrap/bootstrap-logger.js';
import { bootstrap } from '../../../dist/bootstrap/bootstrap.js';
import { parseEnvironment } from '../../../dist/config/env.validation.js';
import { DatabaseService } from '../../../dist/platform/database/database.service.js';
import { TaskService } from '../../../dist/task/task.service.js';

const MODE = process.env.M5_SHUTDOWN_FIXTURE_MODE;
const ACTIVE_MODE = 'active';
const KEEP_ALIVE_MODE = 'keep-alive';

function marker(name) {
  process.stdout.write(`${name}\n`);
}

function activeRelease() {
  return new Promise((resolve, reject) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('error', reject);
    process.stdin.once('data', (data) => {
      if (data.trim() !== 'RELEASE_ACTIVE') {
        reject(new Error('Unexpected active-work release command'));
        return;
      }

      marker('M5_ACTIVE_RELEASED');
      resolve();
    });
  });
}

async function run() {
  let logger;

  try {
    const config = parseEnvironment(process.env);
    logger = new BootstrapLogger();
    await bootstrap({
      config,
      logger,
      processTestSeam: {
        async afterApplicationInitialized(app, lifecycle) {
          const beginDraining = lifecycle.beginDraining.bind(lifecycle);
          lifecycle.beginDraining = () => {
            beginDraining();
            marker('M5_DRAINING');
          };

          const database = app.get(DatabaseService);
          const shutdownDatabase =
            database.onApplicationShutdown.bind(database);
          database.onApplicationShutdown = async () => {
            marker('M5_PROVIDER_CLEANUP_STARTED');
            await shutdownDatabase();
            marker('M5_PROVIDER_CLEANUP_COMPLETED');
          };

          if (MODE === ACTIVE_MODE) {
            const taskService = app.get(TaskService);
            const createTask = taskService.create.bind(taskService);
            taskService.create = async (title) => {
              marker('M5_ACTIVE_ENTERED');
              await activeRelease();
              const task = await createTask(title);
              marker('M5_ACTIVE_COMPLETED');
              return task;
            };
          }

          if (MODE === KEEP_ALIVE_MODE) {
            const taskService = app.get(TaskService);
            const createTask = taskService.create.bind(taskService);
            taskService.create = (title) => {
              marker('M5_BUSINESS_ENTERED');
              return createTask(title);
            };
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
