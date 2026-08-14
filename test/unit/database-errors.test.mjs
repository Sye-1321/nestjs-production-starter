import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DatabaseUnavailableError,
  isObservedPrismaPgPoolAcquisitionTimeout,
  isObservedPrismaPgTaskConnectionRefused,
  isObservedPrismaPgTaskStatementTimeout,
  isObservedPrismaPgUnexpectedConnectionTermination,
} from '../../dist/platform/database/database.errors.js';

function observedAcquisitionTimeoutError() {
  const error = new Error('timeout exceeded when trying to connect');
  error.clientVersion = '7.9.1';
  return error;
}

function observedUnexpectedConnectionTerminationError() {
  const error = new Error('Connection terminated unexpectedly');
  error.clientVersion = '7.9.1';
  return error;
}

function observedTaskConnectionRefusedError() {
  class PrismaClientKnownRequestError extends Error {}

  const error = new PrismaClientKnownRequestError(
    '\nInvalid `prisma.task.create()` invocation:\n\n\n',
  );
  error.name = 'PrismaClientKnownRequestError';
  error.clientVersion = '7.9.1';
  error.code = 'ECONNREFUSED';
  error.meta = { modelName: 'Task' };
  error.batchRequestIdx = undefined;
  return error;
}

function observedTaskStatementTimeoutError() {
  class PrismaClientKnownRequestError extends Error {}
  class DriverAdapterError extends Error {}

  const cause = {
    originalCode: '57014',
    originalMessage: 'canceling statement due to statement timeout',
    kind: 'postgres',
    code: '57014',
    severity: 'ERROR',
    message: 'canceling statement due to statement timeout',
    column: undefined,
    detail: undefined,
    hint: undefined,
  };
  const driverAdapterError = new DriverAdapterError(
    'canceling statement due to statement timeout',
    { cause },
  );
  driverAdapterError.name = 'DriverAdapterError';
  const error = new PrismaClientKnownRequestError(
    'Database error. Code: `57014`.',
  );
  error.name = 'PrismaClientKnownRequestError';
  error.clientVersion = '7.9.1';
  error.code = 'P2039';
  error.meta = { modelName: 'Task', driverAdapterError };
  error.batchRequestIdx = undefined;
  return error;
}

test('classifier accepts the exact observed pinned pg-pool acquisition timeout', () => {
  assert.equal(
    isObservedPrismaPgPoolAcquisitionTimeout(observedAcquisitionTimeoutError()),
    true,
  );
});

test('classifier accepts the exact observed pinned unexpected connection termination', () => {
  assert.equal(
    isObservedPrismaPgUnexpectedConnectionTermination(
      observedUnexpectedConnectionTerminationError(),
    ),
    true,
  );
});

test('classifier accepts the exact observed pinned Task connection refusal', () => {
  assert.equal(
    isObservedPrismaPgTaskConnectionRefused(
      observedTaskConnectionRefusedError(),
    ),
    true,
  );
});

test('classifier accepts the exact observed pinned Task statement timeout', () => {
  assert.equal(
    isObservedPrismaPgTaskStatementTimeout(observedTaskStatementTimeoutError()),
    true,
  );
});

test('classifier rejects the same observed shape with a different message', () => {
  const error = observedAcquisitionTimeoutError();
  error.message = 'A completely different message';

  assert.deepEqual(Object.getOwnPropertyNames(error).sort(), [
    'clientVersion',
    'message',
    'stack',
  ]);
  assert.equal(error.constructor, Error);
  assert.equal(error.name, 'Error');
  assert.equal(isObservedPrismaPgPoolAcquisitionTimeout(error), false);
  assert.equal(isObservedPrismaPgUnexpectedConnectionTermination(error), false);
});

test('connection-termination classifier rejects the same shape with a different message', () => {
  const error = observedUnexpectedConnectionTerminationError();
  error.message = 'Connection terminated by application code';

  assert.deepEqual(Object.getOwnPropertyNames(error).sort(), [
    'clientVersion',
    'message',
    'stack',
  ]);
  assert.equal(isObservedPrismaPgUnexpectedConnectionTermination(error), false);
});

test('Task connection-refusal classifier rejects near misses', () => {
  const cases = [
    ['different code', (error) => (error.code = 'ETIMEDOUT')],
    ['different version', (error) => (error.clientVersion = '7.9.0')],
    ['different model', (error) => (error.meta = { modelName: 'User' })],
    ['extra metadata', (error) => (error.meta.extra = 'canary')],
    ['batch request', (error) => (error.batchRequestIdx = 0)],
    ['extra property', (error) => (error.extra = 'canary')],
    ['different name', (error) => (error.name = 'Error')],
  ];

  for (const [label, mutate] of cases) {
    const error = observedTaskConnectionRefusedError();
    mutate(error);
    assert.equal(isObservedPrismaPgTaskConnectionRefused(error), false, label);
  }
});

test('Task statement-timeout classifier rejects near misses', () => {
  const cases = [
    ['different Prisma code', (error) => (error.code = 'P2021')],
    ['different version', (error) => (error.clientVersion = '7.9.0')],
    ['different model', (error) => (error.meta.modelName = 'User')],
    [
      'different PostgreSQL code',
      (error) => (error.meta.driverAdapterError.cause.code = '57P01'),
    ],
    [
      'generic cancellation',
      (error) => {
        error.meta.driverAdapterError.cause.message =
          'canceling statement due to user request';
      },
    ],
    [
      'extra driver metadata',
      (error) => (error.meta.driverAdapterError.cause.where = 'canary'),
    ],
    ['extra Prisma metadata', (error) => (error.meta.extra = 'canary')],
    ['batch request', (error) => (error.batchRequestIdx = 0)],
  ];

  for (const [label, mutate] of cases) {
    const error = observedTaskStatementTimeoutError();
    mutate(error);
    assert.equal(isObservedPrismaPgTaskStatementTimeout(error), false, label);
  }
});

test('classifier rejects unrelated and structurally richer database errors', () => {
  class PrismaClientKnownRequestError extends Error {}

  const knownDatabaseError = new PrismaClientKnownRequestError(
    'RELATION_CANARY',
  );
  knownDatabaseError.clientVersion = '7.9.1';
  knownDatabaseError.code = 'P2021';
  knownDatabaseError.meta = { modelName: 'Task' };

  for (const error of [
    new Error('ordinary application failure'),
    Object.assign(new Error('wrong version'), { clientVersion: '7.9.0' }),
    Object.assign(new Error('coded driver error'), {
      clientVersion: '7.9.1',
      code: 'ECONNREFUSED',
    }),
    knownDatabaseError,
    new TypeError('programming failure'),
    { clientVersion: '7.9.1' },
  ]) {
    assert.equal(isObservedPrismaPgPoolAcquisitionTimeout(error), false);
    assert.equal(
      isObservedPrismaPgUnexpectedConnectionTermination(error),
      false,
    );
    assert.equal(isObservedPrismaPgTaskConnectionRefused(error), false);
    assert.equal(isObservedPrismaPgTaskStatementTimeout(error), false);
  }
});

test('DatabaseUnavailableError exposes one fixed sanitized identity', () => {
  const error = new DatabaseUnavailableError();

  assert.equal(error.name, 'DatabaseUnavailableError');
  assert.equal(error.message, 'Required database is unavailable');
  assert.deepEqual(Object.keys(error), ['name']);
});
