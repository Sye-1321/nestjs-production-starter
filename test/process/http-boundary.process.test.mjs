import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import {
  MAIN_ENTRY,
  getAvailablePort,
  rawHttpRequest,
  registerChildCleanup,
  requestHttp,
  spawnEntry,
  validEnvironment,
  waitForStatus,
  waitForStructuredEvents,
} from './support/process-test-helpers.mjs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const AUTHORIZATION_CANARY = 'M2C5_AUTHORIZATION_CANARY_41D7';
const COOKIE_CANARY = 'M2C5_COOKIE_CANARY_82A9';
const BODY_CANARY = 'M2C5_BODY_CANARY_B63F';
const QUERY_CANARY = 'M2C5_QUERY_CANARY_C14E';
const REDACTION_REQUEST_ID = 'm2c5-redaction-request';

const COMPLETION_FIELDS = [
  'duration_ms',
  'event',
  'level',
  'method',
  'request_id',
  'route',
  'service',
  'status_code',
  'time',
].sort();

test('raw duplicate x-request-id field lines are replaced by a generated UUID', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port);
  const { child } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);

  await waitForStatus(port, '/health/live', 200);

  const rawRequest = [
    'GET /health/live HTTP/1.1',
    `Host: 127.0.0.1:${String(port)}`,
    'x-request-id: duplicate-a',
    'x-request-id: duplicate-b',
    'Connection: close',
    '',
    '',
  ].join('\r\n');
  const response = await rawHttpRequest(port, rawRequest);

  assert.equal(response.statusCode, 200);
  const chosenRequestId = response.headers['x-request-id'];
  assert.equal(typeof chosenRequestId, 'string');
  assert.notEqual(chosenRequestId, 'duplicate-a');
  assert.notEqual(chosenRequestId, 'duplicate-b');
  assert.match(chosenRequestId, UUID_PATTERN);
});

test('full application process output excludes request header, body, and query canaries', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port, { LOG_LEVEL: 'info' });
  const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);

  await waitForStatus(port, '/health/live', 200);

  const body = JSON.stringify({ title: BODY_CANARY });
  const response = await requestHttp(port, {
    pathname: `/v1/unmatched?probe=${QUERY_CANARY}`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      'x-request-id': REDACTION_REQUEST_ID,
      authorization: `Bearer ${AUTHORIZATION_CANARY}`,
      cookie: `session=${COOKIE_CANARY}`,
    },
    body,
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.headers['x-request-id'], REDACTION_REQUEST_ID);

  const events = await waitForStructuredEvents(
    getOutput,
    'http_request_completed',
    {
      count: 1,
      predicate: (event) => event.request_id === REDACTION_REQUEST_ID,
    },
  );

  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), COMPLETION_FIELDS);
  assert.equal(events[0].request_id, REDACTION_REQUEST_ID);
  assert.equal(events[0].method, 'POST');
  assert.equal(events[0].route, 'UNMATCHED');
  assert.equal(events[0].status_code, 404);

  const fullOutput = getOutput();
  for (const canary of [
    AUTHORIZATION_CANARY,
    COOKIE_CANARY,
    BODY_CANARY,
    QUERY_CANARY,
  ]) {
    assert.equal(fullOutput.includes(canary), false, canary);
  }
});
