import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import {
  SHUTDOWN_FIXTURE,
  getAvailablePort,
  registerChildCleanup,
  requestHttp,
  spawnEntry,
  structuredEvents,
  validEnvironment,
  waitForStatus,
  waitForStructuredEvents,
} from './support/process-test-helpers.mjs';

const REQUEST_ID = 'm5-unexpected-http-5xx';

test('unexpected HTTP 5xx payload is sanitized publicly and logged once without canaries', async (t) => {
  const port = await getAvailablePort();
  const environment = validEnvironment(port, {
    LOG_LEVEL: 'info',
    M5_SHUTDOWN_FIXTURE_MODE: 'unexpected-5xx',
  });
  const { child, output: getOutput } = spawnEntry(
    SHUTDOWN_FIXTURE,
    environment,
  );
  registerChildCleanup(t, child);

  await waitForStatus(port, '/health/live', 200, undefined, getOutput);
  const body = JSON.stringify({ title: 'M5 trigger unexpected 5xx' });
  const response = await requestHttp(port, {
    pathname: '/v1/tasks',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      'x-request-id': REQUEST_ID,
    },
    body,
  });

  assert.equal(response.statusCode, 500);
  assert.match(
    response.headers['content-type'],
    /^application\/problem\+json(?:;|$)/u,
  );
  assert.deepEqual(JSON.parse(response.body), {
    type: 'urn:nestjs-production-starter:problem:internal-error',
    title: 'Internal server error',
    status: 500,
    detail: 'An internal server error occurred.',
    code: 'INTERNAL_ERROR',
    requestId: REQUEST_ID,
  });

  const failures = await waitForStructuredEvents(
    getOutput,
    'http_request_failed',
    {
      count: 1,
      predicate: (event) => event.request_id === REQUEST_ID,
    },
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].error_type, 'Error');
  assert.equal(failures[0].method, 'POST');
  assert.equal(failures[0].route, '/v1/tasks');

  const capturedOutput = getOutput();
  assert.equal(
    structuredEvents(capturedOutput, 'http_request_failed').filter(
      (event) => event.request_id === REQUEST_ID,
    ).length,
    1,
  );
  for (const forbidden of [
    'M5 trigger unexpected 5xx',
    'M5_RAW_5XX_MESSAGE_CANARY_51D3',
    'PrismaClientKnownRequestError',
    'SELECT * FROM tasks',
    'db.internal',
    environment.DATABASE_URL,
    '/srv/application/internal.ts',
    'M5_NESTED_5XX_CANARY_8B27',
    'M5_5XX_CAUSE_CANARY_2C94',
  ]) {
    assert.equal(response.body.includes(forbidden), false, forbidden);
    assert.equal(capturedOutput.includes(forbidden), false, forbidden);
  }
});
