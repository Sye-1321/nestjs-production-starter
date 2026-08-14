import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { GenericContainer, Network } from 'testcontainers';

/* global AbortSignal, fetch */

const execFileAsync = promisify(execFile);
const image = process.env.CONTAINER_TEST_IMAGE;
const POSTGRES_IMAGE = 'postgres:18.4-bookworm';
const APPLICATION_PORT = 3000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 25;
const PRISMA_CLI = path.join(
  process.cwd(),
  'node_modules',
  'prisma',
  'build',
  'index.js',
);

if (image === undefined || image === '') {
  throw new Error('CONTAINER_TEST_IMAGE is required');
}

test('final image receives SIGTERM through PID 1 and drains active work naturally', async (t) => {
  const cleanup = [];
  t.after(async () => {
    for (const operation of cleanup.toReversed()) {
      await bestEffort(operation);
    }
  });

  const network = await new Network().start();
  cleanup.push(() => network.stop());

  const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withNetwork(network)
    .withNetworkAliases('postgres')
    .start();
  cleanup.push(() => postgres.stop());

  await migrate(postgres.getConnectionUri());

  let output = '';
  const application = await new GenericContainer(image)
    .withNetwork(network)
    .withExposedPorts(APPLICATION_PORT)
    .withEnvironment({
      NODE_ENV: 'production',
      PORT: String(APPLICATION_PORT),
      LOG_LEVEL: 'info',
      DATABASE_URL: `postgresql://${postgres.getUsername()}:${postgres.getPassword()}@postgres:5432/${postgres.getDatabase()}`,
      DB_POOL_MAX: '2',
      DB_ACQUIRE_TIMEOUT_MS: '1000',
      DB_STATEMENT_TIMEOUT_MS: '10000',
      SHUTDOWN_TIMEOUT_MS: String(SHUTDOWN_TIMEOUT_MS),
    })
    .withLogConsumer((stream) => {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        output += chunk;
      });
    })
    .withStartupTimeout(30_000)
    .start();
  cleanup.push(() => application.stop({ timeout: 0 }));

  const port = application.getMappedPort(APPLICATION_PORT);
  await waitForHttpStatus(port, '/health/ready', 200);

  const initProcess = await application.exec(['cat', '/proc/1/comm']);
  assert.equal(initProcess.exitCode, 0);
  assert.equal(initProcess.output.trim(), 'dumb-init');
  const childProcesses = await application.exec([
    'cat',
    '/proc/1/task/1/children',
  ]);
  assert.equal(childProcesses.exitCode, 0);
  const childPid = childProcesses.output.trim().split(/\s+/u)[0];
  assert.match(childPid ?? '', /^\d+$/u);
  const nodeProcess = await application.exec([
    'sh',
    '-c',
    `tr '\\000' ' ' </proc/${childPid}/cmdline`,
  ]);
  assert.equal(nodeProcess.exitCode, 0);
  assert.equal(nodeProcess.output.trim(), 'node dist/main.js');

  const pool = new Pool({ connectionString: postgres.getConnectionUri() });
  const poolErrors = [];
  pool.on('error', (error) => poolErrors.push(error));
  const lockClient = await pool.connect();
  let lockClientReleased = false;
  cleanup.push(async () => {
    if (!lockClientReleased) {
      await bestEffort(() => lockClient.query('ROLLBACK'));
      lockClient.release();
    }

    await bestEffort(() => pool.end());
  });
  await lockClient.query('BEGIN');
  await lockClient.query('LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE');

  const activeRequest = postTask(port, 'container SIGTERM drain evidence');
  await waitForBlockedTaskQuery(pool);

  const startedAt = performance.now();
  await execFileAsync('docker', [
    'kill',
    '--signal=SIGTERM',
    application.getId(),
  ]);

  await waitFor(() => output.includes('"event":"shutdown_started"'));
  assert.match(output, /"event":"shutdown_started","state":"DRAINING"/u);
  await assert.rejects(
    requestWithDeadline(port, '/health/live', 500),
    /fetch failed|aborted|timeout/u,
  );

  await lockClient.query('ROLLBACK');
  lockClient.release();
  lockClientReleased = true;
  const activeResponse = await activeRequest;
  assert.equal(activeResponse.status, 201);
  assert.equal(
    (await activeResponse.json()).title,
    'container SIGTERM drain evidence',
  );

  const { stdout: waitOutput } = await execFileAsync('docker', [
    'wait',
    application.getId(),
  ]);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(waitOutput.trim(), '0');
  assert.ok(elapsedMs < SHUTDOWN_TIMEOUT_MS + 2_000, elapsedMs);
  assert.equal(output.includes('"event":"forced_shutdown"'), false);
  assert.deepEqual(poolErrors, []);
  t.diagnostic(`container_sigterm_drain_ms=${elapsedMs.toFixed(1)}`);
});

async function migrate(databaseUrl) {
  await execFileAsync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

async function waitForBlockedTaskQuery(pool) {
  await waitFor(async () => {
    const result = await pool.query({
      text: `
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity activity
          JOIN pg_locks locks ON locks.pid = activity.pid
          WHERE activity.application_name = 'nestjs-production-starter'
            AND activity.state = 'active'
            AND locks.granted = false
        ) AS blocked
      `,
    });
    return result.rows[0]?.blocked === true;
  });
}

async function waitForHttpStatus(port, pathname, expectedStatus) {
  await waitFor(async () => {
    try {
      const response = await requestWithDeadline(port, pathname, 500);
      await response.body?.cancel();
      return response.status === expectedStatus;
    } catch {
      return false;
    }
  });
}

function postTask(port, title) {
  return fetch(`http://127.0.0.1:${String(port)}/v1/tasks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'container-sigterm-active-task',
    },
    body: JSON.stringify({ title }),
  });
}

function requestWithDeadline(port, pathname, timeoutMs) {
  return fetch(`http://127.0.0.1:${String(port)}${pathname}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`Condition not met within ${String(timeoutMs)} ms`);
}

async function bestEffort(operation) {
  try {
    await operation();
  } catch {
    // Cleanup preserves the original test result.
  }
}
