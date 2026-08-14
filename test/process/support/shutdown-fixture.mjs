import process from 'node:process';

import { HttpException } from '@nestjs/common';

import { BootstrapLogger } from '../../../dist/bootstrap/bootstrap-logger.js';
import { bootstrap } from '../../../dist/bootstrap/bootstrap.js';
import { parseEnvironment } from '../../../dist/config/env.validation.js';
import { RequestContextStorage } from '../../../dist/platform/context/request-context.js';
import { DatabaseService } from '../../../dist/platform/database/database.service.js';
import { TaskService } from '../../../dist/task/task.service.js';

const MODE = process.env.M5_SHUTDOWN_FIXTURE_MODE;
const ACTIVE_MODE = 'active';
const KEEP_ALIVE_MODE = 'keep-alive';
const FORCE_ACTIVE_MODE = 'force-active';
const FORCE_CLEANUP_MODE = 'force-cleanup';
const NATIVE_ABORT_MODE = 'native-abort';
const DISCONNECT_TITLE = 'M5 disconnect request';
const NORMAL_TITLE = 'M5 normal keepalive request';
const UNEXPECTED_5XX_MODE = 'unexpected-5xx';
const HTTP_BOUNDARY_MODE = 'http-boundary';

const neverSettles = new Promise(() => undefined);

function marker(name) {
  process.stdout.write(`${name}\n`);
}

function releaseCommand(expectedCommand, releasedMarker) {
  return new Promise((resolve, reject) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('error', reject);
    process.stdin.once('data', (data) => {
      if (data.trim() !== expectedCommand) {
        reject(new Error('Unexpected work release command'));
        return;
      }

      marker(releasedMarker);
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

            if (MODE === FORCE_CLEANUP_MODE) {
              await neverSettles;
            }

            await shutdownDatabase();
            marker('M5_PROVIDER_CLEANUP_COMPLETED');
          };

          if (MODE === ACTIVE_MODE || MODE === FORCE_ACTIVE_MODE) {
            const taskService = app.get(TaskService);
            const createTask = taskService.create.bind(taskService);
            taskService.create = async (title) => {
              marker('M5_ACTIVE_ENTERED');

              if (MODE === FORCE_ACTIVE_MODE) {
                await neverSettles;
              } else {
                await releaseCommand('RELEASE_ACTIVE', 'M5_ACTIVE_RELEASED');
              }

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

          if (MODE === NATIVE_ABORT_MODE) {
            const contextStorage = app.get(RequestContextStorage);
            const taskService = app.get(TaskService);
            const createTask = taskService.create.bind(taskService);
            taskService.create = async (title) => {
              const requestContext = contextStorage.get();
              if (requestContext === undefined) {
                throw new Error('Native-abort fixture has no request context');
              }

              if (title === DISCONNECT_TITLE) {
                marker('M5_DISCONNECT_WORK_ENTERED');
                let abortRecorded = false;
                const recordAbort = () => {
                  if (abortRecorded) {
                    return;
                  }

                  abortRecorded = true;
                  marker('M5_DISCONNECT_ABORTED');
                };

                if (requestContext.abortSignal.aborted) {
                  recordAbort();
                } else {
                  requestContext.abortSignal.addEventListener(
                    'abort',
                    recordAbort,
                    { once: true },
                  );
                  if (requestContext.abortSignal.aborted) {
                    recordAbort();
                  }
                }
                await releaseCommand(
                  'RELEASE_ABORT',
                  'M5_DISCONNECT_WORK_RELEASED',
                );
                const task = await createTask(title);
                marker('M5_DISCONNECT_WORK_COMPLETED');
                return task;
              }

              if (title === NORMAL_TITLE) {
                let completed = false;
                marker('M5_NORMAL_WORK_ENTERED');
                if (!requestContext.abortSignal.aborted) {
                  requestContext.abortSignal.addEventListener(
                    'abort',
                    () =>
                      marker(
                        completed
                          ? 'M5_NORMAL_ABORTED_AFTER_COMPLETION'
                          : 'M5_NORMAL_ABORTED_DURING_WORK',
                      ),
                    { once: true },
                  );
                }
                const task = await createTask(title);
                completed = true;
                marker('M5_NORMAL_WORK_COMPLETED');
                return task;
              }

              return createTask(title);
            };
          }

          if (MODE === UNEXPECTED_5XX_MODE) {
            const taskService = app.get(TaskService);
            taskService.create = () => {
              throw new HttpException(
                {
                  statusCode: 500,
                  message: 'M5_RAW_5XX_MESSAGE_CANARY_51D3',
                  prisma: 'PrismaClientKnownRequestError',
                  pg: { sql: 'SELECT * FROM tasks', host: 'db.internal' },
                  databaseUrl: process.env.DATABASE_URL,
                  filesystemPath: '/srv/application/internal.ts',
                  nested: { secret: 'M5_NESTED_5XX_CANARY_8B27' },
                },
                500,
                { cause: new Error('M5_5XX_CAUSE_CANARY_2C94') },
              );
            };
          }

          if (MODE === HTTP_BOUNDARY_MODE) {
            const taskService = app.get(TaskService);
            const createTask = taskService.create.bind(taskService);
            taskService.create = (title) => {
              marker('M5_BOUNDARY_BUSINESS_ENTERED');
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
