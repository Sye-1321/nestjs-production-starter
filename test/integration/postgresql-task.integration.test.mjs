import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { Client } from 'pg';

import {
  DatabaseUnavailableError,
  isObservedPrismaPgPoolAcquisitionTimeout,
  isObservedPrismaPgTaskStatementTimeout,
} from '../../dist/platform/database/database.errors.js';
import { TaskNotFoundError } from '../../dist/task/task.errors.js';
import {
  createDatabaseTestFixture,
  requiredTestDatabaseUrl,
} from '../support/database-test-fixture.mjs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACQUIRE_TIMEOUT_MS = 200;
const MINIMUM_TIMEOUT_MS = 140;
const MAXIMUM_TIMEOUT_MS = 700;
const STATEMENT_TIMEOUT_MS = 200;
const MAXIMUM_STATEMENT_TIMEOUT_MS = 2_000;

test('external migrate deploy produces the exact Task schema from an empty database', async (t) => {
  const fixture = createDatabaseTestFixture();
  t.after(() => fixture.cleanup());

  const migrations = await fixture.pool.query({
    text: `
      SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations
      ORDER BY migration_name
    `,
  });
  assert.equal(migrations.rowCount, 1);
  assert.equal(migrations.rows[0].migration_name, '20260813160000_init_task');
  assert.equal(migrations.rows[0].finished_at instanceof Date, true);
  assert.equal(migrations.rows[0].rolled_back_at, null);

  const columns = await fixture.pool.query({
    text: `
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks'
      ORDER BY ordinal_position
    `,
  });
  assert.deepEqual(columns.rows, [
    {
      column_name: 'id',
      data_type: 'uuid',
      character_maximum_length: null,
      is_nullable: 'NO',
    },
    {
      column_name: 'title',
      data_type: 'character varying',
      character_maximum_length: 200,
      is_nullable: 'NO',
    },
    {
      column_name: 'created_at',
      data_type: 'timestamp with time zone',
      character_maximum_length: null,
      is_nullable: 'NO',
    },
  ]);
});

test('real Task service and repository create, persist, read, and miss through the shared stack', async (t) => {
  const fixture = createDatabaseTestFixture();
  t.after(() => fixture.cleanup());
  const submittedTitle = '  real PostgreSQL task  ';

  const created = await fixture.taskService.create(submittedTitle);

  assert.deepEqual(Object.keys(created).sort(), ['createdAt', 'id', 'title']);
  assert.match(created.id, UUID_PATTERN);
  assert.equal(created.title, 'real PostgreSQL task');
  assert.equal(created.createdAt instanceof Date, true);
  assert.equal(Number.isNaN(created.createdAt.getTime()), false);

  const persisted = await fixture.pool.query({
    text: 'SELECT id, title, created_at FROM tasks WHERE id = $1',
    values: [created.id],
  });
  assert.equal(persisted.rowCount, 1);
  assert.equal(persisted.rows[0].id, created.id);
  assert.equal(persisted.rows[0].title, 'real PostgreSQL task');
  assert.deepEqual(persisted.rows[0].created_at, created.createdAt);

  const found = await fixture.taskService.findById(created.id);
  assert.deepEqual(found, created);

  await assert.rejects(
    fixture.taskService.findById(randomUUID()),
    (error) => error instanceof TaskNotFoundError,
  );
});

test('real pool acquisition timeout is bounded, drains waiters, classifies narrowly, and recovers', async (t) => {
  const fixture = createDatabaseTestFixture({
    dbPoolMax: 1,
    dbAcquireTimeoutMs: ACQUIRE_TIMEOUT_MS,
  });
  let heldClient = await fixture.pool.connect();
  const timings = [];
  const waitingCounts = [];

  t.after(async () => {
    heldClient?.release();
    heldClient = undefined;
    await fixture.cleanup();
  });

  async function observeWait(promise) {
    const startedPromise = Promise.resolve(promise);
    const observationDeadline = performance.now() + 1_000;
    while (
      fixture.pool.waitingCount !== 1 &&
      performance.now() < observationDeadline
    ) {
      await delay(5);
    }
    waitingCounts.push(fixture.pool.waitingCount);
    assert.equal(fixture.pool.waitingCount, 1);
    return startedPromise;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = performance.now();
    let error;
    try {
      await observeWait(fixture.pool.connect());
    } catch (caught) {
      error = caught;
    }
    const elapsedMs = performance.now() - startedAt;
    timings.push(elapsedMs);

    assert.equal(error?.constructor, Error);
    assert.deepEqual(Object.getOwnPropertyNames(error).sort(), [
      'message',
      'stack',
    ]);
    assert.equal(error.message, 'timeout exceeded when trying to connect');
    assert.ok(elapsedMs >= MINIMUM_TIMEOUT_MS, elapsedMs);
    assert.ok(elapsedMs <= MAXIMUM_TIMEOUT_MS, elapsedMs);
    waitingCounts.push(fixture.pool.waitingCount);
    assert.equal(fixture.pool.waitingCount, 0);
  }

  const prismaStartedAt = performance.now();
  let prismaError;
  try {
    await observeWait(
      fixture.prisma.task.findUnique({
        where: { id: randomUUID() },
      }),
    );
  } catch (caught) {
    prismaError = caught;
  }
  const prismaElapsedMs = performance.now() - prismaStartedAt;
  timings.push(prismaElapsedMs);

  assert.equal(prismaError?.constructor, Error);
  assert.deepEqual(Object.getOwnPropertyNames(prismaError).sort(), [
    'clientVersion',
    'message',
    'stack',
  ]);
  assert.equal(prismaError.message, 'timeout exceeded when trying to connect');
  assert.equal(isObservedPrismaPgPoolAcquisitionTimeout(prismaError), true);
  assert.ok(prismaElapsedMs >= MINIMUM_TIMEOUT_MS, prismaElapsedMs);
  assert.ok(prismaElapsedMs <= MAXIMUM_TIMEOUT_MS, prismaElapsedMs);
  waitingCounts.push(fixture.pool.waitingCount);
  assert.equal(fixture.pool.waitingCount, 0);

  const repositoryStartedAt = performance.now();
  const repositoryAttempt = fixture.taskRepository.findById(randomUUID());
  await assert.rejects(observeWait(repositoryAttempt), (error) => {
    return error instanceof DatabaseUnavailableError;
  });
  const repositoryElapsedMs = performance.now() - repositoryStartedAt;
  timings.push(repositoryElapsedMs);
  assert.ok(repositoryElapsedMs >= MINIMUM_TIMEOUT_MS, repositoryElapsedMs);
  assert.ok(repositoryElapsedMs <= MAXIMUM_TIMEOUT_MS, repositoryElapsedMs);
  waitingCounts.push(fixture.pool.waitingCount);
  assert.equal(fixture.pool.waitingCount, 0);

  heldClient.release();
  heldClient = undefined;
  const recovered = await fixture.pool.query('SELECT 1 AS value');
  assert.equal(recovered.rows[0].value, 1);
  assert.equal(fixture.pool.waitingCount, 0);
  assert.deepEqual(fixture.poolErrors, []);

  t.diagnostic(
    `acquisition_timings_ms=${timings.map((value) => value.toFixed(1)).join(',')}`,
  );
  t.diagnostic(`waiting_count_sequence=${waitingCounts.join(',')}`);
});

test('real PostgreSQL statement timeout classifies narrowly and leaves the shared pool healthy', async (t) => {
  const fixture = createDatabaseTestFixture({
    dbStatementTimeoutMs: STATEMENT_TIMEOUT_MS,
    dbAcquireTimeoutMs: 1_000,
  });
  const control = new Client({
    connectionString: requiredTestDatabaseUrl(),
    application_name: 'm5-statement-timeout-control',
  });
  let transactionOpen = false;

  t.after(async () => {
    if (transactionOpen) {
      await control.query('ROLLBACK');
    }
    await control.end();
    await fixture.cleanup();
  });

  await control.connect();
  await control.query('BEGIN');
  transactionOpen = true;
  await control.query('LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE');

  const rawStartedAt = performance.now();
  let rawError;
  try {
    await fixture.prisma.task.create({
      data: { title: 'M5 raw statement timeout' },
    });
  } catch (error) {
    rawError = error;
  }
  const rawElapsedMs = performance.now() - rawStartedAt;

  assert.equal(isObservedPrismaPgTaskStatementTimeout(rawError), true);
  assert.ok(rawElapsedMs >= MINIMUM_TIMEOUT_MS, rawElapsedMs);
  assert.ok(rawElapsedMs <= MAXIMUM_STATEMENT_TIMEOUT_MS, rawElapsedMs);

  const immediateProbe = await fixture.pool.query('SELECT 1 AS value');
  assert.equal(immediateProbe.rows[0].value, 1);
  assert.equal(fixture.pool.waitingCount, 0);
  assert.deepEqual(fixture.poolErrors, []);

  const staleWork = await control.query({
    text: `
      SELECT COUNT(*)::integer AS count
      FROM pg_stat_activity
      WHERE application_name = 'nestjs-production-starter'
        AND state = 'active'
    `,
  });
  assert.equal(staleWork.rows[0].count, 0);

  const mappedStartedAt = performance.now();
  await assert.rejects(
    fixture.taskRepository.create('M5 mapped statement timeout'),
    (error) => error instanceof DatabaseUnavailableError,
  );
  const mappedElapsedMs = performance.now() - mappedStartedAt;
  assert.ok(mappedElapsedMs >= MINIMUM_TIMEOUT_MS, mappedElapsedMs);
  assert.ok(mappedElapsedMs <= MAXIMUM_STATEMENT_TIMEOUT_MS, mappedElapsedMs);

  await control.query('ROLLBACK');
  transactionOpen = false;
  const recovered = await fixture.taskService.create(
    'M5 post-statement-timeout recovery',
  );
  assert.equal(recovered.title, 'M5 post-statement-timeout recovery');
  assert.equal(fixture.pool.waitingCount, 0);
  assert.deepEqual(fixture.poolErrors, []);

  t.diagnostic(
    `statement_timeout_ms=${rawElapsedMs.toFixed(1)} mapped_timeout_ms=${mappedElapsedMs.toFixed(1)}`,
  );
});
