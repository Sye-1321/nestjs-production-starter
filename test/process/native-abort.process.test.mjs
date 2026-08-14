import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { Agent, request } from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  SHUTDOWN_FIXTURE,
  getAvailablePort,
  registerChildCleanup,
  spawnEntry,
  structuredEvents,
  validEnvironment,
  waitForOutput,
  waitForStatus,
} from './support/process-test-helpers.mjs';

const DISCONNECT_REQUEST_ID = 'm5-native-disconnect';
const NORMAL_REQUEST_ID = 'm5-normal-keepalive';
const MARKER_WAIT_MS = 5_000;
const SOCKET_CLOSE_SETTLE_MS = 100;

function startTaskRequest(port, title, requestId, agent = false) {
  const body = JSON.stringify({ title });
  let clientRequest;
  const outcome = new Promise((resolve) => {
    clientRequest = request(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/tasks',
        method: 'POST',
        agent,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          'x-request-id': requestId,
        },
      },
      (response) => {
        response.setEncoding('utf8');
        let responseBody = '';
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          resolve({
            kind: 'response',
            statusCode: response.statusCode,
            body: responseBody,
          });
        });
      },
    );
    clientRequest.once('error', (error) => {
      resolve({ kind: 'closed', code: error.code });
    });
    clientRequest.end(body);
  });

  return { request: clientRequest, outcome };
}

test('native request signal aborts active disconnected work without misclassifying later socket close', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port, {
    LOG_LEVEL: 'info',
    M5_SHUTDOWN_FIXTURE_MODE: 'native-abort',
  });
  const { child, output: getOutput } = spawnEntry(
    SHUTDOWN_FIXTURE,
    environment,
    { input: true },
  );
  registerChildCleanup(t, child);

  await waitForStatus(port, '/health/live', 200, undefined, getOutput);
  const disconnected = startTaskRequest(
    port,
    'M5 disconnect request',
    DISCONNECT_REQUEST_ID,
  );
  await waitForOutput(getOutput, 'M5_DISCONNECT_WORK_ENTERED', MARKER_WAIT_MS);

  disconnected.request.destroy();
  await waitForOutput(getOutput, 'M5_DISCONNECT_ABORTED', MARKER_WAIT_MS);
  assert.ok(
    getOutput().indexOf('M5_DISCONNECT_WORK_ENTERED') <
      getOutput().indexOf('M5_DISCONNECT_ABORTED'),
  );
  const disconnectedOutcome = await disconnected.outcome;
  assert.equal(disconnectedOutcome.kind, 'closed');

  child.stdin.write('RELEASE_ABORT\n');
  await waitForOutput(
    getOutput,
    'M5_DISCONNECT_WORK_COMPLETED',
    MARKER_WAIT_MS,
  );

  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  const normal = startTaskRequest(
    port,
    'M5 normal keepalive request',
    NORMAL_REQUEST_ID,
    agent,
  );
  const normalOutcome = await normal.outcome;
  assert.equal(normalOutcome.kind, 'response');
  assert.equal(
    normalOutcome.statusCode,
    201,
    JSON.stringify({ normalOutcome, output: getOutput() }),
  );
  assert.equal(
    JSON.parse(normalOutcome.body).title,
    'M5 normal keepalive request',
  );
  await waitForOutput(getOutput, 'M5_NORMAL_WORK_COMPLETED', MARKER_WAIT_MS);

  agent.destroy();
  await delay(SOCKET_CLOSE_SETTLE_MS);
  const capturedOutput = getOutput();
  const completedIndex = capturedOutput.indexOf('M5_NORMAL_WORK_COMPLETED');
  const abortAfterCompletionIndex = capturedOutput.indexOf(
    'M5_NORMAL_ABORTED_AFTER_COMPLETION',
  );

  assert.equal(capturedOutput.includes('M5_NORMAL_ABORTED_DURING_WORK'), false);
  if (abortAfterCompletionIndex >= 0) {
    assert.ok(abortAfterCompletionIndex > completedIndex);
  }
  assert.equal(
    structuredEvents(capturedOutput, 'http_request_failed').some(
      (event) => event.request_id === NORMAL_REQUEST_ID,
    ),
    false,
  );
});
