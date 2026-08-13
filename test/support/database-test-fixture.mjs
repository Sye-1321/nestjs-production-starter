import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import process from 'node:process';

import { PrismaClient } from '../../dist/generated/prisma/client.js';
import { DatabaseService } from '../../dist/platform/database/database.service.js';
import { createPoolConfig } from '../../dist/platform/database/pool-config.js';
import { TaskRepository } from '../../dist/task/task.repository.js';
import { TaskService } from '../../dist/task/task.service.js';

const BASE_CONFIG = Object.freeze({
  nodeEnv: 'test',
  port: 3000,
  logLevel: 'silent',
  dbPoolMax: 4,
  dbAcquireTimeoutMs: 500,
  dbStatementTimeoutMs: 3000,
  shutdownTimeoutMs: 10_000,
});

export function requiredTestDatabaseUrl() {
  const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL;
  if (databaseUrl === undefined) {
    throw new Error(
      'POSTGRES_TEST_DATABASE_URL is required; run through the PostgreSQL test harness',
    );
  }
  return databaseUrl;
}

export function createDatabaseTestFixture(overrides = {}) {
  const config = Object.freeze({
    ...BASE_CONFIG,
    databaseUrl: requiredTestDatabaseUrl(),
    ...overrides,
  });
  const poolErrors = [];
  const cleanupFailures = [];
  const logger = {
    databasePoolError(error) {
      poolErrors.push(error);
    },
    databaseCleanupFailed(phase, error) {
      cleanupFailures.push({ phase, error });
    },
  };
  const pool = new Pool(createPoolConfig(config));
  pool.on('error', (error) => logger.databasePoolError(error));
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const databaseService = new DatabaseService(pool, prisma, logger);
  const taskRepository = new TaskRepository(databaseService);
  const taskService = new TaskService(taskRepository);

  return {
    config,
    pool,
    prisma,
    databaseService,
    taskRepository,
    taskService,
    poolErrors,
    cleanupFailures,
    async cleanup() {
      await databaseService.onApplicationShutdown();
    },
  };
}
