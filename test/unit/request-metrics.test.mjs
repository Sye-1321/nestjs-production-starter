import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { RequestMetricsMiddleware } from '../../dist/platform/metrics/request-metrics.middleware.js';

function responseDouble(statusCode) {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  return response;
}

function captureMetrics() {
  const requests = [];
  let tasksCreated = 0;
  return {
    metrics: {
      recordHttpRequest(labels, durationSeconds) {
        requests.push({ labels, durationSeconds });
      },
      recordTaskCreated() {
        tasksCreated += 1;
      },
    },
    requests,
    tasksCreated: () => tasksCreated,
  };
}

function runCompletion({ method = 'GET', route, statusCode = 200 } = {}) {
  const captured = captureMetrics();
  const middleware = new RequestMetricsMiddleware(captured.metrics);
  const request = { method, route };
  const response = responseDouble(statusCode);
  let downstreamCalls = 0;

  middleware.use(request, response, () => {
    downstreamCalls += 1;
  });
  response.emit('finish');
  response.emit('finish');

  return { ...captured, downstreamCalls };
}

test('completion records one bounded request count and duration observation', () => {
  const captured = runCompletion({
    method: 'GET',
    route: { path: '/v1/tasks/:id' },
    statusCode: 200,
  });

  assert.equal(captured.downstreamCalls, 1);
  assert.equal(captured.requests.length, 1);
  assert.deepEqual(captured.requests[0].labels, {
    method: 'GET',
    route: '/v1/tasks/:id',
    status_code: '200',
  });
  assert.equal(Number.isFinite(captured.requests[0].durationSeconds), true);
  assert.ok(captured.requests[0].durationSeconds >= 0);
  assert.equal(captured.tasksCreated(), 0);
});

test('successful Task creation increments only POST /v1/tasks 201', () => {
  const cases = [
    ['POST', '/v1/tasks', 201, 1],
    ['POST', '/v1/tasks', 503, 0],
    ['GET', '/v1/tasks', 201, 0],
    ['POST', '/v1/tasks/:id', 201, 0],
  ];

  for (const [method, route, statusCode, expected] of cases) {
    const captured = runCompletion({
      method,
      route: { path: route },
      statusCode,
    });
    assert.equal(captured.tasksCreated(), expected, `${method} ${route}`);
  }
});

test('unmatched and attacker-controlled dimensions collapse to bounded labels', () => {
  const captured = captureMetrics();
  const middleware = new RequestMetricsMiddleware(captured.metrics);
  const request = {
    method: 'ATTACKER_METHOD',
    route: undefined,
    url: '/raw/attacker-path?query=query-canary',
    originalUrl: '/raw/attacker-path?query=query-canary',
    headers: { 'user-agent': 'user-agent-canary' },
    body: { requestId: 'request-id-canary', taskId: 'task-id-canary' },
  };
  const response = responseDouble(777);

  middleware.use(request, response, () => undefined);
  response.emit('finish');

  assert.deepEqual(captured.requests[0].labels, {
    method: 'OTHER',
    route: 'UNMATCHED',
    status_code: 'OTHER',
  });
  const serialized = JSON.stringify(captured.requests);
  for (const forbidden of [
    'attacker-path',
    'query-canary',
    'user-agent-canary',
    'request-id-canary',
    'task-id-canary',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
