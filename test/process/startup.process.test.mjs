import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAIN_ENTRY,
  EXIT_WAIT_MS,
  getAvailablePort,
  registerChildCleanup,
  requestHttp,
  requestPath,
  spawnEntry,
  startPortMonitor,
  structuredEvents,
  validEnvironment,
  waitForExit,
  waitForPortClosed,
  waitForStatus,
} from './support/process-test-helpers.mjs';

test('invalid required configuration exits non-zero without ever serving', async (t) => {
  const port = await getAvailablePort();
  const monitor = startPortMonitor(port);
  t.after(() => monitor.stop());

  const environment = validEnvironment(port, { NODE_ENV: undefined });
  const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);

  const exit = await waitForExit(child, EXIT_WAIT_MS, getOutput);
  const wasReachable = await monitor.stop();

  assert.equal(exit.code, 1);
  assert.equal(exit.signal, null);
  assert.equal(wasReachable, false);

  const startupEvents = structuredEvents(getOutput(), 'startup_failed');
  assert.equal(startupEvents.length, 1);
  assert.deepEqual(startupEvents[0], {
    event: 'startup_failed',
    kind: 'configuration',
    field: 'NODE_ENV',
    rule: 'is required',
  });
});

test('invalid DATABASE_URL never leaks its credential canary', async (t) => {
  const port = await getAvailablePort();
  const monitor = startPortMonitor(port);
  t.after(() => monitor.stop());

  const canary = 'process-db-credential-canary-DO-NOT-LEAK';
  const databaseUrl = `postgresql://user:${canary}@`;
  const environment = validEnvironment(port, { DATABASE_URL: databaseUrl });
  const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);

  const exit = await waitForExit(child, EXIT_WAIT_MS, getOutput);
  const wasReachable = await monitor.stop();
  const output = getOutput();

  assert.equal(exit.code, 1);
  assert.equal(exit.signal, null);
  assert.equal(wasReachable, false);
  assert.equal(output.includes(canary), false);
  assert.equal(output.includes(databaseUrl), false);

  const startupEvents = structuredEvents(output, 'startup_failed');
  assert.equal(startupEvents.length, 1);
  assert.deepEqual(startupEvents[0], {
    event: 'startup_failed',
    kind: 'configuration',
    field: 'DATABASE_URL',
    rule: 'must be a valid PostgreSQL connection URL',
  });
});

test('PostgreSQL unavailable at startup prevents listen and leaks no database details', async (t) => {
  const applicationPort = await getAvailablePort();
  let databasePort = await getAvailablePort();
  while (databasePort === applicationPort) {
    databasePort = await getAvailablePort();
  }
  await waitForPortClosed(databasePort, 500);

  const monitor = startPortMonitor(applicationPort);
  t.after(() => monitor.stop());

  const credentialCanary = 'startup-db-password-canary-DO-NOT-LEAK';
  const databaseUrl = `postgresql://process_user:${credentialCanary}@127.0.0.1:${String(databasePort)}/startup_failure`;
  const environment = validEnvironment(applicationPort, {
    DATABASE_URL: databaseUrl,
    DB_ACQUIRE_TIMEOUT_MS: '100',
  });
  const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);

  const exit = await waitForExit(child, EXIT_WAIT_MS, getOutput);
  const wasReachable = await monitor.stop();
  const output = getOutput();

  assert.notEqual(exit.code, 0);
  assert.equal(exit.signal, null);
  assert.equal(wasReachable, false);

  const startupEvents = structuredEvents(output, 'startup_failed');
  assert.equal(startupEvents.length, 1);
  assert.deepEqual(startupEvents[0], {
    event: 'startup_failed',
    kind: 'bootstrap',
  });

  for (const forbidden of [
    credentialCanary,
    databaseUrl,
    `127.0.0.1:${String(databasePort)}`,
    'ECONNREFUSED',
    'SELECT 1',
    '@prisma',
    'PrismaClient',
  ]) {
    assert.equal(output.includes(forbidden), false, forbidden);
  }
});

test('startup PostgreSQL probe succeeds before listen and health endpoints are ready', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port);
  const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);

  const live = await waitForStatus(port, '/health/live', 200);
  assert.deepEqual(JSON.parse(live.body), { status: 'live' });

  const ready = await requestPath(port, '/health/ready');
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(JSON.parse(ready.body), { status: 'ready' });

  const metrics = await requestHttp(port, { pathname: '/metrics' });
  assert.equal(metrics.statusCode, 200);
  assert.match(
    metrics.headers['content-type'] ?? '',
    /^text\/plain; charset=utf-8; version=0\.0\.4$/u,
  );
  for (const metricName of [
    'http_server_requests_total',
    'http_server_request_duration_seconds',
    'tasks_created_total',
    'service_dependency_ready',
  ]) {
    assert.match(metrics.body, new RegExp(`# HELP ${metricName} `, 'u'));
  }

  assert.equal(structuredEvents(getOutput(), 'startup_failed').length, 0);
});
