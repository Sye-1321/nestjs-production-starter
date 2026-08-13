import assert from 'node:assert/strict';
import test from 'node:test';

import { DatabaseService } from '../../dist/platform/database/database.service.js';
import { createPoolConfig } from '../../dist/platform/database/pool-config.js';

const CONFIG = Object.freeze({
  nodeEnv: 'test',
  port: 3000,
  logLevel: 'info',
  databaseUrl: 'postgresql://db.example.test/app',
  dbPoolMax: 7,
  dbAcquireTimeoutMs: 1250,
  dbStatementTimeoutMs: 4321,
  shutdownTimeoutMs: 10_000,
});

function serviceDouble({
  query = async () => ({ rows: [] }),
  disconnect = async () => undefined,
  end = async () => undefined,
} = {}) {
  const pool = {
    queryCalls: [],
    endCalls: 0,
    async query(sql) {
      this.queryCalls.push(sql);
      return query(sql);
    },
    async end() {
      this.endCalls += 1;
      return end();
    },
  };
  const prisma = {
    disconnectCalls: 0,
    async $disconnect() {
      this.disconnectCalls += 1;
      return disconnect();
    },
  };
  const cleanupFailures = [];
  const logger = {
    databaseCleanupFailed(phase, error) {
      cleanupFailures.push({ phase, error });
    },
  };

  return {
    pool,
    prisma,
    cleanupFailures,
    service: new DatabaseService(pool, prisma, logger),
  };
}

test('pool config maps only the required bounded database settings', () => {
  const poolConfig = createPoolConfig(CONFIG);

  assert.deepEqual(poolConfig, {
    connectionString: CONFIG.databaseUrl,
    max: CONFIG.dbPoolMax,
    connectionTimeoutMillis: CONFIG.dbAcquireTimeoutMs,
    statement_timeout: CONFIG.dbStatementTimeoutMs,
    application_name: 'nestjs-production-starter',
  });
  assert.ok(poolConfig.connectionTimeoutMillis > 0);
  assert.equal('query_timeout' in poolConfig, false);
});

test('probe executes SELECT 1 through the owned pool', async () => {
  const { pool, service } = serviceDouble();

  await service.probe();

  assert.deepEqual(pool.queryCalls, ['SELECT 1']);
});

test('prisma exposes the one injected long-lived client', () => {
  const { prisma, service } = serviceDouble();
  assert.equal(service.prisma, prisma);
  assert.equal(service.prisma, service.prisma);
});

test('cleanup disconnects Prisma before ending the external pool', async () => {
  const order = [];
  const { pool, prisma, service } = serviceDouble({
    disconnect: async () => {
      order.push('prisma');
    },
    end: async () => {
      order.push('pool');
    },
  });

  await service.onApplicationShutdown();

  assert.deepEqual(order, ['prisma', 'pool']);
  assert.equal(prisma.disconnectCalls, 1);
  assert.equal(pool.endCalls, 1);
});

test('cleanup still ends the pool when Prisma disconnect rejects', async () => {
  const disconnectCanary = 'DATABASE_DISCONNECT_CANARY_3A91';
  const order = [];
  const { pool, prisma, cleanupFailures, service } = serviceDouble({
    disconnect: async () => {
      order.push('prisma');
      throw new Error(disconnectCanary);
    },
    end: async () => {
      order.push('pool');
    },
  });

  await assert.rejects(service.onApplicationShutdown(), (error) => {
    assert.equal(error.message, 'Database cleanup failed');
    assert.equal(error.message.includes(disconnectCanary), false);
    return true;
  });

  assert.deepEqual(order, ['prisma', 'pool']);
  assert.equal(prisma.disconnectCalls, 1);
  assert.equal(pool.endCalls, 1);
  assert.equal(cleanupFailures.length, 1);
  assert.equal(cleanupFailures[0].phase, 'prisma_disconnect');
});

test('cleanup attempts both phases and rejects safely when both fail', async () => {
  const { pool, prisma, cleanupFailures, service } = serviceDouble({
    disconnect: async () => {
      throw new TypeError('PRISMA_SECRET_MESSAGE');
    },
    end: async () => {
      throw new RangeError('POOL_SECRET_MESSAGE');
    },
  });

  await assert.rejects(service.onApplicationShutdown(), {
    message: 'Database cleanup failed',
  });

  assert.equal(prisma.disconnectCalls, 1);
  assert.equal(pool.endCalls, 1);
  assert.deepEqual(
    cleanupFailures.map(({ phase }) => phase),
    ['prisma_disconnect', 'pool_end'],
  );
});

test('cleanup is idempotent after success', async () => {
  const { pool, prisma, service } = serviceDouble();

  await Promise.all([
    service.onApplicationShutdown(),
    service.onApplicationShutdown(),
    service.onApplicationShutdown(),
  ]);
  await service.onApplicationShutdown();

  assert.equal(prisma.disconnectCalls, 1);
  assert.equal(pool.endCalls, 1);
});

test('cleanup is idempotent after failure', async () => {
  const { pool, prisma, service } = serviceDouble({
    disconnect: async () => {
      throw new Error('hidden');
    },
  });

  const first = service.onApplicationShutdown();
  const second = service.onApplicationShutdown();
  assert.equal(first, second);

  await assert.rejects(first, { message: 'Database cleanup failed' });
  await assert.rejects(service.onApplicationShutdown(), {
    message: 'Database cleanup failed',
  });

  assert.equal(prisma.disconnectCalls, 1);
  assert.equal(pool.endCalls, 1);
});
