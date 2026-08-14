import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import test from 'node:test';

import {
  SHUTDOWN_FIXTURE,
  SHUTDOWN_TOLERANCE_MS,
  TEST_SHUTDOWN_TIMEOUT_MS,
  getAvailablePort,
  registerChildCleanup,
  requestHttp,
  spawnEntry,
  structuredEvents,
  validEnvironment,
  waitForExit,
  waitForOutput,
  waitForStatus,
  waitForPortClosed,
} from './support/process-test-helpers.mjs';

const linuxOnly =
  process.platform === 'linux' ? false : 'requires authoritative Linux SIGTERM';

const DRAINING_MARKER = 'M5_DRAINING';
const CLEANUP_STARTED_MARKER = 'M5_PROVIDER_CLEANUP_STARTED';
const CLEANUP_COMPLETED_MARKER = 'M5_PROVIDER_CLEANUP_COMPLETED';
const ACTIVE_ENTERED_MARKER = 'M5_ACTIVE_ENTERED';
const ACTIVE_RELEASED_MARKER = 'M5_ACTIVE_RELEASED';
const ACTIVE_COMPLETED_MARKER = 'M5_ACTIVE_COMPLETED';

function postTask(port, title) {
  const body = JSON.stringify({ title });
  return requestHttp(port, {
    pathname: '/v1/tasks',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body,
  });
}

test(
  'idle SIGTERM drains and exits naturally',
  { skip: linuxOnly },
  async (t) => {
    const port = await getAvailablePort();
    const environment = validEnvironment(port);
    const { child, output: getOutput } = spawnEntry(
      SHUTDOWN_FIXTURE,
      environment,
    );
    registerChildCleanup(t, child);

    await waitForStatus(port, '/health/live', 200, undefined, getOutput);

    const shutdownStartedAt = Date.now();
    assert.equal(child.kill('SIGTERM'), true);

    await waitForOutput(getOutput, DRAINING_MARKER, SHUTDOWN_TOLERANCE_MS);
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
    const drainingIndex = capturedOutput.indexOf(DRAINING_MARKER);
    const cleanupStartedIndex = capturedOutput.indexOf(CLEANUP_STARTED_MARKER);
    const cleanupCompletedIndex = capturedOutput.indexOf(
      CLEANUP_COMPLETED_MARKER,
    );
    assert.ok(drainingIndex >= 0);
    assert.ok(cleanupStartedIndex > drainingIndex);
    assert.ok(cleanupCompletedIndex > cleanupStartedIndex);
    assert.equal(structuredEvents(capturedOutput, 'shutdown_failed').length, 0);
    assert.equal(structuredEvents(capturedOutput, 'forced_shutdown').length, 0);
    assert.equal(structuredEvents(capturedOutput, 'startup_failed').length, 0);
  },
);

test(
  'active Task work completes before provider teardown and natural exit',
  { skip: linuxOnly },
  async (t) => {
    const port = await getAvailablePort();
    const environment = validEnvironment(port, {
      LOG_LEVEL: 'info',
      M5_SHUTDOWN_FIXTURE_MODE: 'active',
    });
    const { child, output: getOutput } = spawnEntry(
      SHUTDOWN_FIXTURE,
      environment,
      { input: true },
    );
    registerChildCleanup(t, child);

    await waitForStatus(port, '/health/live', 200, undefined, getOutput);
    const activeRequest = postTask(port, 'M5 graceful active request');
    await waitForOutput(
      getOutput,
      ACTIVE_ENTERED_MARKER,
      SHUTDOWN_TOLERANCE_MS,
    );

    const shutdownStartedAt = Date.now();
    assert.equal(child.kill('SIGTERM'), true);
    await waitForOutput(getOutput, DRAINING_MARKER, SHUTDOWN_TOLERANCE_MS);
    await waitForPortClosed(port, SHUTDOWN_TOLERANCE_MS);
    assert.equal(getOutput().includes(CLEANUP_STARTED_MARKER), false);

    child.stdin.end('RELEASE_ACTIVE\n');
    const response = await activeRequest;
    assert.equal(
      response.statusCode,
      201,
      JSON.stringify({ response, output: getOutput() }),
    );
    assert.equal(JSON.parse(response.body).title, 'M5 graceful active request');

    await waitForOutput(
      getOutput,
      CLEANUP_COMPLETED_MARKER,
      SHUTDOWN_TOLERANCE_MS,
    );
    const exit = await waitForExit(
      child,
      TEST_SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TOLERANCE_MS,
      getOutput,
    );
    const elapsedMs = Date.now() - shutdownStartedAt;
    const capturedOutput = getOutput();

    assert.equal(exit.code, 0);
    assert.equal(exit.signal, null);
    assert.ok(
      elapsedMs <= TEST_SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TOLERANCE_MS,
      elapsedMs,
    );
    assert.ok(
      capturedOutput.indexOf(ACTIVE_ENTERED_MARKER) <
        capturedOutput.indexOf(DRAINING_MARKER),
    );
    assert.ok(
      capturedOutput.indexOf(DRAINING_MARKER) <
        capturedOutput.indexOf(ACTIVE_RELEASED_MARKER),
    );
    assert.ok(
      capturedOutput.indexOf(ACTIVE_COMPLETED_MARKER) <
        capturedOutput.indexOf(CLEANUP_STARTED_MARKER),
    );
    assert.equal(structuredEvents(capturedOutput, 'shutdown_failed').length, 0);
    assert.equal(structuredEvents(capturedOutput, 'forced_shutdown').length, 0);
  },
);
