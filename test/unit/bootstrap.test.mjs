import assert from 'node:assert/strict';
import test from 'node:test';

import { BootstrapLogger } from '../../dist/bootstrap/bootstrap-logger.js';
import {
  ConfigurationValidationError,
  parseEnvironment,
} from '../../dist/config/env.validation.js';

function captureLogger() {
  const lines = [];
  return {
    lines,
    logger: new BootstrapLogger((line) => lines.push(line)),
  };
}

test('configuration startup failure output is structured and sanitized', () => {
  const canary = 'database-password-canary-DO-NOT-LEAK';
  let failure;

  try {
    parseEnvironment({
      NODE_ENV: 'production',
      PORT: '3000',
      DATABASE_URL: `postgresql://user:${canary}@`,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof ConfigurationValidationError);
  const captured = captureLogger();
  captured.logger.startupFailed(failure);

  assert.equal(captured.lines.length, 1);
  assert.equal(captured.lines[0].includes(canary), false);
  assert.deepEqual(JSON.parse(captured.lines[0]), {
    event: 'startup_failed',
    kind: 'configuration',
    field: 'DATABASE_URL',
    rule: 'must be a valid PostgreSQL connection URL',
  });
});

test('arbitrary bootstrap errors are not serialized into startup failure output', () => {
  const canary = 'raw-bootstrap-secret-DO-NOT-LEAK';
  const captured = captureLogger();

  captured.logger.startupFailed(new Error(canary));

  assert.equal(captured.lines.length, 1);
  assert.equal(captured.lines[0].includes(canary), false);
  assert.deepEqual(JSON.parse(captured.lines[0]), {
    event: 'startup_failed',
    kind: 'bootstrap',
  });
});

test('shutdown failure uses a distinct event identity', () => {
  const captured = captureLogger();

  captured.logger.shutdownFailed();

  assert.deepEqual(JSON.parse(captured.lines[0]), {
    event: 'shutdown_failed',
  });
});
