import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';

import { ApplicationLogger } from '../../dist/platform/logging/application-logger.js';

function captureDestination() {
  let output = '';
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });

  return {
    destination,
    output: () => output,
    records: () =>
      output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

test('idle pool errors emit only a fixed event and bounded error type', () => {
  const capture = captureDestination();
  const logger = new ApplicationLogger('info', capture.destination);
  const messageCanary = 'DB_POOL_MESSAGE_CANARY_81FE';
  const stackCanary = 'DB_POOL_STACK_CANARY_419B';
  const causeCanary = 'DB_POOL_CAUSE_CANARY_700A';
  const error = new TypeError(messageCanary, {
    cause: new Error(causeCanary),
  });
  error.stack = stackCanary;
  error.host = 'db-secret-host.example';
  error.sql = 'SELECT secret FROM credentials';

  logger.databasePoolError(error);

  const records = capture.records();
  assert.equal(records.length, 1);
  assert.deepEqual(Object.keys(records[0]).sort(), [
    'error_type',
    'event',
    'level',
    'service',
    'time',
  ]);
  assert.equal(records[0].service, 'nestjs-production-starter');
  assert.equal(records[0].event, 'database_pool_error');
  assert.equal(records[0].error_type, 'TypeError');
  assert.equal(records[0].level, 50);

  const output = capture.output();
  for (const canary of [
    messageCanary,
    stackCanary,
    causeCanary,
    'db-secret-host.example',
    'SELECT secret FROM credentials',
  ]) {
    assert.equal(output.includes(canary), false, canary);
  }
});

test('database cleanup failures expose only bounded phase and error type', () => {
  const capture = captureDestination();
  const logger = new ApplicationLogger('info', capture.destination);
  const canary = 'DB_CLEANUP_MESSAGE_CANARY_8AA1';

  logger.databaseCleanupFailed('pool_end', new Error(canary));

  const records = capture.records();
  assert.equal(records.length, 1);
  assert.deepEqual(Object.keys(records[0]).sort(), [
    'error_type',
    'event',
    'level',
    'phase',
    'service',
    'time',
  ]);
  assert.equal(records[0].event, 'database_cleanup_failed');
  assert.equal(records[0].phase, 'pool_end');
  assert.equal(records[0].error_type, 'Error');
  assert.equal(capture.output().includes(canary), false);
});

test('unknown database error objects map to one bounded type', () => {
  const capture = captureDestination();
  const logger = new ApplicationLogger('info', capture.destination);
  const canary = 'ARBITRARY_DB_OBJECT_CANARY_9B0C';

  logger.databasePoolError({ message: canary, nested: { canary } });

  const [record] = capture.records();
  assert.equal(record.error_type, 'UnknownError');
  assert.equal(capture.output().includes(canary), false);
});
