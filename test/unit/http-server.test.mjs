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

test('HTTP application installs Helmet and bounds JSON parsing to exactly 100 KiB', () => {
  const middleware = [];
  const bodyParsers = [];
  const app = {
    use(value) {
      middleware.push(value);
      return this;
    },
    useBodyParser(parser, options) {
      bodyParsers.push({ parser, options });
      return this;
    },
  };

  configureHttpApplication(app);

  assert.equal(JSON_BODY_LIMIT_BYTES, 102_400);
  assert.equal(middleware.length, 1);
  assert.equal(typeof middleware[0], 'function');
  assert.deepEqual(bodyParsers, [
    { parser: 'json', options: { limit: 102_400 } },
  ]);
});
