import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { Lifecycle } from '../../dist/bootstrap/lifecycle.js';
import { DrainingGateMiddleware } from '../../dist/platform/context/draining-gate.middleware.js';
import { RequestContextStorage } from '../../dist/platform/context/request-context.js';
import { ApplicationLogger } from '../../dist/platform/logging/application-logger.js';
import { RequestLoggingMiddleware } from '../../dist/platform/logging/request-logging.middleware.js';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const APPLICATION_FIELDS = [
  'duration_ms',
  'event',
  'method',
  'request_id',
  'route',
  'service',
  'status_code',
];
const PINO_FIELDS = ['level', 'time'];

function captureDestination() {
  let output = '';
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });

  return {
    destination,
    records() {
      return output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    output() {
      return output;
    },
  };
}

function responseDouble(statusCode = 200) {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  response.headers = { 'x-response-canary': 'RESPONSE_HEADER_CANARY' };
  response.body = 'RESPONSE_BODY_CANARY';
  response.setHeader = () => undefined;
  response.end = () => {
    response.emit('finish');
  };
  return response;
}

function drainingProblemBoundary() {
  return {
    respond(response, code) {
      assert.equal(code, 'DEPENDENCY_UNAVAILABLE');
      response.statusCode = 503;
      response.end();
    },
  };
}

function requestDouble(overrides = {}) {
  return {
    method: 'GET',
    route: undefined,
    ...overrides,
  };
}

function runCompletion({
  storage,
  logger,
  requestId = 'request-1',
  request = requestDouble(),
  response = responseDouble(),
}) {
  const middleware = new RequestLoggingMiddleware(storage, logger);
  storage.run({ requestId, abortSignal: {} }, () => {
    middleware.use(request, response, () => undefined);
    response.emit('finish');
  });
}

test('Pino dependency is direct, exact, and has no logging wrappers', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
  );

  assert.equal(packageJson.dependencies.pino, '10.3.1');
  assert.equal('nestjs-pino' in packageJson.dependencies, false);
  assert.equal('pino-http' in packageJson.dependencies, false);
  assert.equal('pino-pretty' in packageJson.dependencies, false);
});

test('application logger emits one bounded parseable JSON completion record', () => {
  const capture = captureDestination();
  const logger = new ApplicationLogger('info', capture.destination);

  logger.requestCompleted(
    {
      requestId: 'request-json',
      method: 'GET',
      route: '/health/live',
      statusCode: 200,
      durationMs: 12.5,
    },
    'info',
  );

  const records = capture.records();
  assert.equal(records.length, 1);
  const [record] = records;
  assert.deepEqual(
    Object.keys(record).sort(),
    [...APPLICATION_FIELDS, ...PINO_FIELDS].sort(),
  );
  assert.equal(record.service, 'nestjs-production-starter');
  assert.equal(record.event, 'http_request_completed');
  assert.equal(record.request_id, 'request-json');
  assert.equal(record.method, 'GET');
  assert.equal(record.route, '/health/live');
  assert.equal(record.status_code, 200);
  assert.equal(record.duration_ms, 12.5);
  assert.equal(record.level, 30);
  assert.equal(Number.isFinite(record.time), true);
});

test('application logger honors its configured Pino level', () => {
  const infoCapture = captureDestination();
  const infoLogger = new ApplicationLogger('info', infoCapture.destination);
  infoLogger.requestCompleted(
    {
      requestId: 'debug-suppressed',
      method: 'GET',
      route: '/health/live',
      statusCode: 200,
      durationMs: 1,
    },
    'debug',
  );
  assert.deepEqual(infoCapture.records(), []);

  const debugCapture = captureDestination();
  const debugLogger = new ApplicationLogger('debug', debugCapture.destination);
  debugLogger.requestCompleted(
    {
      requestId: 'debug-visible',
      method: 'GET',
      route: '/health/live',
      statusCode: 200,
      durationMs: 1,
    },
    'debug',
  );
  assert.equal(debugCapture.records().length, 1);
  assert.equal(debugCapture.records()[0].level, 20);
});

test('request completion obtains request ID from context and uses matched route template', () => {
  const storage = new RequestContextStorage();
  const records = [];
  const logger = {
    requestCompleted(completion, level) {
      records.push({ completion, level });
    },
  };
  const request = requestDouble({
    method: 'GET',
    route: { path: '/v1/tasks/:id' },
    headersDistinct: { 'x-request-id': ['conflicting-upstream-id'] },
    url: '/v1/tasks/literal-task-id?token=QUERY_CANARY',
    originalUrl: '/v1/tasks/literal-task-id?token=QUERY_CANARY',
  });

  runCompletion({
    storage,
    logger,
    requestId: 'context-request-id',
    request,
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].completion.requestId, 'context-request-id');
  assert.equal(records[0].completion.route, '/v1/tasks/:id');
  assert.equal(records[0].level, 'info');
});

test('method normalization is bounded and unknown methods map to OTHER', () => {
  const storage = new RequestContextStorage();
  const records = [];
  const logger = {
    requestCompleted(completion) {
      records.push(completion);
    },
  };
  const methods = [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
    'TRACE',
    'USER_CONTROLLED_METHOD',
  ];

  for (const method of methods) {
    runCompletion({
      storage,
      logger,
      requestId: `request-${method}`,
      request: requestDouble({ method, route: { path: '/v1/tasks' } }),
    });
  }

  assert.deepEqual(
    records.map((record) => record.method),
    [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
      'OTHER',
      'OTHER',
    ],
  );
});

test('unmatched completion logs omit request and response canaries by construction', () => {
  const authorizationCanary = 'AUTHORIZATION_CANARY_7e8b';
  const cookieCanary = 'COOKIE_CANARY_1dd3';
  const bodyCanary = 'BODY_CANARY_45cc';
  const queryCanary = 'QUERY_CANARY_9912';
  const rawUrlCanary = 'RAW_URL_CANARY_4a52';
  const storage = new RequestContextStorage();
  const capture = captureDestination();
  const logger = new ApplicationLogger('info', capture.destination);
  const request = requestDouble({
    method: 'POST',
    headers: {
      authorization: authorizationCanary,
      cookie: cookieCanary,
    },
    body: { secret: bodyCanary },
    query: { secret: queryCanary },
    url: `/random/${rawUrlCanary}?secret=${queryCanary}`,
    originalUrl: `/random/${rawUrlCanary}?secret=${queryCanary}`,
  });
  const response = responseDouble(404);

  runCompletion({
    storage,
    logger,
    requestId: 'canary-request',
    request,
    response,
  });

  const records = capture.records();
  assert.equal(records.length, 1);
  assert.equal(records[0].route, 'UNMATCHED');
  assert.deepEqual(
    Object.keys(records[0]).sort(),
    [...APPLICATION_FIELDS, ...PINO_FIELDS].sort(),
  );

  const serialized = capture.output();
  for (const canary of [
    authorizationCanary,
    cookieCanary,
    bodyCanary,
    queryCanary,
    rawUrlCanary,
    'RESPONSE_HEADER_CANARY',
    'RESPONSE_BODY_CANARY',
  ]) {
    assert.equal(serialized.includes(canary), false, canary);
  }
});

test('successful operational completions are DEBUG and failures remain INFO', () => {
  const storage = new RequestContextStorage();
  const records = [];
  const logger = {
    requestCompleted(completion, level) {
      records.push({ completion, level });
    },
  };

  for (const route of ['/health/live', '/health/ready', '/metrics']) {
    runCompletion({
      storage,
      logger,
      requestId: `success-${route}`,
      request: requestDouble({ route: { path: route } }),
      response: responseDouble(200),
    });
  }
  runCompletion({
    storage,
    logger,
    requestId: 'failed-ready',
    request: requestDouble({ route: { path: '/health/ready' } }),
    response: responseDouble(503),
  });

  assert.deepEqual(
    records.map((record) => record.level),
    ['debug', 'debug', 'debug', 'info'],
  );
});

test('pre-router failure is visible at INFO with the bounded UNMATCHED route', () => {
  const storage = new RequestContextStorage();
  const records = [];
  const logger = {
    requestCompleted(completion, level) {
      records.push({ completion, level });
    },
  };
  const middleware = new RequestLoggingMiddleware(storage, logger);
  const request = requestDouble({
    method: 'POST',
    url: '/v1/tasks?secret=PARSER_QUERY_CANARY',
  });
  const response = responseDouble(200);

  storage.run({ requestId: 'parser-failure', abortSignal: {} }, () => {
    middleware.use(request, response, () => {
      response.statusCode = 400;
      response.emit('finish');
    });
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].completion.route, 'UNMATCHED');
  assert.equal(records[0].completion.statusCode, 400);
  assert.equal(records[0].level, 'info');
});

test('DRAINING gate completion is logged before downstream execution can begin', () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  lifecycle.beginDraining();
  const storage = new RequestContextStorage();
  const records = [];
  const logger = {
    requestCompleted(completion, level) {
      records.push({ completion, level });
    },
  };
  const loggingMiddleware = new RequestLoggingMiddleware(storage, logger);
  const drainingGate = new DrainingGateMiddleware(
    lifecycle,
    drainingProblemBoundary(),
  );
  const request = requestDouble({ method: 'POST', path: '/v1/tasks' });
  const response = responseDouble();
  let downstreamExecuted = false;

  storage.run({ requestId: 'draining-log', abortSignal: {} }, () => {
    loggingMiddleware.use(request, response, () => {
      drainingGate.use(request, response, () => {
        downstreamExecuted = true;
      });
    });
  });

  assert.equal(downstreamExecuted, false);
  assert.equal(records.length, 1);
  assert.equal(records[0].completion.requestId, 'draining-log');
  assert.equal(records[0].completion.route, 'UNMATCHED');
  assert.equal(records[0].completion.statusCode, 503);
  assert.equal(records[0].level, 'info');
});

test('request completion emits once on finish and never fabricates close as completion', () => {
  const storage = new RequestContextStorage();
  const records = [];
  const logger = {
    requestCompleted(completion) {
      records.push(completion);
    },
  };
  const middleware = new RequestLoggingMiddleware(storage, logger);
  const firstResponse = responseDouble();

  storage.run({ requestId: 'finish-once', abortSignal: {} }, () => {
    middleware.use(requestDouble(), firstResponse, () => undefined);
    firstResponse.emit('finish');
    firstResponse.emit('finish');
    firstResponse.emit('close');
  });
  assert.equal(records.length, 1);
  assert.equal(Number.isFinite(records[0].durationMs), true);
  assert.ok(records[0].durationMs >= 0);

  const closedResponse = responseDouble();
  storage.run({ requestId: 'close-only', abortSignal: {} }, () => {
    middleware.use(requestDouble(), closedResponse, () => undefined);
    closedResponse.emit('close');
  });
  assert.equal(records.length, 1);
});

test('100 interleaved request contexts isolate success, rejection, and subsequent context', async () => {
  const storage = new RequestContextStorage();
  const records = [];
  const logger = {
    requestCompleted(completion) {
      const current = storage.get();
      assert.notEqual(current, undefined);
      assert.equal(completion.requestId, current.requestId);
      records.push(completion);
    },
  };
  const middleware = new RequestLoggingMiddleware(storage, logger);
  const rejectedIndex = 37;
  const rejectedRequestId = `interleaved-${String(rejectedIndex).padStart(3, '0')}`;
  const requestIds = Array.from(
    { length: 100 },
    (_, index) => `interleaved-${String(index).padStart(3, '0')}`,
  );

  const results = await Promise.allSettled(
    requestIds.map(async (requestId, index) => {
      const run = storage.run({ requestId, abortSignal: {} }, async () => {
        const response = responseDouble();
        middleware.use(
          requestDouble({ route: { path: '/v1/tasks' } }),
          response,
          () => undefined,
        );

        await Promise.resolve();
        await delay(index % 7);
        assert.equal(storage.get().requestId, requestId);

        try {
          if (index === rejectedIndex) {
            await delay(0);
            assert.equal(storage.get().requestId, rejectedRequestId);
            throw new Error('deliberate request-context rejection');
          }
        } finally {
          response.emit('finish');
          await Promise.resolve();
          assert.equal(storage.get().requestId, requestId);
        }
      });

      try {
        await run;
      } finally {
        assert.equal(storage.get(), undefined);
      }
    }),
  );

  assert.equal(
    results.filter((result) => result.status === 'rejected').length,
    1,
  );
  assert.equal(results[rejectedIndex].status, 'rejected');
  assert.match(
    results[rejectedIndex].reason.message,
    /deliberate request-context rejection/u,
  );

  assert.equal(records.length, 100);
  assert.deepEqual(
    records.map((record) => record.requestId).sort(),
    [...requestIds].sort(),
  );
  assert.equal(storage.get(), undefined);

  const subsequentRequestId = 'subsequent-after-rejection';
  await storage.run(
    { requestId: subsequentRequestId, abortSignal: {} },
    async () => {
      const response = responseDouble();
      middleware.use(
        requestDouble({ route: { path: '/v1/tasks' } }),
        response,
        () => undefined,
      );

      await Promise.resolve();
      await delay(0);
      assert.equal(storage.get().requestId, subsequentRequestId);
      assert.notEqual(storage.get().requestId, rejectedRequestId);
      response.emit('finish');
    },
  );
  assert.equal(storage.get(), undefined);
  assert.equal(records.length, 101);
  assert.equal(records.at(-1).requestId, subsequentRequestId);
});
