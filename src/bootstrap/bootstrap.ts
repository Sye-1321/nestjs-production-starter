import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';

import { AppModule } from '../app.module.js';
import type { AppConfig } from '../config/config.types.js';
import { DrainingGateMiddleware } from '../platform/context/draining-gate.middleware.js';
import { RequestContextMiddleware } from '../platform/context/request-context.middleware.js';
import { DatabaseService } from '../platform/database/database.service.js';
import { BodyParserErrorMiddleware } from '../platform/errors/body-parser-error.middleware.js';
import { ProblemDetailsExceptionFilter } from '../platform/errors/problem-details-exception.filter.js';
import { StrictValidationPipe } from '../platform/errors/strict-validation.pipe.js';
import { TaskContentTypeMiddleware } from '../platform/errors/task-content-type.middleware.js';
import { RequestLoggingMiddleware } from '../platform/logging/request-logging.middleware.js';
import { RequestMetricsMiddleware } from '../platform/metrics/request-metrics.middleware.js';
import { BootstrapLogger } from './bootstrap-logger.js';
import {
  configureHttpApplication,
  configureHttpServer,
} from './http-server.js';
import { Lifecycle } from './lifecycle.js';
import { ShutdownCoordinator } from './shutdown-coordinator.js';

export interface BootstrapProcessTestSeam {
  afterSignalHandlersInstalled(isBooting: () => boolean): Promise<void>;
}

export interface BootstrapOptions {
  readonly config: AppConfig;
  readonly logger: BootstrapLogger;
  readonly processTestSeam?: BootstrapProcessTestSeam;
}

function isBooting(lifecycle: Lifecycle): boolean {
  return lifecycle.state === 'BOOTING';
}

export async function bootstrap(options: BootstrapOptions): Promise<void> {
  const lifecycle = new Lifecycle();
  let app: NestExpressApplication | undefined;
  let server: Server | undefined;
  let releasePreListen: (() => void) | undefined;
  let preListenReleased = false;

  const preListenSettled = new Promise<void>((resolve) => {
    releasePreListen = resolve;
  });

  const releasePreListenBarrier = (): void => {
    if (preListenReleased) {
      return;
    }

    preListenReleased = true;
    releasePreListen?.();
  };

  const coordinator = new ShutdownCoordinator({
    lifecycle,
    shutdownTimeoutMs: options.config.shutdownTimeoutMs,
    executeShutdown: async () => {
      await preListenSettled;
      await closeApplicationResources(server, app);
    },
    onShutdownFailure: () => {
      options.logger.shutdownFailed();
      process.exitCode = 1;
    },
  });

  coordinator.installSignalHandlers();

  try {
    await options.processTestSeam?.afterSignalHandlersInstalled(() =>
      isBooting(lifecycle),
    );

    if (!isBooting(lifecycle)) {
      return;
    }

    app = await NestFactory.create<NestExpressApplication>(
      AppModule.forRoot(options.config, lifecycle),
      {
        abortOnError: false,
        bodyParser: false,
        logger: false,
      },
    );

    if (!isBooting(lifecycle)) {
      return;
    }

    const databaseService = app.get(DatabaseService);
    const requestContextMiddleware = app.get(RequestContextMiddleware);
    const requestMetricsMiddleware = app.get(RequestMetricsMiddleware);
    const requestLoggingMiddleware = app.get(RequestLoggingMiddleware);
    const drainingGateMiddleware = app.get(DrainingGateMiddleware);
    const taskContentTypeMiddleware = app.get(TaskContentTypeMiddleware);
    const bodyParserErrorMiddleware = app.get(BodyParserErrorMiddleware);
    const strictValidationPipe = app.get(StrictValidationPipe);
    const problemDetailsExceptionFilter = app.get(
      ProblemDetailsExceptionFilter,
    );
    server = app.getHttpServer();
    configureHttpServer(server);
    configureHttpApplication(
      app,
      requestContextMiddleware,
      requestMetricsMiddleware,
      requestLoggingMiddleware,
      drainingGateMiddleware,
      taskContentTypeMiddleware,
      bodyParserErrorMiddleware,
    );
    app.useGlobalPipes(strictValidationPipe);
    app.useGlobalFilters(problemDetailsExceptionFilter);
    await app.init();

    if (!isBooting(lifecycle)) {
      return;
    }

    await databaseService.probe();

    if (!isBooting(lifecycle)) {
      return;
    }

    await app.listen(options.config.port);

    if (!isBooting(lifecycle)) {
      return;
    }

    lifecycle.markReady();
  } catch (error) {
    if (isBooting(lifecycle)) {
      lifecycle.markFailedStart();
    }

    throw error;
  } finally {
    releasePreListenBarrier();

    if (lifecycle.state === 'FAILED_START') {
      coordinator.removeSignalHandlers();
      await bestEffortCleanup(server, app);
    }
  }
}

async function closeApplicationResources(
  server: Server | undefined,
  app: INestApplication | undefined,
): Promise<void> {
  let firstFailure: unknown;

  try {
    await closeHttpServer(server);
  } catch (error) {
    firstFailure = error;
  }

  try {
    await app?.close();
  } catch (error) {
    firstFailure ??= error;
  }

  if (firstFailure !== undefined) {
    if (firstFailure instanceof Error) {
      throw firstFailure;
    }

    throw new Error('Application cleanup failed');
  }
}

async function bestEffortCleanup(
  server: Server | undefined,
  app: INestApplication | undefined,
): Promise<void> {
  try {
    await closeHttpServer(server);
  } catch {
    // Best effort only.
  }

  try {
    await app?.close();
  } catch {
    // Best effort only.
  }
}

function closeHttpServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
