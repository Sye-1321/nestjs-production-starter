import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { Client } from 'pg';

import {
  MAIN_ENTRY,
  SHUTDOWN_FIXTURE,
  getAvailablePort,
  registerChildCleanup,
  requestHttp,
  spawnEntry,
  structuredEvents,
  validEnvironment,
  waitForStatus,
  waitForStructuredEvents,
} from '../process/support/process-test-helpers.mjs';
import { requiredTestDatabaseUrl } from '../support/database-test-fixture.mjs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_TITLE_CANARY = 'C4_REAL_TASK_TITLE_CANARY_71F3';
const AUTHORIZATION_CANARY = 'C4_TASK_AUTHORIZATION_CANARY_28A9';
const COOKIE_CANARY = 'C4_TASK_COOKIE_CANARY_63D4';
const QUERY_CANARY = 'C4_TASK_QUERY_CANARY_95B2';
const TASK_REQUEST_ID = 'c4-real-task-request';
const ACQUIRE_TIMEOUT_REQUEST_ID = 'c4-db-acquire-timeout';
const UNEXPECTED_DB_REQUEST_ID = 'c4-unexpected-db-error';
const ACQUIRE_TIMEOUT_MS = 200;
const STATEMENT_TIMEOUT_MS = 200;
const STATEMENT_TIMEOUT_REQUEST_ID = 'm5-db-statement-timeout';
const STATEMENT_TIMEOUT_CANARY = 'M5_STATEMENT_TIMEOUT_CANARY_6A42';
const HTTP_BOUNDARY_REQUEST_IDS = new Set([
  'm5-malformed-json',
  'm5-missing-content-type',
  'm5-unsupported-content-type',
  'm5-oversized-body',
]);

function postTask(port, title, options = {}) {
  const body = JSON.stringify({ title, ...options.fields });
  return requestHttp(port, {
    pathname: options.pathname ?? '/v1/tasks',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      ...options.headers,
    },
    body,
  });
}

function assertTaskRepresentation(task, expectedTitle) {
  assert.deepEqual(Object.keys(task).sort(), ['createdAt', 'id', 'title']);
  assert.match(task.id, UUID_PATTERN);
  assert.equal(task.title, expectedTitle);
  assert.equal(new Date(task.createdAt).toISOString(), task.createdAt);
}

function assertProblem(response, expected) {
  assert.equal(response.statusCode, expected.status);
  assert.match(
    response.headers['content-type'],
    /^application\/problem\+json(?:;|$)/u,
  );
  assert.deepEqual(JSON.parse(response.body), expected.body);
}

async function createControlClient(t) {
  const client = new Client({
    connectionString: requiredTestDatabaseUrl(),
    application_name: 'c4-test-control',
  });
  let transactionOpen = false;
  await client.connect();

  t.after(async () => {
    if (transactionOpen) {
      await client.query('ROLLBACK');
    }
    await client.end();
  });

  return {
    client,
    async lockTaskTable() {
      await client.query('BEGIN');
      transactionOpen = true;
      await client.query('LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE');
    },
    async releaseTaskTable() {
      await client.query('ROLLBACK');
      transactionOpen = false;
    },
  };
}

async function waitForBlockedApplicationQuery(client, requestOutcome) {
  const deadline = performance.now() + 5_000;
  let observedActivity = [];

  while (performance.now() < deadline) {
    const result = await client.query({
      text: `
        SELECT activity.pid, activity.application_name, activity.state,
               lock.mode, lock.granted
        FROM pg_locks AS lock
        JOIN pg_class AS relation ON relation.oid = lock.relation
        JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
        WHERE relation.relname = 'tasks' AND lock.granted = false
      `,
    });
    observedActivity = result.rows;
    if (
      observedActivity.some(
        (activity) =>
          activity.application_name === 'nestjs-production-starter' &&
          activity.state === 'active' &&
          activity.granted === false,
      )
    ) {
      return;
    }
    await delay(20);
  }

  throw new Error(
    `Application Task query did not block on the test table lock: activity=${JSON.stringify(observedActivity)} request=${JSON.stringify(requestOutcome.current)}`,
  );
}

test('real HTTP Task create/read/validation and accepted-body log canary use migrated PostgreSQL', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port, { LOG_LEVEL: 'info' });
  const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);
  const control = await createControlClient(t);

  await waitForStatus(port, '/health/live', 200);

  const createdResponse = await postTask(port, `  ${TASK_TITLE_CANARY}  `, {
    pathname: `/v1/tasks?probe=${QUERY_CANARY}`,
    headers: {
      'x-request-id': TASK_REQUEST_ID,
      authorization: `Bearer ${AUTHORIZATION_CANARY}`,
      cookie: `session=${COOKIE_CANARY}`,
    },
  });
  assert.equal(createdResponse.statusCode, 201);
  assert.equal(createdResponse.headers['x-request-id'], TASK_REQUEST_ID);
  const created = JSON.parse(createdResponse.body);
  assertTaskRepresentation(created, TASK_TITLE_CANARY);

  const persisted = await control.client.query({
    text: 'SELECT id, title, created_at FROM tasks WHERE id = $1',
    values: [created.id],
  });
  assert.equal(persisted.rowCount, 1);
  assert.equal(persisted.rows[0].title, TASK_TITLE_CANARY);
  assert.equal(persisted.rows[0].created_at.toISOString(), created.createdAt);

  const getResponse = await requestHttp(port, {
    pathname: `/v1/tasks/${created.id}`,
    headers: { 'x-request-id': 'c4-get-task' },
  });
  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(getResponse.body), created);

  const missingRequestId = 'c4-missing-task';
  const missingResponse = await requestHttp(port, {
    pathname: `/v1/tasks/${randomUUID()}`,
    headers: { 'x-request-id': missingRequestId },
  });
  assertProblem(missingResponse, {
    status: 404,
    body: {
      type: 'urn:nestjs-production-starter:problem:not-found',
      title: 'Resource not found',
      status: 404,
      detail: 'The requested resource was not found.',
      code: 'TASK_NOT_FOUND',
      requestId: missingRequestId,
    },
  });

  await control.lockTaskTable();
  const invalidStartedAt = performance.now();
  const invalidResponse = await requestHttp(port, {
    pathname: '/v1/tasks/not-a-uuid',
    headers: { 'x-request-id': 'c4-invalid-task-id' },
  });
  const invalidElapsedMs = performance.now() - invalidStartedAt;
  await control.releaseTaskTable();
  assertProblem(invalidResponse, {
    status: 400,
    body: {
      type: 'urn:nestjs-production-starter:problem:validation',
      title: 'Validation failed',
      status: 400,
      detail: 'The request contains invalid fields.',
      code: 'VALIDATION_ERROR',
      requestId: 'c4-invalid-task-id',
    },
  });
  assert.ok(invalidElapsedMs < 1_000, invalidElapsedMs);

  const unknownResponse = await postTask(port, 'valid title', {
    fields: { extra: 'unknown' },
    headers: { 'x-request-id': 'c4-unknown-task-field' },
  });
  assertProblem(unknownResponse, {
    status: 400,
    body: {
      type: 'urn:nestjs-production-starter:problem:validation',
      title: 'Validation failed',
      status: 400,
      detail: 'The request contains invalid fields.',
      code: 'VALIDATION_ERROR',
      requestId: 'c4-unknown-task-field',
    },
  });

  const whitespaceResponse = await postTask(port, '   ', {
    headers: { 'x-request-id': 'c4-whitespace-task-title' },
  });
  assertProblem(whitespaceResponse, {
    status: 400,
    body: {
      type: 'urn:nestjs-production-starter:problem:validation',
      title: 'Validation failed',
      status: 400,
      detail: 'The request contains invalid fields.',
      code: 'VALIDATION_ERROR',
      requestId: 'c4-whitespace-task-title',
    },
  });

  const taskEvents = await waitForStructuredEvents(
    getOutput,
    'http_request_completed',
    {
      count: 1,
      predicate: (event) => event.request_id === TASK_REQUEST_ID,
    },
  );
  assert.equal(taskEvents[0].method, 'POST');
  assert.equal(taskEvents[0].route, '/v1/tasks');
  assert.equal(taskEvents[0].status_code, 201);

  const fullOutput = getOutput();
  for (const canary of [
    TASK_TITLE_CANARY,
    AUTHORIZATION_CANARY,
    COOKIE_CANARY,
    QUERY_CANARY,
  ]) {
    assert.equal(fullOutput.includes(canary), false, canary);
  }
});

test('real saturated Task pool maps only pg-pool acquisition timeout to sanitized 503', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port, {
    LOG_LEVEL: 'info',
    DB_POOL_MAX: '1',
    DB_ACQUIRE_TIMEOUT_MS: String(ACQUIRE_TIMEOUT_MS),
    DB_STATEMENT_TIMEOUT_MS: '10000',
  });
  const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);
  const control = await createControlClient(t);

  await waitForStatus(port, '/health/live', 200);
  const warmupResponse = await postTask(port, 'pool warmup task', {
    headers: { 'x-request-id': 'c4-pool-warmup-task' },
  });
  assert.equal(warmupResponse.statusCode, 201);
  await control.lockTaskTable();

  const blockedOutcome = { current: { state: 'pending' } };
  const blockedRequest = postTask(port, 'first blocked task', {
    headers: { 'x-request-id': 'c4-blocked-first-task' },
  });
  void blockedRequest.then(
    (response) => {
      blockedOutcome.current = {
        state: 'fulfilled',
        statusCode: response.statusCode,
        body: response.body,
      };
    },
    (error) => {
      blockedOutcome.current = {
        state: 'rejected',
        message: error instanceof Error ? error.message : 'unknown error',
      };
    },
  );
  await waitForBlockedApplicationQuery(control.client, blockedOutcome);

  const unavailableCanary = 'C4_UNAVAILABLE_PUBLIC_CANARY_4E87';
  const unavailableStartedAt = performance.now();
  const unavailableResponse = await postTask(port, unavailableCanary, {
    headers: { 'x-request-id': ACQUIRE_TIMEOUT_REQUEST_ID },
  });
  const unavailableElapsedMs = performance.now() - unavailableStartedAt;

  assertProblem(unavailableResponse, {
    status: 503,
    body: {
      type: 'urn:nestjs-production-starter:problem:dependency-unavailable',
      title: 'Service temporarily unavailable',
      status: 503,
      detail: 'The service is temporarily unavailable.',
      code: 'DEPENDENCY_UNAVAILABLE',
      requestId: ACQUIRE_TIMEOUT_REQUEST_ID,
    },
  });
  assert.ok(unavailableElapsedMs >= 140, unavailableElapsedMs);
  assert.ok(unavailableElapsedMs <= 1_000, unavailableElapsedMs);

  await control.releaseTaskTable();
  const unblockedResponse = await blockedRequest;
  assert.equal(unblockedResponse.statusCode, 201);

  const unexpectedCanary = 'C4_UNEXPECTED_DB_PUBLIC_CANARY_9B31';
  await control.client.query('ALTER TABLE tasks RENAME TO tasks_c4_missing');
  let unexpectedResponse;
  try {
    unexpectedResponse = await postTask(port, unexpectedCanary, {
      headers: { 'x-request-id': UNEXPECTED_DB_REQUEST_ID },
    });
  } finally {
    await control.client.query('ALTER TABLE tasks_c4_missing RENAME TO tasks');
  }

  assertProblem(unexpectedResponse, {
    status: 500,
    body: {
      type: 'urn:nestjs-production-starter:problem:internal-error',
      title: 'Internal server error',
      status: 500,
      detail: 'An internal server error occurred.',
      code: 'INTERNAL_ERROR',
      requestId: UNEXPECTED_DB_REQUEST_ID,
    },
  });

  const unavailableEvents = await waitForStructuredEvents(
    getOutput,
    'http_request_completed',
    {
      count: 1,
      predicate: (event) => event.request_id === ACQUIRE_TIMEOUT_REQUEST_ID,
    },
  );
  assert.equal(unavailableEvents[0].route, '/v1/tasks');
  assert.equal(unavailableEvents[0].status_code, 503);

  const unexpectedFailureEvents = await waitForStructuredEvents(
    getOutput,
    'http_request_failed',
    {
      count: 1,
      predicate: (event) => event.request_id === UNEXPECTED_DB_REQUEST_ID,
    },
  );
  assert.equal(unexpectedFailureEvents.length, 1);
  assert.equal(unexpectedFailureEvents[0].error_type, 'Error');
  assert.equal(unexpectedFailureEvents[0].route, '/v1/tasks');

  const fullOutput = getOutput();
  assert.equal(
    structuredEvents(fullOutput, 'http_request_failed').some(
      (event) => event.request_id === ACQUIRE_TIMEOUT_REQUEST_ID,
    ),
    false,
  );
  for (const forbidden of [
    unavailableCanary,
    unexpectedCanary,
    requiredTestDatabaseUrl(),
    'timeout exceeded when trying to connect',
    'PrismaClientKnownRequestError',
    'P2021',
    'tasks_c4_missing',
  ]) {
    assert.equal(fullOutput.includes(forbidden), false, forbidden);
    assert.equal(
      unavailableResponse.body.includes(forbidden),
      false,
      forbidden,
    );
    assert.equal(unexpectedResponse.body.includes(forbidden), false, forbidden);
  }

  t.diagnostic(
    `http_acquisition_timeout_ms=${unavailableElapsedMs.toFixed(1)}`,
  );
});

test('real Task statement timeout maps narrowly to sanitized 503 and recovers', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port, {
    LOG_LEVEL: 'info',
    DB_POOL_MAX: '2',
    DB_ACQUIRE_TIMEOUT_MS: '1000',
    DB_STATEMENT_TIMEOUT_MS: String(STATEMENT_TIMEOUT_MS),
  });
  const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);
  const control = await createControlClient(t);

  await waitForStatus(port, '/health/live', 200, undefined, getOutput);
  await control.lockTaskTable();
  const timeoutStartedAt = performance.now();
  let timeoutResponse;
  try {
    timeoutResponse = await postTask(port, STATEMENT_TIMEOUT_CANARY, {
      headers: { 'x-request-id': STATEMENT_TIMEOUT_REQUEST_ID },
    });
  } finally {
    await control.releaseTaskTable();
  }
  const timeoutElapsedMs = performance.now() - timeoutStartedAt;

  assertProblem(timeoutResponse, {
    status: 503,
    body: {
      type: 'urn:nestjs-production-starter:problem:dependency-unavailable',
      title: 'Service temporarily unavailable',
      status: 503,
      detail: 'The service is temporarily unavailable.',
      code: 'DEPENDENCY_UNAVAILABLE',
      requestId: STATEMENT_TIMEOUT_REQUEST_ID,
    },
  });
  assert.ok(timeoutElapsedMs >= 140, timeoutElapsedMs);
  assert.ok(timeoutElapsedMs <= 2_500, timeoutElapsedMs);

  const recoveryResponse = await postTask(
    port,
    'M5 post-statement-timeout HTTP recovery',
    { headers: { 'x-request-id': 'm5-statement-timeout-recovery' } },
  );
  assert.equal(recoveryResponse.statusCode, 201);
  assert.equal(
    JSON.parse(recoveryResponse.body).title,
    'M5 post-statement-timeout HTTP recovery',
  );

  const timeoutEvents = await waitForStructuredEvents(
    getOutput,
    'http_request_completed',
    {
      count: 1,
      predicate: (event) => event.request_id === STATEMENT_TIMEOUT_REQUEST_ID,
    },
  );
  assert.equal(timeoutEvents[0].status_code, 503);

  const capturedOutput = getOutput();
  assert.equal(
    structuredEvents(capturedOutput, 'http_request_failed').some(
      (event) => event.request_id === STATEMENT_TIMEOUT_REQUEST_ID,
    ),
    false,
  );
  for (const forbidden of [
    STATEMENT_TIMEOUT_CANARY,
    'PrismaClientKnownRequestError',
    'DriverAdapterError',
    'P2039',
    '57014',
    'canceling statement due to statement timeout',
  ]) {
    assert.equal(capturedOutput.includes(forbidden), false, forbidden);
    assert.equal(timeoutResponse.body.includes(forbidden), false, forbidden);
  }

  t.diagnostic(`http_statement_timeout_ms=${timeoutElapsedMs.toFixed(1)}`);
});

test('real HTTP malformed, media-type, and oversized inputs fail before Task work', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port, {
    LOG_LEVEL: 'info',
    M5_SHUTDOWN_FIXTURE_MODE: 'http-boundary',
  });
  const { child, output: getOutput } = spawnEntry(
    SHUTDOWN_FIXTURE,
    environment,
  );
  registerChildCleanup(t, child);

  await waitForStatus(port, '/health/live', 200, undefined, getOutput);
  const malformedBody = '{"title":"M5_MALFORMED_BODY_CANARY_8A31"';
  const missingMediaBody = JSON.stringify({
    title: 'M5_MISSING_MEDIA_BODY_CANARY_4E92',
  });
  const unsupportedMediaBody = JSON.stringify({
    title: 'M5_UNSUPPORTED_MEDIA_BODY_CANARY_7C16',
  });
  const oversizedBody = JSON.stringify({
    title: `M5_OVERSIZED_BODY_CANARY_3D57${'x'.repeat(100 * 1024)}`,
  });

  const cases = [
    {
      requestId: 'm5-malformed-json',
      body: malformedBody,
      headers: { 'content-type': 'application/json' },
      expected: {
        status: 400,
        body: {
          type: 'urn:nestjs-production-starter:problem:malformed-json',
          title: 'Malformed JSON',
          status: 400,
          detail: 'The request body contains malformed JSON.',
          code: 'MALFORMED_JSON',
          requestId: 'm5-malformed-json',
        },
      },
    },
    {
      requestId: 'm5-missing-content-type',
      body: missingMediaBody,
      headers: {},
      expected: {
        status: 415,
        body: {
          type: 'urn:nestjs-production-starter:problem:unsupported-media-type',
          title: 'Unsupported media type',
          status: 415,
          detail: 'The request must use application/json.',
          code: 'UNSUPPORTED_MEDIA_TYPE',
          requestId: 'm5-missing-content-type',
        },
      },
    },
    {
      requestId: 'm5-unsupported-content-type',
      body: unsupportedMediaBody,
      headers: { 'content-type': 'text/plain' },
      expected: {
        status: 415,
        body: {
          type: 'urn:nestjs-production-starter:problem:unsupported-media-type',
          title: 'Unsupported media type',
          status: 415,
          detail: 'The request must use application/json.',
          code: 'UNSUPPORTED_MEDIA_TYPE',
          requestId: 'm5-unsupported-content-type',
        },
      },
    },
    {
      requestId: 'm5-oversized-body',
      body: oversizedBody,
      headers: { 'content-type': 'application/json' },
      expected: {
        status: 413,
        body: {
          type: 'urn:nestjs-production-starter:problem:payload-too-large',
          title: 'Payload too large',
          status: 413,
          detail: 'The request body exceeds the maximum allowed size.',
          code: 'PAYLOAD_TOO_LARGE',
          requestId: 'm5-oversized-body',
        },
      },
    },
  ];

  const responses = [];
  for (const testCase of cases) {
    const response = await requestHttp(port, {
      pathname: '/v1/tasks',
      method: 'POST',
      headers: {
        'content-length': String(Buffer.byteLength(testCase.body)),
        'x-request-id': testCase.requestId,
        ...testCase.headers,
      },
      body: testCase.body,
    });
    assertProblem(response, testCase.expected);
    responses.push(response);
  }

  const completionEvents = await waitForStructuredEvents(
    getOutput,
    'http_request_completed',
    {
      count: cases.length,
      predicate: (event) => HTTP_BOUNDARY_REQUEST_IDS.has(event.request_id),
    },
  );
  assert.deepEqual(
    completionEvents.map((event) => event.status_code).sort(),
    [400, 413, 415, 415],
  );

  const capturedOutput = getOutput();
  assert.equal(capturedOutput.includes('M5_BOUNDARY_BUSINESS_ENTERED'), false);
  for (const forbidden of [
    'M5_MALFORMED_BODY_CANARY_8A31',
    'M5_MISSING_MEDIA_BODY_CANARY_4E92',
    'M5_UNSUPPORTED_MEDIA_BODY_CANARY_7C16',
    'M5_OVERSIZED_BODY_CANARY_3D57',
  ]) {
    assert.equal(capturedOutput.includes(forbidden), false, forbidden);
    for (const response of responses) {
      assert.equal(response.body.includes(forbidden), false, forbidden);
    }
  }
});
