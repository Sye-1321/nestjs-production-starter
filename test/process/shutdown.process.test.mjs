import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import net from 'node:net';
import process from 'node:process';
import test from 'node:test';
import { clearTimeout, setTimeout as scheduleTimeout } from 'node:timers';

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
const BUSINESS_ENTERED_MARKER = 'M5_BUSINESS_ENTERED';
const SOCKET_WAIT_MS = 3_000;
const MINIMUM_FORCE_ELAPSED_MS = 700;

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

function responseLength(rawResponse) {
  const separatorIndex = rawResponse.indexOf('\r\n\r\n');
  if (separatorIndex < 0) {
    return undefined;
  }

  const headerBlock = rawResponse.slice(0, separatorIndex);
  const contentLengthMatch = /\r\ncontent-length:\s*(\d+)\r?$/imu.exec(
    `\r\n${headerBlock}`,
  );
  if (contentLengthMatch === null) {
    return undefined;
  }

  return separatorIndex + 4 + Number(contentLengthMatch[1]);
}

function waitForSocketResponse(socket, initialData = '') {
  return new Promise((resolve, reject) => {
    let rawResponse = initialData;

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onEnd);
      socket.off('close', onClose);
    };
    const settle = (outcome) => {
      cleanup();
      resolve(outcome);
    };
    const checkComplete = () => {
      const length = responseLength(rawResponse);
      if (length !== undefined && rawResponse.length >= length) {
        settle({ kind: 'response', rawResponse: rawResponse.slice(0, length) });
      }
    };
    const onData = (chunk) => {
      rawResponse += chunk;
      checkComplete();
    };
    const onError = (error) => {
      settle({ kind: 'closed', code: error.code });
    };
    const onEnd = () => {
      if (rawResponse.length === 0) {
        settle({ kind: 'closed' });
        return;
      }

      const length = responseLength(rawResponse);
      if (length !== undefined && rawResponse.length >= length) {
        settle({ kind: 'response', rawResponse: rawResponse.slice(0, length) });
        return;
      }

      reject(new Error('Persistent socket ended with an incomplete response'));
    };
    const onClose = () => {
      if (rawResponse.length === 0) {
        settle({ kind: 'closed' });
      }
    };
    const timer = scheduleTimeout(() => {
      cleanup();
      reject(new Error('Persistent socket did not settle within its bound'));
    }, SOCKET_WAIT_MS);

    socket.setEncoding('latin1');
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('end', onEnd);
    socket.once('close', onClose);
    checkComplete();
  });
}

async function openPersistentConnection(port) {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  const response = waitForSocketResponse(socket);
  socket.write(
    [
      'GET /health/live HTTP/1.1',
      `Host: 127.0.0.1:${String(port)}`,
      'Connection: keep-alive',
      '',
      '',
    ].join('\r\n'),
    'latin1',
  );
  const outcome = await response;
  assert.equal(outcome.kind, 'response');
  assert.match(outcome.rawResponse, /^HTTP\/1\.1 200 /u);
  assert.match(outcome.rawResponse, /\r\nconnection: keep-alive\r\n/iu);

  return socket;
}

function attemptTaskOnPersistentConnection(socket, port) {
  if (socket.destroyed) {
    return Promise.resolve({ kind: 'closed' });
  }

  const body = JSON.stringify({ title: 'M5 post-draining Task' });
  const outcome = waitForSocketResponse(socket);
  socket.write(
    [
      'POST /v1/tasks HTTP/1.1',
      `Host: 127.0.0.1:${String(port)}`,
      'Content-Type: application/json',
      `Content-Length: ${String(Buffer.byteLength(body))}`,
      'Connection: keep-alive',
      '',
      body,
    ].join('\r\n'),
    'latin1',
  );
  return outcome;
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

test(
  'a pre-existing keep-alive transport starts no Task work after DRAINING',
  { skip: linuxOnly },
  async (t) => {
    const port = await getAvailablePort();
    const environment = validEnvironment(port, {
      M5_SHUTDOWN_FIXTURE_MODE: 'keep-alive',
    });
    const { child, output: getOutput } = spawnEntry(
      SHUTDOWN_FIXTURE,
      environment,
    );
    registerChildCleanup(t, child);

    await waitForStatus(port, '/health/live', 200, undefined, getOutput);
    const socket = await openPersistentConnection(port);
    t.after(() => socket.destroy());

    assert.equal(child.kill('SIGTERM'), true);
    await waitForOutput(getOutput, DRAINING_MARKER, SHUTDOWN_TOLERANCE_MS);
    const postDrainingOutcome = await attemptTaskOnPersistentConnection(
      socket,
      port,
    );

    const exit = await waitForExit(
      child,
      TEST_SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TOLERANCE_MS,
      getOutput,
    );
    const capturedOutput = getOutput();

    if (postDrainingOutcome.kind === 'response') {
      assert.match(postDrainingOutcome.rawResponse, /^HTTP\/1\.1 503 /u);
      assert.match(
        postDrainingOutcome.rawResponse,
        /\r\ncontent-type: application\/problem\+json/iu,
      );
      assert.match(
        postDrainingOutcome.rawResponse,
        /\r\nconnection: close\r\n/iu,
      );
    } else {
      assert.equal(postDrainingOutcome.kind, 'closed');
    }

    assert.equal(capturedOutput.includes(BUSINESS_ENTERED_MARKER), false);
    assert.equal(exit.code, 0);
    assert.equal(exit.signal, null);
    assert.equal(structuredEvents(capturedOutput, 'forced_shutdown').length, 0);
  },
);

test(
  'deadline force-closes active HTTP work and exits non-zero exactly once',
  { skip: linuxOnly },
  async (t) => {
    const port = await getAvailablePort();
    const environment = validEnvironment(port, {
      M5_SHUTDOWN_FIXTURE_MODE: 'force-active',
    });
    const { child, output: getOutput } = spawnEntry(
      SHUTDOWN_FIXTURE,
      environment,
    );
    registerChildCleanup(t, child);

    await waitForStatus(port, '/health/live', 200, undefined, getOutput);
    const requestOutcome = postTask(port, 'M5 force active request').then(
      (response) => ({ kind: 'response', response }),
      (error) => ({
        kind: 'closed',
        code: error instanceof Error ? error.code : undefined,
      }),
    );
    await waitForOutput(
      getOutput,
      ACTIVE_ENTERED_MARKER,
      SHUTDOWN_TOLERANCE_MS,
    );

    const shutdownStartedAt = Date.now();
    assert.equal(child.kill('SIGTERM'), true);
    await waitForOutput(getOutput, DRAINING_MARKER, SHUTDOWN_TOLERANCE_MS);
    assert.equal(child.kill('SIGINT'), true);

    const exit = await waitForExit(
      child,
      TEST_SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TOLERANCE_MS,
      getOutput,
    );
    const elapsedMs = Date.now() - shutdownStartedAt;
    const activeOutcome = await requestOutcome;
    const capturedOutput = getOutput();

    assert.equal(activeOutcome.kind, 'closed');
    assert.equal(exit.code, 1);
    assert.equal(exit.signal, null);
    assert.ok(elapsedMs >= MINIMUM_FORCE_ELAPSED_MS, elapsedMs);
    assert.ok(
      elapsedMs <= TEST_SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TOLERANCE_MS,
      elapsedMs,
    );
    assert.equal(structuredEvents(capturedOutput, 'forced_shutdown').length, 1);
    assert.equal(capturedOutput.includes(CLEANUP_STARTED_MARKER), false);
    assert.equal(capturedOutput.includes(ACTIVE_COMPLETED_MARKER), false);
  },
);

test(
  'the original deadline force-bounds provider cleanup after HTTP drain',
  { skip: linuxOnly },
  async (t) => {
    const port = await getAvailablePort();
    const environment = validEnvironment(port, {
      M5_SHUTDOWN_FIXTURE_MODE: 'force-cleanup',
    });
    const { child, output: getOutput } = spawnEntry(
      SHUTDOWN_FIXTURE,
      environment,
    );
    registerChildCleanup(t, child);

    await waitForStatus(port, '/health/live', 200, undefined, getOutput);
    const shutdownStartedAt = Date.now();
    assert.equal(child.kill('SIGTERM'), true);
    await waitForOutput(
      getOutput,
      CLEANUP_STARTED_MARKER,
      SHUTDOWN_TOLERANCE_MS,
    );
    assert.equal(getOutput().includes(CLEANUP_COMPLETED_MARKER), false);

    const exit = await waitForExit(
      child,
      TEST_SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TOLERANCE_MS,
      getOutput,
    );
    const elapsedMs = Date.now() - shutdownStartedAt;
    const capturedOutput = getOutput();

    assert.equal(exit.code, 1);
    assert.equal(exit.signal, null);
    assert.ok(elapsedMs >= MINIMUM_FORCE_ELAPSED_MS, elapsedMs);
    assert.ok(
      elapsedMs <= TEST_SHUTDOWN_TIMEOUT_MS + SHUTDOWN_TOLERANCE_MS,
      elapsedMs,
    );
    assert.equal(structuredEvents(capturedOutput, 'forced_shutdown').length, 1);
    assert.equal(capturedOutput.includes(CLEANUP_COMPLETED_MARKER), false);
  },
);
