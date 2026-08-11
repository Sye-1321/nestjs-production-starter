import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Lifecycle,
  LifecycleTransitionError,
} from '../../dist/bootstrap/lifecycle.js';

function assertTransitionError(action, from, to) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof LifecycleTransitionError);
    assert.equal(error.from, from);
    assert.equal(error.to, to);
    assert.equal(
      error.message,
      `Invalid lifecycle transition: ${from} -> ${to}`,
    );
    return true;
  });
}

test('lifecycle starts in BOOTING', () => {
  const lifecycle = new Lifecycle();

  assert.equal(lifecycle.state, 'BOOTING');
});

test('lifecycle supports BOOTING -> READY -> DRAINING -> STOPPED', () => {
  const lifecycle = new Lifecycle();

  lifecycle.markReady();
  assert.equal(lifecycle.state, 'READY');

  lifecycle.beginDraining();
  assert.equal(lifecycle.state, 'DRAINING');

  lifecycle.markStopped();
  assert.equal(lifecycle.state, 'STOPPED');
});

test('lifecycle supports BOOTING -> FAILED_START', () => {
  const lifecycle = new Lifecycle();

  lifecycle.markFailedStart();

  assert.equal(lifecycle.state, 'FAILED_START');
});

test('lifecycle supports BOOTING -> DRAINING', () => {
  const lifecycle = new Lifecycle();

  lifecycle.beginDraining();

  assert.equal(lifecycle.state, 'DRAINING');
});

test('READY cannot overwrite DRAINING', () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();
  lifecycle.beginDraining();

  assertTransitionError(() => lifecycle.markReady(), 'DRAINING', 'READY');
  assert.equal(lifecycle.state, 'DRAINING');
});

test('FAILED_START cannot become READY', () => {
  const lifecycle = new Lifecycle();
  lifecycle.markFailedStart();

  assertTransitionError(() => lifecycle.markReady(), 'FAILED_START', 'READY');
  assert.equal(lifecycle.state, 'FAILED_START');
});

test('DRAINING cannot return to READY', () => {
  const lifecycle = new Lifecycle();
  lifecycle.beginDraining();

  assertTransitionError(() => lifecycle.markReady(), 'DRAINING', 'READY');
  assert.equal(lifecycle.state, 'DRAINING');
});

test('STOPPED is terminal', () => {
  const lifecycle = new Lifecycle();
  lifecycle.beginDraining();
  lifecycle.markStopped();

  assertTransitionError(() => lifecycle.markReady(), 'STOPPED', 'READY');
  assertTransitionError(() => lifecycle.beginDraining(), 'STOPPED', 'DRAINING');
  assertTransitionError(
    () => lifecycle.markFailedStart(),
    'STOPPED',
    'FAILED_START',
  );
  assertTransitionError(() => lifecycle.markStopped(), 'STOPPED', 'STOPPED');
  assert.equal(lifecycle.state, 'STOPPED');
});

test('invalid transitions fail deterministically without mutating state', () => {
  const lifecycle = new Lifecycle();
  lifecycle.markReady();

  assertTransitionError(
    () => lifecycle.markFailedStart(),
    'READY',
    'FAILED_START',
  );
  assert.equal(lifecycle.state, 'READY');

  assertTransitionError(() => lifecycle.markStopped(), 'READY', 'STOPPED');
  assert.equal(lifecycle.state, 'READY');
});
