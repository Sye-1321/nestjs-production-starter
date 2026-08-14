import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  MAIN_ENTRY,
  getAvailablePort,
  registerChildCleanup,
  requestHttp,
  spawnEntry,
  validEnvironment,
  waitForStatus,
} from '../process/support/process-test-helpers.mjs';

const UNMATCHED_REQUEST_COUNT = 100;
const RAW_PATH_CANARY = 'm4-random-unmatched-path-canary';
const QUERY_CANARY = 'm4-metrics-query-canary';
const REQUEST_ID_CANARY = 'm4-metrics-request-id-canary';
const USER_AGENT_CANARY = 'm4-metrics-user-agent-canary';
const TASK_TITLE_CANARY = 'M4 metrics Task title canary';
const ERROR_MESSAGE_CANARY = 'm4-arbitrary-error-message-canary';

function postTask(port) {
  const body = JSON.stringify({ title: TASK_TITLE_CANARY });
  return requestHttp(port, {
    pathname: `/v1/tasks?query=${QUERY_CANARY}`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      'x-request-id': REQUEST_ID_CANARY,
      'user-agent': USER_AGENT_CANARY,
    },
    body,
  });
}

function metricLines(output, metricName) {
  return output.split('\n').filter((line) => line.startsWith(metricName));
}

test('Prometheus metrics are complete and 100 random unmatched paths have one bounded route label', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port);
  const { child } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);

  await waitForStatus(port, '/health/ready', 200);

  const createdResponse = await postTask(port);
  assert.equal(createdResponse.statusCode, 201);
  const createdTask = JSON.parse(createdResponse.body);

  const unmatchedPaths = Array.from(
    { length: UNMATCHED_REQUEST_COUNT },
    (_, index) =>
      `/${RAW_PATH_CANARY}/${String(index)}/${randomUUID()}/${ERROR_MESSAGE_CANARY}?query=${QUERY_CANARY}-${String(index)}`,
  );
  const unmatchedResponses = await Promise.all(
    unmatchedPaths.map((pathname, index) =>
      requestHttp(port, {
        pathname,
        headers: {
          'x-request-id': `${REQUEST_ID_CANARY}-${String(index)}`,
          'user-agent': `${USER_AGENT_CANARY}-${String(index)}`,
        },
        timeoutMs: 10_000,
      }),
    ),
  );
  assert.equal(
    unmatchedResponses.every((response) => response.statusCode === 404),
    true,
  );

  await requestHttp(port, { pathname: '/metrics' });
  const scrape = await requestHttp(port, { pathname: '/metrics' });
  assert.equal(scrape.statusCode, 200);
  assert.match(
    scrape.headers['content-type'] ?? '',
    /^text\/plain; charset=utf-8; version=0\.0\.4$/u,
  );

  for (const metricName of [
    'http_server_requests_total',
    'http_server_request_duration_seconds',
    'tasks_created_total',
    'service_dependency_ready',
    'process_resident_memory_bytes',
    'nodejs_heap_size_used_bytes',
  ]) {
    assert.match(scrape.body, new RegExp(`^# HELP ${metricName} `, 'mu'));
    assert.match(scrape.body, new RegExp(`^# TYPE ${metricName} `, 'mu'));
  }

  assert.match(scrape.body, /^tasks_created_total 1$/mu);
  assert.match(scrape.body, /^service_dependency_ready 1$/mu);
  assert.match(
    scrape.body,
    /^http_server_requests_total\{method="POST",route="\/v1\/tasks",status_code="201"\} 1$/mu,
  );
  assert.match(
    scrape.body,
    /^http_server_requests_total\{method="GET",route="\/metrics",status_code="200"\} 1$/mu,
  );

  const unmatchedRequestSeries = metricLines(
    scrape.body,
    'http_server_requests_total{',
  ).filter((line) => line.includes('route="UNMATCHED"'));
  assert.deepEqual(unmatchedRequestSeries, [
    'http_server_requests_total{method="GET",route="UNMATCHED",status_code="404"} 100',
  ]);

  const unmatchedRouteValues = new Set(
    scrape.body
      .split('\n')
      .filter((line) => line.includes('route="UNMATCHED"'))
      .map((line) => /route="([^"]+)"/u.exec(line)?.[1]),
  );
  assert.deepEqual([...unmatchedRouteValues], ['UNMATCHED']);

  for (const forbidden of [
    RAW_PATH_CANARY,
    QUERY_CANARY,
    REQUEST_ID_CANARY,
    USER_AGENT_CANARY,
    TASK_TITLE_CANARY,
    createdTask.id,
    ERROR_MESSAGE_CANARY,
  ]) {
    assert.equal(scrape.body.includes(forbidden), false, forbidden);
  }
});
