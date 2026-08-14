import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';
import { setImmediate } from 'node:timers';

import { Lifecycle } from '../../dist/bootstrap/lifecycle.js';
import { ShutdownCoordinator } from '../../dist/bootstrap/shutdown-coordinator.js';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function controlledDeadlineScheduler() {
  const deadlines = [];

  return {
    deadlines,
    schedule(callback, delayMs) {
      const deadline = { callback, delayMs, cancelled: false };
      deadlines.push(deadline);
      return {
        cancel() {
          deadline.cancelled = true;
        },
      };
    },
    fire(index = 0) {
      deadlines[index].callback();
    },
  };
}

test('first shutdown request enters DRAINING synchronously and records one absolute deadline', async () => {
  const lifecycle = new Lifecycle();
  const execution = deferred();
  const deadlineScheduler = controlledDeadlineScheduler();
  const contexts = [];
  const coordinator = new ShutdownCoordinator({
    lifecycle,
    shutdownTimeoutMs: 10_000,
    now: () => 1_000,
    forceShutdown: () => undefined,
    scheduleDeadline: deadlineScheduler.schedule,
    executeShutdown: async (context) => {
      contexts.push(context);
      await execution.promise;
    },
  });

  const shutdown = coordinator.requestShutdown('SIGTERM');

  assert.equal(lifecycle.state, 'DRAINING');
  assert.equal(coordinator.shutdownDeadlineAt, 11_000);
  assert.equal(deadlineScheduler.deadlines.length, 1);
  assert.equal(deadlineScheduler.deadlines[0].delayMs, 10_000);
  assert.equal(deadlineScheduler.deadlines[0].cancelled, false);

  await Promise.resolve();
  assert.deepEqual(contexts, [{ signal: 'SIGTERM', deadlineAt: 11_000 }]);

  execution.resolve();
  await shutdown;
  assert.equal(lifecycle.state, 'STOPPED');
  assert.equal(deadlineScheduler.deadlines[0].cancelled, true);
});

test('repeated shutdown requests preserve the original deadline and sequence', async () => {
  const lifecycle = new Lifecycle();
  const execution = deferred();
  const deadlineScheduler = controlledDeadlineScheduler();
  let now = 5_000;
  let executions = 0;
  const coordinator = new ShutdownCoordinator({
    lifecycle,
    shutdownTimeoutMs: 2_000,
    now: () => now,
    forceShutdown: () => undefined,
    scheduleDeadline: deadlineScheduler.schedule,
    executeShutdown: async () => {
      executions += 1;
      await execution.promise;
    },
  });

  const first = coordinator.requestShutdown('SIGTERM');
  now = 500_000;
  const second = coordinator.requestShutdown('SIGTERM');
  const third = coordinator.requestShutdown('SIGINT');

  assert.strictEqual(second, first);
  assert.strictEqual(third, first);
  assert.equal(coordinator.shutdownDeadlineAt, 7_000);
  assert.equal(lifecycle.state, 'DRAINING');
  assert.equal(deadlineScheduler.deadlines.length, 1);

  await Promise.resolve();
  assert.equal(executions, 1);

  execution.resolve();
  await first;
  assert.equal(executions, 1);
  assert.equal(lifecycle.state, 'STOPPED');
});

test('deadline force executes once while shutdown remains incomplete', async () => {
  const lifecycle = new Lifecycle();
  const execution = deferred();
  const deadlineScheduler = controlledDeadlineScheduler();
  const forcedContexts = [];
  const coordinator = new ShutdownCoordinator({
    lifecycle,
    shutdownTimeoutMs: 3_000,
    now: () => 7_000,
    executeShutdown: () => execution.promise,
    forceShutdown: (context) => forcedContexts.push(context),
    scheduleDeadline: deadlineScheduler.schedule,
  });

  const shutdown = coordinator.requestShutdown('SIGTERM');
  await Promise.resolve();
  deadlineScheduler.fire();
  deadlineScheduler.fire();

  assert.deepEqual(forcedContexts, [{ signal: 'SIGTERM', deadlineAt: 10_000 }]);
  assert.equal(lifecycle.state, 'DRAINING');

  execution.resolve();
  await shutdown;
  assert.equal(lifecycle.state, 'DRAINING');
});

test('completed shutdown cannot be forced by a stale deadline callback', async () => {
  const lifecycle = new Lifecycle();
  const deadlineScheduler = controlledDeadlineScheduler();
  let forceCount = 0;
  const coordinator = new ShutdownCoordinator({
    lifecycle,
    shutdownTimeoutMs: 500,
    executeShutdown: () => Promise.resolve(),
    forceShutdown: () => {
      forceCount += 1;
    },
    scheduleDeadline: deadlineScheduler.schedule,
  });

  await coordinator.requestShutdown('SIGINT');
  deadlineScheduler.fire();

  assert.equal(deadlineScheduler.deadlines[0].cancelled, true);
  assert.equal(forceCount, 0);
  assert.equal(lifecycle.state, 'STOPPED');
});

test('SIGTERM and SIGINT converge on the same shutdown sequence', async () => {
  const lifecycle = new Lifecycle();
  const coordinator = new ShutdownCoordinator({
    lifecycle,
    shutdownTimeoutMs: 1_000,
    now: () => 100,
    forceShutdown: () => undefined,
    executeShutdown: () => Promise.resolve(),
  });

  const sigterm = coordinator.requestShutdown('SIGTERM');
  const sigint = coordinator.requestShutdown('SIGINT');

  assert.strictEqual(sigint, sigterm);
  assert.equal(coordinator.shutdownDeadlineAt, 1_100);

  await sigterm;
  assert.equal(lifecycle.state, 'STOPPED');
});

test('signal handler installation is idempotent and removable', (t) => {
  const lifecycle = new Lifecycle();
  const coordinator = new ShutdownCoordinator({
    lifecycle,
    shutdownTimeoutMs: 1_000,
    forceShutdown: () => undefined,
    executeShutdown: () => Promise.resolve(),
  });
  const sigtermBefore = process.listenerCount('SIGTERM');
  const sigintBefore = process.listenerCount('SIGINT');

  t.after(() => coordinator.removeSignalHandlers());

  coordinator.installSignalHandlers();
  assert.equal(process.listenerCount('SIGTERM'), sigtermBefore + 1);
  assert.equal(process.listenerCount('SIGINT'), sigintBefore + 1);

  coordinator.installSignalHandlers();
  assert.equal(process.listenerCount('SIGTERM'), sigtermBefore + 1);
  assert.equal(process.listenerCount('SIGINT'), sigintBefore + 1);

  coordinator.removeSignalHandlers();
  assert.equal(process.listenerCount('SIGTERM'), sigtermBefore);
  assert.equal(process.listenerCount('SIGINT'), sigintBefore);
});

test('installed SIGTERM and SIGINT handlers converge on the same sequence', async (t) => {
  const lifecycle = new Lifecycle();
  const execution = deferred();
  let executions = 0;
  const coordinator = new ShutdownCoordinator({
    lifecycle,
    shutdownTimeoutMs: 1_000,
    now: () => 50,
    forceShutdown: () => undefined,
    executeShutdown: async () => {
      executions += 1;
      await execution.promise;
    },
  });
  const sigtermBefore = new Set(process.listeners('SIGTERM'));
  const sigintBefore = new Set(process.listeners('SIGINT'));

  t.after(() => coordinator.removeSignalHandlers());
  coordinator.installSignalHandlers();

  const sigtermHandler = process
    .listeners('SIGTERM')
    .find((listener) => !sigtermBefore.has(listener));
  const sigintHandler = process
    .listeners('SIGINT')
    .find((listener) => !sigintBefore.has(listener));

  assert.ok(sigtermHandler);
  assert.ok(sigintHandler);

  sigtermHandler();
  sigintHandler();
  const sequence = coordinator.requestShutdown('SIGTERM');

  assert.equal(lifecycle.state, 'DRAINING');
  assert.equal(coordinator.shutdownDeadlineAt, 1_050);

  await Promise.resolve();
  assert.equal(executions, 1);

  execution.resolve();
  await sequence;
  assert.equal(lifecycle.state, 'STOPPED');
});

test('successful shutdown execution transitions lifecycle to STOPPED', async () => {
  const lifecycle = new Lifecycle();
  let executions = 0;
  const coordinator = new ShutdownCoordinator({
    lifecycle,
    shutdownTimeoutMs: 1_000,
    forceShutdown: () => undefined,
    executeShutdown: async () => {
      executions += 1;
    },
  });

  await coordinator.requestShutdown('SIGINT');

  assert.equal(executions, 1);
  assert.equal(lifecycle.state, 'STOPPED');
});

test('signal-triggered shutdown rejection is observed exactly once', async (t) => {
  const lifecycle = new Lifecycle();
  const deadlineScheduler = controlledDeadlineScheduler();
  const failures = [];
  const coordinator = new ShutdownCoordinator({
    lifecycle,
    shutdownTimeoutMs: 1_000,
    forceShutdown: () => undefined,
    scheduleDeadline: deadlineScheduler.schedule,
    executeShutdown: async () => {
      throw new Error('shutdown failed');
    },
    onShutdownFailure: (error) => failures.push(error),
  });
  const sigtermBefore = new Set(process.listeners('SIGTERM'));
  const sigintBefore = new Set(process.listeners('SIGINT'));

  t.after(() => coordinator.removeSignalHandlers());
  coordinator.installSignalHandlers();

  const sigtermHandler = process
    .listeners('SIGTERM')
    .find((listener) => !sigtermBefore.has(listener));
  const sigintHandler = process
    .listeners('SIGINT')
    .find((listener) => !sigintBefore.has(listener));

  assert.ok(sigtermHandler);
  assert.ok(sigintHandler);

  sigtermHandler();
  sigintHandler();

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /shutdown failed/u);
  assert.equal(lifecycle.state, 'DRAINING');
});
