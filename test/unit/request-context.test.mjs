import assert from 'node:assert/strict';
import test from 'node:test';

import { setTimeout as scheduleTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';

import { Lifecycle } from '../../dist/bootstrap/lifecycle.js';
import { ContextModule } from '../../dist/platform/context/context.module.js';
import { DrainingGateMiddleware } from '../../dist/platform/context/draining-gate.middleware.js';
import { RequestContextMiddleware } from '../../dist/platform/context/request-context.middleware.js';
import { RequestContextStorage } from '../../dist/platform/context/request-context.js';

function drainingProblemBoundary() {
  return {
    respond(response, code) {
      assert.equal(code, 'DEPENDENCY_UNAVAILABLE');
      response.statusCode = 503;
      response.end();
    },
  };
}

function responseDouble() {
  const headers = new Map();
  return {
    headers,
    ended: false,
    statusCode: 200,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    end() {
      this.ended = true;
    },
  };
}

test('context module is one global registration over the owned lifecycle', () => {
  const lifecycle = new Lifecycle();
  const definition = ContextModule.forRoot(lifecycle);
  const providers = definition.providers;

  assert.equal(definition.global, true);
  assert.ok(Array.isArray(providers));
  assert.equal(
    providers.filter((provider) => provider === RequestContextStorage).length,
    1,
  );
  assert.equal(
    providers.filter((provider) => provider === RequestContextMiddleware)
      .length,
    1,
  );
  assert.equal(
    providers.filter((provider) => provider === DrainingGateMiddleware).length,
    1,
  );

  const lifecycleProviders = providers.filter(
    (provider) =>
      typeof provider === 'object' &&
      provider !== null &&
      provider.provide === Lifecycle,
  );
  assert.equal(lifecycleProviders.length, 1);
  assert.equal(lifecycleProviders[0].useValue, lifecycle);
  assert.deepEqual(definition.exports, [RequestContextStorage]);
});

test('request context survives promise and timer continuations', async () => {
  const storage = new RequestContextStorage();
  const abortSignal = { source: 'native-request-signal' };

  await storage.run({ requestId: 'context-request', abortSignal }, async () => {
    assert.deepEqual(Object.keys(storage.get()).sort(), [
      'abortSignal',
      'requestId',
    ]);
    assert.equal(storage.get().requestId, 'context-request');
    assert.equal(storage.get().abortSignal, abortSignal);

    await Promise.resolve();
    await delay(0);

    assert.equal(storage.get().requestId, 'context-request');
    assert.equal(storage.get().abortSignal, abortSignal);
  });

  assert.equal(storage.get(), undefined);
});

test('request middleware propagates one chosen ID and the native request signal', async () => {
  const storage = new RequestContextStorage();
  const middleware = new RequestContextMiddleware(storage);
  const abortSignal = { source: 'incoming-message' };
  const request = {
    headersDistinct: { 'x-request-id': ['upstream-123'] },
    signal: abortSignal,
  };
  const response = responseDouble();

  await new Promise((resolve, reject) => {
    middleware.use(request, response, () => {
      scheduleTimeout(() => {
        try {
          assert.equal(response.headers.get('x-request-id'), 'upstream-123');
          assert.equal(storage.get().requestId, 'upstream-123');
          assert.equal(storage.get().abortSignal, abortSignal);
          resolve();
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  });
});

test('request context is established before a DRAINING business rejection', () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  lifecycle.beginDraining();
  const storage = new RequestContextStorage();
  const contextMiddleware = new RequestContextMiddleware(storage);
  const drainingGate = new DrainingGateMiddleware(
    lifecycle,
    drainingProblemBoundary(),
  );
  const abortSignal = { source: 'incoming-message' };
  const request = {
    headersDistinct: { 'x-request-id': ['draining-request'] },
    path: '/v1/tasks',
    signal: abortSignal,
  };
  const response = responseDouble();
  let downstreamExecuted = false;

  contextMiddleware.use(request, response, () => {
    assert.equal(storage.get().requestId, 'draining-request');
    assert.equal(storage.get().abortSignal, abortSignal);

    drainingGate.use(request, response, () => {
      downstreamExecuted = true;
    });
  });

  assert.equal(response.headers.get('x-request-id'), 'draining-request');
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers.get('connection'), 'close');
  assert.equal(response.ended, true);
  assert.equal(downstreamExecuted, false);
});

test('DRAINING rejects v1 business requests before downstream execution', () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  lifecycle.beginDraining();
  const middleware = new DrainingGateMiddleware(
    lifecycle,
    drainingProblemBoundary(),
  );

  for (const path of ['/v1', '/v1/tasks']) {
    const response = responseDouble();
    let downstreamExecuted = false;

    middleware.use({ path }, response, () => {
      downstreamExecuted = true;
    });

    assert.equal(downstreamExecuted, false);
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers.get('connection'), 'close');
    assert.equal(response.ended, true);
  }
});

test('READY permits v1 business requests to continue', () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  const middleware = new DrainingGateMiddleware(
    lifecycle,
    drainingProblemBoundary(),
  );
  const response = responseDouble();
  let downstreamExecuted = false;

  middleware.use({ path: '/v1/tasks' }, response, () => {
    downstreamExecuted = true;
  });

  assert.equal(downstreamExecuted, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.ended, false);
});

test('operational paths remain outside the business DRAINING gate', () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  lifecycle.beginDraining();
  const middleware = new DrainingGateMiddleware(
    lifecycle,
    drainingProblemBoundary(),
  );

  for (const path of ['/health/live', '/health/ready', '/metrics']) {
    const response = responseDouble();
    let downstreamExecuted = false;

    middleware.use({ path }, response, () => {
      downstreamExecuted = true;
    });

    assert.equal(downstreamExecuted, true);
    assert.equal(response.statusCode, 200);
    assert.equal(response.ended, false);
  }
});
