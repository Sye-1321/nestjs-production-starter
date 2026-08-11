import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';

import {
  BOOTING_FIXTURE,
  BOOTING_MARKER_WAIT_MS,
  EXIT_WAIT_MS,
  getAvailablePort,
  registerChildCleanup,
  spawnEntry,
  startPortMonitor,
  structuredEvents,
  validEnvironment,
  waitForExit,
  waitForOutput,
} from './support/process-test-helpers.mjs';

const MARKER = 'PROCESS_TEST_BOOTING_PAUSED';
const linuxOnly =
  process.platform === 'linux' ? false : 'requires authoritative Linux SIGTERM';

test(
  'SIGTERM during controlled BOOTING pause prevents later listen',
  { skip: linuxOnly },
  async (t) => {
    const port = await getAvailablePort();
    const monitor = startPortMonitor(port);
    t.after(() => monitor.stop());

    const environment = validEnvironment(port);
    const { child, output: getOutput } = spawnEntry(
      BOOTING_FIXTURE,
      environment,
    );
    registerChildCleanup(t, child);

    await waitForOutput(getOutput, MARKER, BOOTING_MARKER_WAIT_MS);
    assert.equal(monitor.wasReachable(), false);

    assert.equal(child.kill('SIGTERM'), true);

    const exit = await waitForExit(child, EXIT_WAIT_MS);
    const wasReachable = await monitor.stop();
    const capturedOutput = getOutput();

    assert.equal(exit.code, 0);
    assert.equal(exit.signal, null);
    assert.equal(wasReachable, false);
    assert.equal(structuredEvents(capturedOutput, 'startup_failed').length, 0);
    assert.equal(structuredEvents(capturedOutput, 'shutdown_failed').length, 0);
  },
);
