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

test('HTTP application installs context, request logging, Helmet, drain gate, then the exact JSON bound', () => {
  const registrations = [];
  let requestContextCalls = 0;
  let requestLoggingCalls = 0;
  let drainingGateCalls = 0;
  const requestContextMiddleware = {
    use() {
      requestContextCalls += 1;
    },
  };
  const requestLoggingMiddleware = {
    use() {
      requestLoggingCalls += 1;
    },
  };
  const drainingGateMiddleware = {
    use() {
      drainingGateCalls += 1;
    },
  };
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
    requestLoggingMiddleware,
    drainingGateMiddleware,
  );

  assert.equal(JSON_BODY_LIMIT_BYTES, 102_400);
  assert.equal(registrations.length, 5);
  for (const registration of registrations.slice(0, 4)) {
    assert.equal(registration.kind, 'middleware');
    assert.equal(typeof registration.value, 'function');
  }
  assert.deepEqual(registrations[4], {
    kind: 'body-parser',
    parser: 'json',
    options: { limit: 102_400 },
  });

  registrations[0].value();
  assert.equal(requestContextCalls, 1);
  assert.equal(requestLoggingCalls, 0);
  assert.equal(drainingGateCalls, 0);

  registrations[1].value();
  assert.equal(requestContextCalls, 1);
  assert.equal(requestLoggingCalls, 1);
  assert.equal(drainingGateCalls, 0);

  registrations[3].value();
  assert.equal(requestContextCalls, 1);
  assert.equal(requestLoggingCalls, 1);
  assert.equal(drainingGateCalls, 1);
});
