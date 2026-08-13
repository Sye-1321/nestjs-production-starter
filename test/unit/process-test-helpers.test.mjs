import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';

import { validEnvironment } from '../process/support/process-test-helpers.mjs';

test('validEnvironment distinguishes absent DATABASE_URL from an explicit undefined override', () => {
  const originalHarnessUrl = process.env.PROCESS_TEST_DATABASE_URL;

  try {
    delete process.env.PROCESS_TEST_DATABASE_URL;

    assert.throws(
      () => validEnvironment(3000),
      new Error(
        'PROCESS_TEST_DATABASE_URL is required; run process tests through npm run test:process',
      ),
    );

    process.env.PROCESS_TEST_DATABASE_URL =
      'postgresql://harness_user:harness_password@127.0.0.1:5432/harness_db';

    assert.equal(
      validEnvironment(3001).DATABASE_URL,
      process.env.PROCESS_TEST_DATABASE_URL,
    );

    assert.equal(
      validEnvironment(3002, {
        DATABASE_URL:
          'postgresql://override_user:override_password@127.0.0.1:5433/override_db',
      }).DATABASE_URL,
      'postgresql://override_user:override_password@127.0.0.1:5433/override_db',
    );

    assert.equal(
      Object.hasOwn(
        validEnvironment(3003, { DATABASE_URL: undefined }),
        'DATABASE_URL',
      ),
      false,
    );
  } finally {
    if (originalHarnessUrl === undefined) {
      delete process.env.PROCESS_TEST_DATABASE_URL;
    } else {
      process.env.PROCESS_TEST_DATABASE_URL = originalHarnessUrl;
    }
  }
});
