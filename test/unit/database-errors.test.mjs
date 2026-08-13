import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DatabaseUnavailableError,
  isObservedPrismaPgPoolAcquisitionTimeout,
} from '../../dist/platform/database/database.errors.js';

function observedAcquisitionTimeoutError() {
  const error = new Error('timeout exceeded when trying to connect');
  error.clientVersion = '7.9.1';
  return error;
}

test('classifier accepts the exact observed pinned pg-pool acquisition timeout', () => {
  assert.equal(
    isObservedPrismaPgPoolAcquisitionTimeout(observedAcquisitionTimeoutError()),
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
  }
});

test('DatabaseUnavailableError exposes one fixed sanitized identity', () => {
  const error = new DatabaseUnavailableError();

  assert.equal(error.name, 'DatabaseUnavailableError');
  assert.equal(error.message, 'Required database is unavailable');
  assert.deepEqual(Object.keys(error), ['name']);
});
