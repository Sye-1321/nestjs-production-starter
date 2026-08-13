import assert from 'node:assert/strict';
import test from 'node:test';

import { Lifecycle } from '../../dist/bootstrap/lifecycle.js';
import { ReadinessService } from '../../dist/platform/health/readiness.service.js';

function createDatabaseProbe({ reject = false, onProbe } = {}) {
  let calls = 0;

  return {
    database: {
      async probe() {
        calls += 1;
        onProbe?.();
        if (reject) throw new Error('probe failure');
      },
    },
    calls: () => calls,
  };
}

test('BOOTING is not ready and does not invoke the dependency probe', async () => {
  const lifecycle = new Lifecycle();
  const controlled = createDatabaseProbe();
  const readiness = new ReadinessService(lifecycle, controlled.database);

  assert.equal(await readiness.isReady(), false);
  assert.equal(controlled.calls(), 0);
});

test('DRAINING is not ready and does not invoke the dependency probe', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.beginDraining();
  const controlled = createDatabaseProbe();
  const readiness = new ReadinessService(lifecycle, controlled.database);

  assert.equal(await readiness.isReady(), false);
  assert.equal(controlled.calls(), 0);
});

test('READY runs the shared database probe and evaluates true on success', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  const controlled = createDatabaseProbe();
  const readiness = new ReadinessService(lifecycle, controlled.database);

  assert.equal(await readiness.isReady(), true);
  assert.equal(controlled.calls(), 1);
});

test('READY with a rejected database probe evaluates false safely', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  const controlled = createDatabaseProbe({ reject: true });
  const readiness = new ReadinessService(lifecycle, controlled.database);

  assert.equal(await readiness.isReady(), false);
  assert.equal(controlled.calls(), 1);
});

test('readiness rechecks lifecycle after the asynchronous probe', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  const controlled = createDatabaseProbe({
    onProbe: () => lifecycle.beginDraining(),
  });
  const readiness = new ReadinessService(lifecycle, controlled.database);

  assert.equal(await readiness.isReady(), false);
  assert.equal(lifecycle.state, 'DRAINING');
  assert.equal(controlled.calls(), 1);
});
