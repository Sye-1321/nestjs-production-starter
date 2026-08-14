import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configureHttpApplication,
  configureHttpServer,
  JSON_BODY_LIMIT_BYTES,
} from '../../dist/bootstrap/http-server.js';

test('raw Node HTTP server receives the exact fixed transport policy', () => {
  const server = {
    headersTimeout: -1,
    requestTimeout: -1,
    keepAliveTimeout: -1,
    keepAliveTimeoutBuffer: -1,
    timeout: -1,
  };

  configureHttpServer(server);

  assert.deepEqual(server, {
    headersTimeout: 15_000,
    requestTimeout: 30_000,
    keepAliveTimeout: 5_000,
    keepAliveTimeoutBuffer: 1_000,
    timeout: 0,
  });
});

test('HTTP application installs the complete pre-router policy in frozen order', () => {
  const registrations = [];
  const calls = [];
  const middleware = (name, arity = 0) => ({
    use:
      arity === 4
        ? function use(error, request, response, next) {
            void error;
            void request;
            void response;
            void next;
            calls.push(name);
          }
        : function use() {
            calls.push(name);
          },
  });
  const requestContextMiddleware = middleware('context');
  const requestMetricsMiddleware = middleware('metrics');
  const requestLoggingMiddleware = middleware('logging');
  const drainingGateMiddleware = middleware('draining');
  const taskContentTypeMiddleware = middleware('content-type');
  const bodyParserErrorMiddleware = middleware('parser-error', 4);
  const app = {
    use(value) {
      registrations.push({ kind: 'middleware', value });
      return this;
    },
    useBodyParser(parser, options) {
      registrations.push({ kind: 'body-parser', parser, options });
      return this;
    },
  };

  configureHttpApplication(
    app,
    requestContextMiddleware,
    requestMetricsMiddleware,
    requestLoggingMiddleware,
    drainingGateMiddleware,
    taskContentTypeMiddleware,
    bodyParserErrorMiddleware,
  );

  assert.equal(JSON_BODY_LIMIT_BYTES, 102_400);
  assert.equal(registrations.length, 8);
  assert.equal(registrations[0].kind, 'middleware');
  assert.equal(registrations[1].kind, 'middleware');
  assert.equal(registrations[2].kind, 'middleware');
  assert.equal(registrations[3].kind, 'middleware');
  assert.equal(registrations[4].kind, 'middleware');
  assert.equal(registrations[5].kind, 'middleware');
  assert.deepEqual(registrations[6], {
    kind: 'body-parser',
    parser: 'json',
    options: { limit: 102_400 },
  });
  assert.equal(registrations[7].kind, 'middleware');
  assert.equal(registrations[7].value.length, 4);

  registrations[0].value();
  registrations[1].value();
  registrations[2].value();
  registrations[4].value();
  registrations[5].value();
  assert.deepEqual(calls, [
    'context',
    'metrics',
    'logging',
    'draining',
    'content-type',
  ]);
});
