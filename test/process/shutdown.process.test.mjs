import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';

import {
  MAIN_ENTRY,
  SHUTDOWN_TOLERANCE_MS,
  TEST_SHUTDOWN_TIMEOUT_MS,
  getAvailablePort,
  registerChildCleanup,
  spawnEntry,
  structuredEvents,
  validEnvironment,
  waitForExit,
  waitForStatus,
  waitForPortClosed,
} from './support/process-test-helpers.mjs';

const linuxOnly =
  process.platform === 'linux' ? false : 'requires authoritative Linux SIGTERM';

test(
  'idle SIGTERM drains and exits naturally',
  { skip: linuxOnly },
  async (t) => {
    const port = await getAvailablePort();
    const environment = validEnvironment(port);
    const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
    registerChildCleanup(t, child);

    await waitForStatus(port, '/health/live', 200);

    const shutdownStartedAt = Date.now();
    assert.equal(child.kill('SIGTERM'), true);

    await waitForPortClosed(port, SHUTDOWN_TOLERANCE_MS);
    const exit = await waitForExit(
      child,
      TEST_SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TOLERANCE_MS,
    );
    const elapsedMs = Date.now() - shutdownStartedAt;

    assert.equal(exit.code, 0);
    assert.equal(exit.signal, null);
    assert.ok(
      elapsedMs <= TEST_SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TOLERANCE_MS,
      `idle shutdown exceeded ${String(TEST_SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TOLERANCE_MS)} ms`,
    );

    const capturedOutput = getOutput();
    assert.equal(structuredEvents(capturedOutput, 'shutdown_failed').length, 0);
    assert.equal(structuredEvents(capturedOutput, 'startup_failed').length, 0);
  },
);
