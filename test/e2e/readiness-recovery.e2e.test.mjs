import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { Client } from 'pg';
import { getContainerRuntimeClient } from 'testcontainers';

import {
  MAIN_ENTRY,
  getAvailablePort,
  registerChildCleanup,
  requestHttp,
  requestPath,
  spawnEntry,
  structuredEvents,
  validEnvironment,
  waitForStatus,
} from '../process/support/process-test-helpers.mjs';
import { requiredTestDatabaseUrl } from '../support/database-test-fixture.mjs';

const OUTAGE_REQUEST_ID = 'm4-postgresql-outage';
const RECOVERY_REQUEST_ID = 'm4-postgresql-recovery';

function requiredContainerId() {
  const containerId = process.env.POSTGRES_TEST_CONTAINER_ID;
  if (containerId === undefined) {
    throw new Error(
      'POSTGRES_TEST_CONTAINER_ID is required; run through the PostgreSQL test harness',
    );
  }
  return containerId;
}

function postTask(port, title, requestId) {
  const body = JSON.stringify({ title });
  return requestHttp(port, {
    pathname: '/v1/tasks',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      'x-request-id': requestId,
    },
    body,
  });
}

async function dependencyReadyMetric(port) {
  const response = await requestHttp(port, { pathname: '/metrics' });
  assert.equal(response.statusCode, 200);
  const match = /^service_dependency_ready ([01])$/mu.exec(response.body);
  assert.notEqual(match, null);
  return Number(match[1]);
}

async function waitForPostgreSql() {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const client = new Client({
      connectionString: requiredTestDatabaseUrl(),
      connectionTimeoutMillis: 500,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return;
    } catch {
      await delay(50);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  throw new Error('PostgreSQL did not accept connections after restart');
}

test('readiness and Task operations recover after the same PostgreSQL container restarts', async (t) => {
  const runtime = await getContainerRuntimeClient();
  const databaseContainer = runtime.container.getById(requiredContainerId());
  let databaseStopped = false;

  t.after(async () => {
    if (databaseStopped) {
      await runtime.container.start(databaseContainer);
    }
  });

  const port = await getAvailablePort();
  const environment = validEnvironment(port, {
    LOG_LEVEL: 'info',
    DB_ACQUIRE_TIMEOUT_MS: '200',
  });
  const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);
  const applicationPid = child.pid;

  let initialReady;
  try {
    initialReady = await waitForStatus(port, '/health/ready', 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`${message}; childOutput=${JSON.stringify(getOutput())}`, {
      cause: error,
    });
  }
  assert.deepEqual(JSON.parse(initialReady.body), { status: 'ready' });
  assert.equal(await dependencyReadyMetric(port), 1);

  await runtime.container.stop(databaseContainer);
  databaseStopped = true;

  const unavailableReady = await waitForStatus(port, '/health/ready', 503);
  assert.deepEqual(JSON.parse(unavailableReady.body), { status: 'not_ready' });
  assert.equal(await dependencyReadyMetric(port), 0);
  assert.equal(child.exitCode, null);
  assert.equal(child.pid, applicationPid);

  const liveDuringOutage = await requestPath(port, '/health/live');
  assert.equal(liveDuringOutage.statusCode, 200);
  assert.deepEqual(JSON.parse(liveDuringOutage.body), { status: 'live' });

  const unavailableTask = await postTask(
    port,
    'Task attempted during PostgreSQL outage',
    OUTAGE_REQUEST_ID,
  );
  assert.equal(unavailableTask.statusCode, 503);
  assert.match(
    unavailableTask.headers['content-type'],
    /^application\/problem\+json(?:;|$)/u,
  );
  assert.deepEqual(JSON.parse(unavailableTask.body), {
    type: 'urn:nestjs-production-starter:problem:dependency-unavailable',
    title: 'Service temporarily unavailable',
    status: 503,
    detail: 'The service is temporarily unavailable.',
    code: 'DEPENDENCY_UNAVAILABLE',
    requestId: OUTAGE_REQUEST_ID,
  });

  await runtime.container.start(databaseContainer);
  databaseStopped = false;
  await waitForPostgreSql();

  const recoveredReady = await waitForStatus(port, '/health/ready', 200);
  assert.deepEqual(JSON.parse(recoveredReady.body), { status: 'ready' });
  assert.equal(await dependencyReadyMetric(port), 1);
  assert.equal(child.exitCode, null);
  assert.equal(child.pid, applicationPid);

  const recoveredTask = await postTask(
    port,
    'Task created after PostgreSQL recovery',
    RECOVERY_REQUEST_ID,
  );
  assert.equal(recoveredTask.statusCode, 201);
  assert.equal(
    JSON.parse(recoveredTask.body).title,
    'Task created after PostgreSQL recovery',
  );

  const output = getOutput();
  assert.equal(structuredEvents(output, 'startup_failed').length, 0);
  assert.equal(
    structuredEvents(output, 'http_request_failed').some(
      (event) => event.request_id === OUTAGE_REQUEST_ID,
    ),
    false,
  );
  for (const forbidden of [
    process.env.POSTGRES_TEST_DATABASE_URL,
    'Connection terminated unexpectedly',
    'ECONNREFUSED',
    'timeout exceeded when trying to connect',
    'SELECT 1',
    'PrismaClient',
  ]) {
    assert.equal(output.includes(forbidden), false, forbidden);
    assert.equal(unavailableTask.body.includes(forbidden), false, forbidden);
  }
});
