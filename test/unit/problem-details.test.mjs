import 'reflect-metadata';

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IsString } from 'class-validator';

import { Lifecycle } from '../../dist/bootstrap/lifecycle.js';
import { DrainingGateMiddleware } from '../../dist/platform/context/draining-gate.middleware.js';
import { RequestContextMiddleware } from '../../dist/platform/context/request-context.middleware.js';
import { RequestContextStorage } from '../../dist/platform/context/request-context.js';
import { BodyParserErrorMiddleware } from '../../dist/platform/errors/body-parser-error.middleware.js';
import {
  HttpErrorBoundary,
  PROBLEM_DETAILS_CONTENT_TYPE,
} from '../../dist/platform/errors/http-error-boundary.js';
import { PROBLEM_CATALOGUE } from '../../dist/platform/errors/problem-catalogue.js';
import { ProblemDetailsExceptionFilter } from '../../dist/platform/errors/problem-details-exception.filter.js';
import {
  RequestValidationError,
  StrictValidationPipe,
} from '../../dist/platform/errors/strict-validation.pipe.js';
import { TaskContentTypeMiddleware } from '../../dist/platform/errors/task-content-type.middleware.js';
import { LivenessController } from '../../dist/platform/health/health.controller.js';
import { ApplicationLogger } from '../../dist/platform/logging/application-logger.js';
import { RequestLoggingMiddleware } from '../../dist/platform/logging/request-logging.middleware.js';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

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
  const headers = new Map();
  response.statusCode = statusCode;
  response.body = undefined;
  response.ended = false;
  response.headers = headers;
  response.status = function status(value) {
    this.statusCode = value;
    return this;
  };
  response.setHeader = function setHeader(name, value) {
    headers.set(name.toLowerCase(), value);
    return this;
  };
  response.getHeader = function getHeader(name) {
    return headers.get(name.toLowerCase());
  };
  response.json = function json(body) {
    this.body = body;
    this.ended = true;
    this.emit('finish');
    return this;
  };
  response.send = function send(body) {
    this.body = body;
    this.ended = true;
    this.emit('finish');
    return this;
  };
  response.end = function end() {
    this.ended = true;
    this.emit('finish');
  };
  return response;
}

function requestDouble(overrides = {}) {
  return {
    method: 'GET',
    path: '/v1/tasks',
    route: undefined,
    get() {
      return undefined;
    },
    ...overrides,
  };
}

function hostDouble(request, response) {
  return {
    switchToHttp() {
      return {
        getRequest() {
          return request;
        },
        getResponse() {
          return response;
        },
      };
    },
  };
}

function boundaryWithLogger(storage, logger) {
  return new HttpErrorBoundary(storage, logger);
}

function assertProblem(response, expected) {
  assert.equal(response.statusCode, expected.status);
  assert.equal(
    response.getHeader('content-type'),
    PROBLEM_DETAILS_CONTENT_TYPE,
  );
  assert.deepEqual(response.body, expected);
  assert.equal('instance' in response.body, false);
}

function failOnUnexpectedHttpRequestLog() {
  assert.fail('known failure must not be detailed-error logged');
}

test('validation dependencies are exact direct production dependencies', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
  );

  assert.equal(packageJson.dependencies['class-validator'], '0.15.1');
  assert.equal(packageJson.dependencies['class-transformer'], '0.5.1');
  assert.equal(packageJson.dependencies.pino, '10.3.1');
  for (const forbidden of ['zod', 'joi', 'ajv', 'express-validator']) {
    assert.equal(forbidden in packageJson.dependencies, false);
  }
});

test('problem catalogue is exactly the frozen seven categories', () => {
  assert.deepEqual(PROBLEM_CATALOGUE, {
    VALIDATION_ERROR: {
      type: 'urn:nestjs-production-starter:problem:validation',
      title: 'Validation failed',
      status: 400,
      detail: 'The request contains invalid fields.',
    },
    MALFORMED_JSON: {
      type: 'urn:nestjs-production-starter:problem:malformed-json',
      title: 'Malformed JSON',
      status: 400,
      detail: 'The request body contains malformed JSON.',
    },
    TASK_NOT_FOUND: {
      type: 'urn:nestjs-production-starter:problem:not-found',
      title: 'Resource not found',
      status: 404,
      detail: 'The requested resource was not found.',
    },
    PAYLOAD_TOO_LARGE: {
      type: 'urn:nestjs-production-starter:problem:payload-too-large',
      title: 'Payload too large',
      status: 413,
      detail: 'The request body exceeds the maximum allowed size.',
    },
    UNSUPPORTED_MEDIA_TYPE: {
      type: 'urn:nestjs-production-starter:problem:unsupported-media-type',
      title: 'Unsupported media type',
      status: 415,
      detail: 'The request must use application/json.',
    },
    DEPENDENCY_UNAVAILABLE: {
      type: 'urn:nestjs-production-starter:problem:dependency-unavailable',
      title: 'Service temporarily unavailable',
      status: 503,
      detail: 'The service is temporarily unavailable.',
    },
    INTERNAL_ERROR: {
      type: 'urn:nestjs-production-starter:problem:internal-error',
      title: 'Internal server error',
      status: 500,
      detail: 'An internal server error occurred.',
    },
  });
});

test('Problem Details uses the existing request context ID and no instance', () => {
  const storage = new RequestContextStorage();
  const logger = { httpRequestFailed: failOnUnexpectedHttpRequestLog };
  const boundary = boundaryWithLogger(storage, logger);
  const response = responseDouble();

  storage.run({ requestId: 'problem-request', abortSignal: {} }, () => {
    boundary.respond(response, 'MALFORMED_JSON');
  });

  assertProblem(response, {
    type: 'urn:nestjs-production-starter:problem:malformed-json',
    title: 'Malformed JSON',
    status: 400,
    detail: 'The request body contains malformed JSON.',
    code: 'MALFORMED_JSON',
    requestId: 'problem-request',
  });
});

test('body-parser failures map narrowly without exposing parser metadata', () => {
  const cases = [
    {
      error: {
        type: 'entity.parse.failed',
        status: 400,
        message: 'PARSER_MESSAGE_CANARY',
        body: 'PARSER_BODY_CANARY',
      },
      code: 'MALFORMED_JSON',
      status: 400,
    },
    {
      error: {
        type: 'entity.too.large',
        statusCode: 413,
        message: 'OVERSIZE_MESSAGE_CANARY',
        limit: 'OVERSIZE_LIMIT_CANARY',
      },
      code: 'PAYLOAD_TOO_LARGE',
      status: 413,
    },
  ];

  for (const testCase of cases) {
    const storage = new RequestContextStorage();
    let failureLogs = 0;
    const boundary = boundaryWithLogger(storage, {
      httpRequestFailed() {
        failureLogs += 1;
      },
    });
    const middleware = new BodyParserErrorMiddleware(boundary);
    const response = responseDouble();

    storage.run(
      { requestId: `parser-${testCase.status}`, abortSignal: {} },
      () => {
        middleware.use(
          testCase.error,
          requestDouble({ method: 'POST' }),
          response,
          () => assert.fail('known parser failure must not continue'),
        );
      },
    );

    assert.equal(response.statusCode, testCase.status);
    assert.equal(response.body.code, testCase.code);
    assert.equal(failureLogs, 0);
    const serialized = JSON.stringify(response.body);
    for (const canary of Object.values(testCase.error).filter(
      (value) => typeof value === 'string' && value.includes('CANARY'),
    )) {
      assert.equal(serialized.includes(canary), false);
    }
  }
});

test('POST /v1/tasks rejects missing and unsupported media types before downstream work', () => {
  const rejected = [
    undefined,
    'text/plain',
    'application/xml',
    'application/vnd.example+json',
  ];

  for (const contentType of rejected) {
    const storage = new RequestContextStorage();
    const boundary = boundaryWithLogger(storage, {
      httpRequestFailed: failOnUnexpectedHttpRequestLog,
    });
    const middleware = new TaskContentTypeMiddleware(boundary);
    const response = responseDouble();
    let downstreamExecuted = false;
    const request = requestDouble({
      method: 'POST',
      path: '/v1/tasks',
      get(name) {
        assert.equal(name, 'content-type');
        return contentType;
      },
    });

    storage.run({ requestId: 'media-type-request', abortSignal: {} }, () => {
      middleware.use(request, response, () => {
        downstreamExecuted = true;
      });
    });

    assert.equal(downstreamExecuted, false);
    assert.equal(response.statusCode, 415);
    assert.equal(response.body.code, 'UNSUPPORTED_MEDIA_TYPE');
    assert.equal(response.body.requestId, 'media-type-request');
  }
});

test('POST /v1/tasks accepts application/json with standard parameters', () => {
  for (const contentType of [
    'application/json',
    'application/json; charset=utf-8',
    'Application/JSON; Charset=UTF-8',
  ]) {
    const storage = new RequestContextStorage();
    const middleware = new TaskContentTypeMiddleware(
      boundaryWithLogger(storage, {
        httpRequestFailed: failOnUnexpectedHttpRequestLog,
      }),
    );
    const response = responseDouble();
    let downstreamExecuted = false;

    middleware.use(
      requestDouble({
        method: 'POST',
        path: '/v1/tasks',
        get() {
          return contentType;
        },
      }),
      response,
      () => {
        downstreamExecuted = true;
      },
    );

    assert.equal(downstreamExecuted, true);
    assert.equal(response.ended, false);
  }
});

test('Task media-type policy does not reject other methods or routes', () => {
  const storage = new RequestContextStorage();
  const middleware = new TaskContentTypeMiddleware(
    boundaryWithLogger(storage, {
      httpRequestFailed: failOnUnexpectedHttpRequestLog,
    }),
  );

  for (const request of [
    requestDouble({ method: 'GET', path: '/v1/tasks' }),
    requestDouble({ method: 'POST', path: '/health/live' }),
    requestDouble({ method: 'POST', path: '/v1/other' }),
  ]) {
    let downstreamExecuted = false;
    middleware.use(request, responseDouble(), () => {
      downstreamExecuted = true;
    });
    assert.equal(downstreamExecuted, true);
  }
});

test('strict validation rejects unknown fields and does not implicitly convert values', async () => {
  class TestPayload {
    title;
  }
  Reflect.defineMetadata('design:type', String, TestPayload.prototype, 'title');
  IsString()(TestPayload.prototype, 'title');

  const pipe = new StrictValidationPipe();
  const metadata = { type: 'body', metatype: TestPayload, data: undefined };
  const submittedCanary = 'SUBMITTED_VALUE_CANARY';

  await assert.rejects(
    pipe.transform({ title: 'valid', extra: submittedCanary }, metadata),
    (error) => {
      assert.equal(error instanceof RequestValidationError, true);
      assert.equal('target' in error, false);
      assert.equal('value' in error, false);
      assert.equal(JSON.stringify(error).includes(submittedCanary), false);
      return true;
    },
  );

  await assert.rejects(
    pipe.transform({ title: 123 }, metadata),
    (error) => error instanceof RequestValidationError,
  );

  assert.deepEqual(await pipe.transform({ title: 'valid' }, metadata), {
    title: 'valid',
  });
});

test('validation failure becomes sanitized VALIDATION_ERROR Problem Details', () => {
  const storage = new RequestContextStorage();
  const boundary = boundaryWithLogger(storage, {
    httpRequestFailed: failOnUnexpectedHttpRequestLog,
  });
  const filter = new ProblemDetailsExceptionFilter(boundary);
  const response = responseDouble();
  const validationError = new RequestValidationError();
  validationError.submitted = 'VALIDATION_CANARY';

  storage.run({ requestId: 'validation-request', abortSignal: {} }, () => {
    filter.catch(
      validationError,
      hostDouble(
        requestDouble({ method: 'POST', route: { path: '/v1/tasks' } }),
        response,
      ),
    );
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'VALIDATION_ERROR');
  assert.equal(response.body.requestId, 'validation-request');
  assert.equal(
    JSON.stringify(response.body).includes('VALIDATION_CANARY'),
    false,
  );
  assert.equal('errors' in response.body, false);
});

test('DRAINING /v1 returns Problem Details, closes the connection, blocks downstream, and remains completion-loggable', () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  lifecycle.beginDraining();
  const storage = new RequestContextStorage();
  const completionRecords = [];
  const logger = {
    requestCompleted(completion, level) {
      completionRecords.push({ completion, level });
    },
    httpRequestFailed() {
      assert.fail('known DRAINING rejection must not be detailed-error logged');
    },
  };
  const boundary = boundaryWithLogger(storage, logger);
  const contextMiddleware = new RequestContextMiddleware(storage);
  const loggingMiddleware = new RequestLoggingMiddleware(storage, logger);
  const drainingGate = new DrainingGateMiddleware(lifecycle, boundary);
  const response = responseDouble();
  const abortSignal = { source: 'native-request-signal' };
  const request = requestDouble({
    method: 'POST',
    path: '/v1/tasks',
    headersDistinct: { 'x-request-id': ['draining-request'] },
    signal: abortSignal,
  });
  let downstreamExecuted = false;

  contextMiddleware.use(request, response, () => {
    assert.equal(storage.get().requestId, 'draining-request');
    assert.equal(storage.get().abortSignal, abortSignal);
    loggingMiddleware.use(request, response, () => {
      drainingGate.use(request, response, () => {
        downstreamExecuted = true;
      });
    });
  });

  assert.equal(downstreamExecuted, false);
  assert.equal(response.statusCode, 503);
  assert.equal(response.getHeader('connection'), 'close');
  assert.equal(response.getHeader('x-request-id'), 'draining-request');
  assert.equal(
    response.getHeader('content-type'),
    PROBLEM_DETAILS_CONTENT_TYPE,
  );
  assert.equal(response.body.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(response.body.requestId, 'draining-request');
  assert.equal(completionRecords.length, 1);
  assert.equal(completionRecords[0].completion.statusCode, 503);
  assert.equal(completionRecords[0].completion.requestId, 'draining-request');
});

test('unexpected exception is sanitized publicly and detailed internally exactly once', () => {
  const storage = new RequestContextStorage();
  const capture = captureDestination();
  const logger = new ApplicationLogger('info', capture.destination);
  const boundary = boundaryWithLogger(storage, logger);
  const filter = new ProblemDetailsExceptionFilter(boundary);
  const response = responseDouble();
  const request = requestDouble({
    method: 'PATCH',
    path: '/v1/tasks/literal-id',
    route: { path: '/v1/tasks/:id' },
  });
  const error = new Error('RAW_ERROR_MESSAGE_CANARY');
  error.cause = { secret: 'NESTED_CAUSE_CANARY' };
  error.metadata = { secret: 'NESTED_METADATA_CANARY' };

  storage.run({ requestId: 'failure-request', abortSignal: {} }, () => {
    filter.catch(error, hostDouble(request, response));
  });

  assertProblem(response, {
    type: 'urn:nestjs-production-starter:problem:internal-error',
    title: 'Internal server error',
    status: 500,
    detail: 'An internal server error occurred.',
    code: 'INTERNAL_ERROR',
    requestId: 'failure-request',
  });
  const publicPayload = JSON.stringify(response.body);
  assert.equal(publicPayload.includes('RAW_ERROR_MESSAGE_CANARY'), false);
  assert.equal(publicPayload.includes('NESTED_CAUSE_CANARY'), false);
  assert.equal(publicPayload.includes('NESTED_METADATA_CANARY'), false);
  assert.equal(publicPayload.includes('stack'), false);

  const records = capture.records();
  assert.equal(records.length, 1);
  assert.deepEqual(Object.keys(records[0]).sort(), [
    'error_type',
    'event',
    'level',
    'method',
    'request_id',
    'route',
    'service',
    'time',
  ]);
  assert.equal(records[0].service, 'nestjs-production-starter');
  assert.equal(records[0].event, 'http_request_failed');
  assert.equal(records[0].request_id, 'failure-request');
  assert.equal(records[0].error_type, 'Error');
  assert.equal(records[0].method, 'PATCH');
  assert.equal(records[0].route, '/v1/tasks/:id');
  assert.equal(records[0].level, 50);
  const internalOutput = capture.output();
  for (const canary of [
    'RAW_ERROR_MESSAGE_CANARY',
    'NESTED_CAUSE_CANARY',
    'NESTED_METADATA_CANARY',
    'literal-id',
  ]) {
    assert.equal(internalOutput.includes(canary), false, canary);
  }
});

test('unexpected failure logging bounds arbitrary method and unmatched route', () => {
  const storage = new RequestContextStorage();
  const failures = [];
  const boundary = boundaryWithLogger(storage, {
    httpRequestFailed(failure) {
      failures.push(failure);
    },
  });

  storage.run({ requestId: 'bounded-failure', abortSignal: {} }, () => {
    boundary.unexpected(
      { arbitrary: 'NESTED_CANARY' },
      requestDouble({
        method: 'USER_CONTROLLED_METHOD',
        path: '/raw/RAW_PATH_CANARY',
      }),
      responseDouble(),
    );
  });

  assert.deepEqual(failures, [
    {
      requestId: 'bounded-failure',
      errorType: 'UnknownError',
      method: 'OTHER',
      route: 'UNMATCHED',
    },
  ]);
});

test('known Nest HttpException preserves framework status/response without unexpected logging', () => {
  const storage = new RequestContextStorage();
  let failureLogs = 0;
  const boundary = boundaryWithLogger(storage, {
    httpRequestFailed() {
      failureLogs += 1;
    },
  });
  const filter = new ProblemDetailsExceptionFilter(boundary);
  const response = responseDouble();
  const request = requestDouble({
    method: 'GET',
    path: '/v1/known-client-failure',
    route: { path: '/v1/known-client-failure' },
  });

  storage.run({ requestId: 'known-http', abortSignal: {} }, () => {
    filter.catch(
      new HttpException(
        { statusCode: 422, message: 'Known client failure' },
        422,
      ),
      hostDouble(request, response),
    );
  });

  assert.equal(response.statusCode, 422);
  assert.deepEqual(response.body, {
    statusCode: 422,
    message: 'Known client failure',
  });
  assert.equal(response.body.code, undefined);
  assert.equal(response.body.type, undefined);
  assert.equal(failureLogs, 0);
});

test('unexpected Nest 5xx HttpException payload is sanitized and logged once', () => {
  const storage = new RequestContextStorage();
  const capture = captureDestination();
  const logger = new ApplicationLogger('info', capture.destination);
  const boundary = boundaryWithLogger(storage, logger);
  const filter = new ProblemDetailsExceptionFilter(boundary);
  const response = responseDouble();
  const request = requestDouble({
    method: 'POST',
    path: '/v1/tasks',
    route: { path: '/v1/tasks' },
  });
  const exception = new HttpException(
    {
      statusCode: 500,
      message: 'RAW_5XX_HTTP_EXCEPTION_CANARY',
      sql: 'SELECT_5XX_CANARY',
      nested: { secret: 'NESTED_5XX_CANARY' },
    },
    500,
    { cause: new Error('CAUSE_5XX_CANARY') },
  );

  storage.run({ requestId: 'unexpected-http-5xx', abortSignal: {} }, () => {
    filter.catch(exception, hostDouble(request, response));
  });

  assertProblem(response, {
    type: 'urn:nestjs-production-starter:problem:internal-error',
    title: 'Internal server error',
    status: 500,
    detail: 'An internal server error occurred.',
    code: 'INTERNAL_ERROR',
    requestId: 'unexpected-http-5xx',
  });
  const combinedOutput = `${JSON.stringify(response.body)}\n${capture.output()}`;
  for (const canary of [
    'RAW_5XX_HTTP_EXCEPTION_CANARY',
    'SELECT_5XX_CANARY',
    'NESTED_5XX_CANARY',
    'CAUSE_5XX_CANARY',
  ]) {
    assert.equal(combinedOutput.includes(canary), false, canary);
  }

  const records = capture.records();
  assert.equal(records.length, 1);
  assert.equal(records[0].event, 'http_request_failed');
  assert.equal(records[0].request_id, 'unexpected-http-5xx');
  assert.equal(records[0].error_type, 'Error');
  assert.equal(records[0].route, '/v1/tasks');
});

test('ordinary Nest NotFoundException remains 404 and is not mislabeled TASK_NOT_FOUND', () => {
  const storage = new RequestContextStorage();
  let failureLogs = 0;
  const boundary = boundaryWithLogger(storage, {
    httpRequestFailed() {
      failureLogs += 1;
    },
  });
  const filter = new ProblemDetailsExceptionFilter(boundary);
  const response = responseDouble();
  const request = requestDouble({
    method: 'GET',
    path: '/v1/unknown-framework-route',
  });

  storage.run({ requestId: 'framework-404', abortSignal: {} }, () => {
    filter.catch(new NotFoundException(), hostDouble(request, response));
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.statusCode, 404);
  assert.equal(response.body.code, undefined);
  assert.equal(response.body.type, undefined);
  assert.notEqual(response.body.code, 'TASK_NOT_FOUND');
  assert.equal(
    JSON.stringify(response.body).includes(
      'urn:nestjs-production-starter:problem:not-found',
    ),
    false,
  );
  assert.equal(failureLogs, 0);
});

test('routine readiness HttpException remains operational JSON, not Problem Details', () => {
  const storage = new RequestContextStorage();
  const boundary = boundaryWithLogger(storage, {
    httpRequestFailed() {
      assert.fail(
        'routine readiness failure must not be detailed-error logged',
      );
    },
  });
  const filter = new ProblemDetailsExceptionFilter(boundary);
  const response = responseDouble();
  const request = requestDouble({
    method: 'GET',
    path: '/health/ready',
    route: { path: '/health/ready' },
  });

  filter.catch(
    new ServiceUnavailableException({ status: 'not_ready' }),
    hostDouble(request, response),
  );

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { status: 'not_ready' });
  assert.notEqual(
    response.getHeader('content-type'),
    PROBLEM_DETAILS_CONTENT_TYPE,
  );
});

test('liveness controller behavior remains unchanged', () => {
  assert.deepEqual(new LivenessController().live(), { status: 'live' });
});

test('unexpected operational exception is sanitized and logged once', () => {
  const storage = new RequestContextStorage();
  const failures = [];
  const boundary = boundaryWithLogger(storage, {
    httpRequestFailed(failure) {
      failures.push(failure);
    },
  });
  const filter = new ProblemDetailsExceptionFilter(boundary);
  const response = responseDouble();
  const request = requestDouble({
    method: 'GET',
    path: '/health/live',
    route: { path: '/health/live' },
  });

  storage.run({ requestId: 'health-failure', abortSignal: {} }, () => {
    filter.catch(
      new Error('OPERATIONAL_ERROR_CANARY'),
      hostDouble(request, response),
    );
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.code, 'INTERNAL_ERROR');
  assert.equal(
    JSON.stringify(response.body).includes('OPERATIONAL_ERROR_CANARY'),
    false,
  );
  assert.deepEqual(failures, [
    {
      requestId: 'health-failure',
      errorType: 'Error',
      method: 'GET',
      route: '/health/live',
    },
  ]);
});
