import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_LOG_CANARY_FIXTURE,
  EXIT_WAIT_MS,
  MAIN_ENTRY,
  getAvailablePort,
  registerChildCleanup,
  requestHttp,
  spawnEntry,
  structuredEvents,
  validEnvironment,
  waitForExit,
  waitForStatus,
  waitForStructuredEvents,
} from './support/process-test-helpers.mjs';

const REQUEST_COUNT = 100;
const REQUEST_PREFIX = 'm2c5-concurrent-';
const FAILURE_REQUEST_ID = 'm2c5-error-log-request';
const ERROR_MESSAGE_CANARY = 'M2C5_ERROR_MESSAGE_CANARY_18C2';
const ERROR_CAUSE_CANARY = 'M2C5_ERROR_CAUSE_CANARY_572A';
const NESTED_METADATA_CANARY = 'M2C5_NESTED_METADATA_CANARY_93F1';
const ARBITRARY_PROPERTY_CANARY = 'M2C5_ARBITRARY_PROPERTY_CANARY_D04B';

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
const FAILURE_FIELDS = [
  'error_type',
  'event',
  'level',
  'method',
  'request_id',
  'route',
  'service',
  'time',
].sort();

test('100 concurrent real HTTP requests keep response and completion-log IDs isolated', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port, { LOG_LEVEL: 'debug' });
  const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);

  await waitForStatus(port, '/health/live', 200);

  const requestIds = Array.from(
    { length: REQUEST_COUNT },
    (_, index) => `${REQUEST_PREFIX}${String(index).padStart(3, '0')}`,
  );
  const expectedIds = new Set(requestIds);

  const responses = await Promise.all(
    requestIds.map(async (requestId) => {
      const response = await requestHttp(port, {
        pathname: '/health/live',
        headers: { 'x-request-id': requestId },
      });
      return { requestId, response };
    }),
  );

  const responseIds = new Set();
  for (const { requestId, response } of responses) {
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-request-id'], requestId);
    responseIds.add(response.headers['x-request-id']);
  }
  assert.equal(responseIds.size, REQUEST_COUNT);
  assert.deepEqual([...responseIds].sort(), [...requestIds].sort());

  const events = await waitForStructuredEvents(
    getOutput,
    'http_request_completed',
    {
      count: REQUEST_COUNT,
      predicate: (event) => expectedIds.has(event.request_id),
    },
  );

  assert.equal(events.length, REQUEST_COUNT);
  const countByRequestId = new Map();
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), COMPLETION_FIELDS);
    assert.equal(expectedIds.has(event.request_id), true);
    assert.equal(event.service, 'nestjs-production-starter');
    assert.equal(event.event, 'http_request_completed');
    assert.equal(event.method, 'GET');
    assert.equal(event.route, '/health/live');
    assert.equal(event.status_code, 200);
    assert.equal(event.level, 20);
    assert.equal(Number.isFinite(event.time), true);
    assert.equal(Number.isFinite(event.duration_ms), true);
    assert.ok(event.duration_ms >= 0);
    countByRequestId.set(
      event.request_id,
      (countByRequestId.get(event.request_id) ?? 0) + 1,
    );
  }

  assert.equal(countByRequestId.size, REQUEST_COUNT);
  for (const requestId of requestIds) {
    assert.equal(countByRequestId.get(requestId), 1);
  }
});

test('unexpected-error child fixture emits one bounded failure record without nested canaries', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port, { LOG_LEVEL: 'info' });
  const { child, output: getOutput } = spawnEntry(
    ERROR_LOG_CANARY_FIXTURE,
    environment,
  );
  registerChildCleanup(t, child);

  const exit = await waitForExit(child, EXIT_WAIT_MS, getOutput);
  assert.equal(exit.code, 0);
  assert.equal(exit.signal, null);

  const output = getOutput();
  const events = structuredEvents(output, 'http_request_failed');
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), FAILURE_FIELDS);
  assert.equal(events[0].service, 'nestjs-production-starter');
  assert.equal(events[0].event, 'http_request_failed');
  assert.equal(events[0].request_id, FAILURE_REQUEST_ID);
  assert.equal(events[0].error_type, 'Error');
  assert.equal(events[0].method, 'PATCH');
  assert.equal(events[0].route, '/v1/tasks/:id');
  assert.equal(events[0].level, 50);
  assert.equal(Number.isFinite(events[0].time), true);

  for (const canary of [
    ERROR_MESSAGE_CANARY,
    ERROR_CAUSE_CANARY,
    NESTED_METADATA_CANARY,
    ARBITRARY_PROPERTY_CANARY,
  ]) {
    assert.equal(output.includes(canary), false, canary);
  }
});
