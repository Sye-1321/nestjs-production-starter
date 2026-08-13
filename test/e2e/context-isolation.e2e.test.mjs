import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { Client } from 'pg';

import {
  MAIN_ENTRY,
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

const REQUEST_COUNT = 100;
const APPLICATION_POOL_MAX = 10;
const MINIMUM_BLOCKED_DATABASE_QUERIES = 1;
const MISSING_TASK_INDEX = 43;
const INTERLEAVE_DELAY_MS = 75;
const REQUEST_ID_PREFIX = 'c5-db-context-';
const TASK_TITLE_PREFIX = 'C5 database context task ';
const SUBSEQUENT_REQUEST_ID = 'c5-db-context-subsequent';
const SUBSEQUENT_TASK_TITLE = 'C5 subsequent context task';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function removeContextTasks(client) {
  return client.query({
    text: 'DELETE FROM tasks WHERE title LIKE $1 OR title = $2',
    values: [`${TASK_TITLE_PREFIX}%`, SUBSEQUENT_TASK_TITLE],
  });
}

function postTask(port, title, requestId) {
  const body = JSON.stringify({ title });
  return requestHttp(port, {
    pathname: '/v1/tasks',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      'x-request-id': requestId,
    },
    body,
    timeoutMs: 10_000,
  });
}

function getMissingTask(port, requestId) {
  return requestHttp(port, {
    pathname: `/v1/tasks/${randomUUID()}`,
    headers: { 'x-request-id': requestId },
    timeoutMs: 10_000,
  });
}

function assertTaskRepresentation(task, expectedTitle) {
  assert.deepEqual(Object.keys(task).sort(), ['createdAt', 'id', 'title']);
  assert.match(task.id, UUID_PATTERN);
  assert.equal(task.title, expectedTitle);
  assert.equal(new Date(task.createdAt).toISOString(), task.createdAt);
}

function assertMissingTaskProblem(response, requestId) {
  assert.equal(response.statusCode, 404);
  assert.match(
    response.headers['content-type'],
    /^application\/problem\+json(?:;|$)/u,
  );
  assert.deepEqual(JSON.parse(response.body), {
    type: 'urn:nestjs-production-starter:problem:not-found',
    title: 'Resource not found',
    status: 404,
    detail: 'The requested resource was not found.',
    code: 'TASK_NOT_FOUND',
    requestId,
  });
}

async function createControlClient(t) {
  const client = new Client({
    connectionString: requiredTestDatabaseUrl(),
    application_name: 'c5-context-test-control',
  });
  let transactionOpen = false;
  await client.connect();

  t.after(async () => {
    try {
      if (transactionOpen) {
        await client.query('ROLLBACK');
      }
      await removeContextTasks(client);
    } finally {
      await client.end();
    }
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

async function waitForBlockedApplicationQueries(
  client,
  minimumCount,
  requests,
) {
  const deadline = Date.now() + 5_000;
  let blockedPids = [];

  while (Date.now() < deadline) {
    const result = await client.query({
      text: `
        SELECT DISTINCT activity.pid
        FROM pg_locks AS lock
        JOIN pg_class AS relation ON relation.oid = lock.relation
        JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
        WHERE relation.relname = 'tasks'
          AND activity.application_name = 'nestjs-production-starter'
          AND activity.state = 'active'
          AND lock.granted = false
      `,
    });
    blockedPids = result.rows.map((row) => row.pid);
    if (blockedPids.length >= minimumCount) {
      return blockedPids.length;
    }
    await delay(10);
  }

  throw new Error(
    `Expected ${String(minimumCount)} blocked application queries; observed=${String(blockedPids.length)} outcomes=${JSON.stringify(requests.map(({ outcome }) => outcome))}`,
  );
}

function createBatchRequest(port, index) {
  const suffix = String(index).padStart(3, '0');
  const requestId = `${REQUEST_ID_PREFIX}${suffix}`;

  if (index === MISSING_TASK_INDEX) {
    return {
      kind: 'missing',
      requestId,
      promise: getMissingTask(port, requestId),
      outcome: { state: 'pending' },
    };
  }

  const title = `${TASK_TITLE_PREFIX}${suffix}`;
  return {
    kind: 'create',
    requestId,
    title,
    promise: postTask(port, title, requestId),
    outcome: { state: 'pending' },
  };
}

function trackRequestOutcomes(requests) {
  for (const request of requests) {
    void request.promise.then(
      (response) => {
        request.outcome = {
          state: 'fulfilled',
          statusCode: response.statusCode,
        };
      },
      (error) => {
        request.outcome = {
          state: 'rejected',
          errorType:
            error?.constructor?.name === undefined
              ? 'Unknown'
              : error.constructor.name,
        };
      },
    );
  }
}

test('100 interleaved Task requests preserve context through real PostgreSQL success and rejection', async (t) => {
  assert.ok(REQUEST_COUNT >= 100);
  assert.ok(MISSING_TASK_INDEX >= 0 && MISSING_TASK_INDEX < REQUEST_COUNT);

  const port = await getAvailablePort();
  const environment = validEnvironment(port, {
    LOG_LEVEL: 'info',
    DB_POOL_MAX: String(APPLICATION_POOL_MAX),
    DB_ACQUIRE_TIMEOUT_MS: '10000',
    DB_STATEMENT_TIMEOUT_MS: '10000',
  });
  const { child, output: getOutput } = spawnEntry(MAIN_ENTRY, environment);
  registerChildCleanup(t, child);
  const control = await createControlClient(t);

  await waitForStatus(port, '/health/live', 200);
  await control.lockTaskTable();

  const requests = Array.from({ length: REQUEST_COUNT }, (_, index) =>
    createBatchRequest(port, index),
  );
  trackRequestOutcomes(requests);
  const expectedRequestIds = new Set(
    requests.map((request) => request.requestId),
  );
  assert.equal(expectedRequestIds.size, REQUEST_COUNT);

  let blockedQueryCount;
  let interleavingFailure;
  try {
    blockedQueryCount = await waitForBlockedApplicationQueries(
      control.client,
      MINIMUM_BLOCKED_DATABASE_QUERIES,
      requests,
    );
    await delay(INTERLEAVE_DELAY_MS);
    assert.equal(
      requests.every(({ outcome }) => outcome.state === 'pending'),
      true,
      JSON.stringify(requests.map(({ outcome }) => outcome)),
    );
  } catch (error) {
    interleavingFailure = error;
  } finally {
    await control.releaseTaskTable();
  }

  const completed = await Promise.all(
    requests.map(async (request) => ({
      request,
      response: await request.promise,
    })),
  );
  if (interleavingFailure !== undefined) {
    throw interleavingFailure;
  }

  const responseRequestIds = new Set();
  const createdTaskIds = new Set();
  for (const { request, response } of completed) {
    assert.equal(response.headers['x-request-id'], request.requestId);
    responseRequestIds.add(response.headers['x-request-id']);

    if (request.kind === 'missing') {
      assertMissingTaskProblem(response, request.requestId);
      continue;
    }

    assert.equal(response.statusCode, 201);
    const task = JSON.parse(response.body);
    assertTaskRepresentation(task, request.title);
    createdTaskIds.add(task.id);
  }
  assert.equal(responseRequestIds.size, REQUEST_COUNT);
  assert.deepEqual(responseRequestIds, expectedRequestIds);
  assert.equal(createdTaskIds.size, REQUEST_COUNT - 1);

  const persisted = await control.client.query({
    text: 'SELECT COUNT(*)::integer AS count FROM tasks WHERE title LIKE $1',
    values: [`${TASK_TITLE_PREFIX}%`],
  });
  assert.equal(persisted.rows[0].count, REQUEST_COUNT - 1);

  const batchEvents = await waitForStructuredEvents(
    getOutput,
    'http_request_completed',
    {
      count: REQUEST_COUNT,
      predicate: (event) => expectedRequestIds.has(event.request_id),
    },
  );
  assert.equal(batchEvents.length, REQUEST_COUNT);

  const eventCountByRequestId = new Map();
  for (const event of batchEvents) {
    assert.equal(expectedRequestIds.has(event.request_id), true);
    const isMissing =
      event.request_id ===
      `${REQUEST_ID_PREFIX}${String(MISSING_TASK_INDEX).padStart(3, '0')}`;
    assert.equal(event.method, isMissing ? 'GET' : 'POST');
    assert.equal(event.route, isMissing ? '/v1/tasks/:id' : '/v1/tasks');
    assert.equal(event.status_code, isMissing ? 404 : 201);
    eventCountByRequestId.set(
      event.request_id,
      (eventCountByRequestId.get(event.request_id) ?? 0) + 1,
    );
  }
  assert.equal(eventCountByRequestId.size, REQUEST_COUNT);
  for (const requestId of expectedRequestIds) {
    assert.equal(eventCountByRequestId.get(requestId), 1);
  }
  assert.equal(
    structuredEvents(getOutput(), 'http_request_failed').some((event) =>
      expectedRequestIds.has(event.request_id),
    ),
    false,
  );

  const subsequentResponse = await postTask(
    port,
    SUBSEQUENT_TASK_TITLE,
    SUBSEQUENT_REQUEST_ID,
  );
  assert.equal(subsequentResponse.statusCode, 201);
  assert.equal(
    subsequentResponse.headers['x-request-id'],
    SUBSEQUENT_REQUEST_ID,
  );
  assertTaskRepresentation(
    JSON.parse(subsequentResponse.body),
    SUBSEQUENT_TASK_TITLE,
  );
  for (const requestId of expectedRequestIds) {
    assert.equal(subsequentResponse.body.includes(requestId), false, requestId);
  }

  const subsequentEvents = await waitForStructuredEvents(
    getOutput,
    'http_request_completed',
    {
      count: 1,
      predicate: (event) => event.request_id === SUBSEQUENT_REQUEST_ID,
    },
  );
  assert.equal(subsequentEvents.length, 1);
  assert.equal(subsequentEvents[0].method, 'POST');
  assert.equal(subsequentEvents[0].route, '/v1/tasks');
  assert.equal(subsequentEvents[0].status_code, 201);

  const cleanup = await removeContextTasks(control.client);
  assert.equal(cleanup.rowCount, REQUEST_COUNT);

  t.diagnostic(
    `context_requests=${String(REQUEST_COUNT)} blocked_database_queries=${String(blockedQueryCount)} timer_interleave_ms=${String(INTERLEAVE_DELAY_MS)}`,
  );
});
