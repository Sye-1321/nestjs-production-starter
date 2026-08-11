import assert from 'node:assert/strict';
import test from 'node:test';

import { Lifecycle } from '../../dist/bootstrap/lifecycle.js';
import { ReadinessService } from '../../dist/platform/health/readiness.service.js';

function createProbe(result) {
  let calls = 0;

  return {
    probe: {
      async isReady() {
        calls += 1;
        return result;
      },
    },
    calls: () => calls,
  };
}

test('BOOTING is not ready and does not invoke the dependency probe', async () => {
  const lifecycle = new Lifecycle();
  const controlled = createProbe(true);
  const readiness = new ReadinessService(lifecycle, controlled.probe);

  assert.equal(await readiness.isReady(), false);
  assert.equal(controlled.calls(), 0);
});

test('DRAINING is not ready and does not invoke the dependency probe', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.beginDraining();
  const controlled = createProbe(true);
  const readiness = new ReadinessService(lifecycle, controlled.probe);

  assert.equal(await readiness.isReady(), false);
  assert.equal(controlled.calls(), 0);
});

test('READY without a real dependency probe fails closed', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  const readiness = new ReadinessService(lifecycle, null);

  assert.equal(await readiness.isReady(), false);
});

test('READY with a successful injected probe evaluates true in policy evidence', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  const controlled = createProbe(true);
  const readiness = new ReadinessService(lifecycle, controlled.probe);

  assert.equal(await readiness.isReady(), true);
  assert.equal(controlled.calls(), 1);
});

test('READY with an unsuccessful injected probe evaluates false', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  const controlled = createProbe(false);
  const readiness = new ReadinessService(lifecycle, controlled.probe);

  assert.equal(await readiness.isReady(), false);
  assert.equal(controlled.calls(), 1);
});

test('READY with a rejected injected probe evaluates false safely', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  let calls = 0;
  const readiness = new ReadinessService(lifecycle, {
    async isReady() {
      calls += 1;
      throw new Error('probe failure');
    },
  });

  assert.equal(await readiness.isReady(), false);
  assert.equal(calls, 1);
});

test('readiness rechecks lifecycle after the asynchronous probe', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  const readiness = new ReadinessService(lifecycle, {
    async isReady() {
      lifecycle.beginDraining();
      return true;
    },
  });

  assert.equal(await readiness.isReady(), false);
  assert.equal(lifecycle.state, 'DRAINING');
});
