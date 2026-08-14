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

function createMetrics() {
  const values = [];
  return {
    metrics: {
      setDependencyReady(ready) {
        values.push(ready);
      },
    },
    values,
  };
}

test('BOOTING is not ready and does not invoke the dependency probe', async () => {
  const lifecycle = new Lifecycle();
  const controlled = createDatabaseProbe();
  const captured = createMetrics();
  const readiness = new ReadinessService(
    lifecycle,
    controlled.database,
    captured.metrics,
  );

  assert.equal(await readiness.isReady(), false);
  assert.equal(controlled.calls(), 0);
  assert.deepEqual(captured.values, [false]);
});

test('DRAINING is not ready and does not invoke the dependency probe', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.beginDraining();
  const controlled = createDatabaseProbe();
  const captured = createMetrics();
  const readiness = new ReadinessService(
    lifecycle,
    controlled.database,
    captured.metrics,
  );

  assert.equal(await readiness.isReady(), false);
  assert.equal(controlled.calls(), 0);
  assert.deepEqual(captured.values, [false]);
});

test('READY runs the shared database probe and evaluates true on success', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  const controlled = createDatabaseProbe();
  const captured = createMetrics();
  const readiness = new ReadinessService(
    lifecycle,
    controlled.database,
    captured.metrics,
  );

  assert.equal(await readiness.isReady(), true);
  assert.equal(controlled.calls(), 1);
  assert.deepEqual(captured.values, [true]);
});

test('READY with a rejected database probe evaluates false safely', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  const controlled = createDatabaseProbe({ reject: true });
  const captured = createMetrics();
  const readiness = new ReadinessService(
    lifecycle,
    controlled.database,
    captured.metrics,
  );

  assert.equal(await readiness.isReady(), false);
  assert.equal(controlled.calls(), 1);
  assert.deepEqual(captured.values, [false]);
});

test('readiness rechecks lifecycle after the asynchronous probe', async () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  const controlled = createDatabaseProbe({
    onProbe: () => lifecycle.beginDraining(),
  });
  const captured = createMetrics();
  const readiness = new ReadinessService(
    lifecycle,
    controlled.database,
    captured.metrics,
  );

  assert.equal(await readiness.isReady(), false);
  assert.equal(lifecycle.state, 'DRAINING');
  assert.equal(controlled.calls(), 1);
  assert.deepEqual(captured.values, [false]);
});
