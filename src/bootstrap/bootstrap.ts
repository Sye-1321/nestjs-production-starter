import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';

import { AppModule } from '../app.module.js';
import type { AppConfig } from '../config/config.types.js';
import type { ReadinessProbe } from '../platform/health/readiness-probe.js';
import { BootstrapLogger } from './bootstrap-logger.js';
import { Lifecycle } from './lifecycle.js';
import { ShutdownCoordinator } from './shutdown-coordinator.js';

export interface BootstrapOptions {
  readonly config: AppConfig;
  readonly logger: BootstrapLogger;
  readonly readinessProbe?: ReadinessProbe;
}

function isBooting(lifecycle: Lifecycle): boolean {
  return lifecycle.state === 'BOOTING';
}

export async function bootstrap(options: BootstrapOptions): Promise<void> {
  const lifecycle = new Lifecycle();
  let app: INestApplication | undefined;
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
    app = await NestFactory.create(
      AppModule.forRoot(options.config, lifecycle, options.readinessProbe),
      {
        abortOnError: false,
        logger: false,
      },
    );

    if (!isBooting(lifecycle)) {
      return;
    }

    await app.init();
    server = app.getHttpServer() as Server;

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
