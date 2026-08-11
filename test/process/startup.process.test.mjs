import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAIN_ENTRY,
  EXIT_WAIT_MS,
  getAvailablePort,
  registerChildCleanup,
  requestPath,
  spawnEntry,
  startPortMonitor,
  structuredEvents,
  validEnvironment,
  waitForExit,
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

test('live is 200 and M1 readiness fails closed with no database probe', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port);
  const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);

  const live = await waitForStatus(port, '/health/live', 200);
  assert.deepEqual(JSON.parse(live.body), { status: 'live' });

  const ready = await requestPath(port, '/health/ready');
  assert.equal(ready.statusCode, 503);

  assert.equal(structuredEvents(getOutput(), 'startup_failed').length, 0);
});
