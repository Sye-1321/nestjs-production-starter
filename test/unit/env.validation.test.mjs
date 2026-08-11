import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConfigurationValidationError,
  parseEnvironment,
} from '../../dist/config/env.validation.js';

const BASE_ENVIRONMENT = Object.freeze({
  NODE_ENV: 'production',
  PORT: '3000',
  DATABASE_URL: 'postgresql://localhost:5432/app',
});

function parse(overrides = {}) {
  return parseEnvironment({ ...BASE_ENVIRONMENT, ...overrides });
}

function assertValidationError(action, field, rule) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof ConfigurationValidationError);
    assert.equal(error.field, field);
    assert.equal(error.rule, rule);
    assert.equal(error.message, `Invalid configuration: ${field} ${rule}`);
    return true;
  });
}

test('NODE_ENV accepts every frozen value', () => {
  for (const nodeEnv of ['development', 'test', 'production']) {
    assert.equal(parse({ NODE_ENV: nodeEnv }).nodeEnv, nodeEnv);
  }
});

test('NODE_ENV rejects an invalid value', () => {
  assertValidationError(
    () => parse({ NODE_ENV: 'staging' }),
    'NODE_ENV',
    'must be one of: development, test, production',
  );
});

test('NODE_ENV is required', () => {
  assertValidationError(
    () => parse({ NODE_ENV: undefined }),
    'NODE_ENV',
    'is required',
  );
});

test('PORT accepts minimum and maximum values', () => {
  assert.equal(parse({ PORT: '1' }).port, 1);
  assert.equal(parse({ PORT: '65535' }).port, 65_535);
});

test('PORT rejects values outside the frozen range', () => {
  assertValidationError(
    () => parse({ PORT: '0' }),
    'PORT',
    'must be between 1 and 65535',
  );
  assertValidationError(
    () => parse({ PORT: '65536' }),
    'PORT',
    'must be between 1 and 65535',
  );
});

test('PORT rejects malformed integers', () => {
  for (const value of ['3000.5', '3e3', ' 3000 ', '+3000', 'abc']) {
    assertValidationError(
      () => parse({ PORT: value }),
      'PORT',
      'must be an integer',
    );
  }
});

test('PORT remains required in production', () => {
  assertValidationError(
    () => parse({ NODE_ENV: 'production', PORT: undefined }),
    'PORT',
    'is required',
  );
});

test('PORT has no implicit development default', () => {
  assertValidationError(
    () => parse({ NODE_ENV: 'development', PORT: undefined }),
    'PORT',
    'is required',
  );
});

test('LOG_LEVEL accepts every supported frozen Pino level', () => {
  for (const logLevel of [
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
    'silent',
  ]) {
    assert.equal(parse({ LOG_LEVEL: logLevel }).logLevel, logLevel);
  }
});

test('LOG_LEVEL rejects unsupported values', () => {
  assertValidationError(
    () => parse({ LOG_LEVEL: 'verbose' }),
    'LOG_LEVEL',
    'must be one of: fatal, error, warn, info, debug, trace, silent',
  );
});

test('LOG_LEVEL defaults to info', () => {
  assert.equal(parse({ LOG_LEVEL: undefined }).logLevel, 'info');
});

test('DATABASE_URL accepts postgres: and postgresql: URLs', () => {
  assert.equal(
    parse({ DATABASE_URL: 'postgres://db.example/app' }).databaseUrl,
    'postgres://db.example/app',
  );
  assert.equal(
    parse({ DATABASE_URL: 'postgresql://db.example/app' }).databaseUrl,
    'postgresql://db.example/app',
  );
});

test('DATABASE_URL accepts localhost without SSL parameters', () => {
  const databaseUrl = 'postgresql://user:password@localhost:5432/app';
  assert.equal(parse({ DATABASE_URL: databaseUrl }).databaseUrl, databaseUrl);
});

test('DATABASE_URL rejects malformed URLs with sanitized output', () => {
  const canary = 'credential-canary-DO-NOT-LEAK';
  const malformedUrl = `postgresql://user:${canary}@`;

  assert.throws(
    () => parse({ DATABASE_URL: malformedUrl }),
    (error) => {
      assert.ok(error instanceof ConfigurationValidationError);
      assert.equal(error.field, 'DATABASE_URL');
      assert.equal(error.rule, 'must be a valid PostgreSQL connection URL');

      const serialized = JSON.stringify({
        name: error.name,
        message: error.message,
        field: error.field,
        rule: error.rule,
        stack: error.stack,
      });
      assert.equal(serialized.includes(canary), false);
      assert.equal(serialized.includes(malformedUrl), false);
      return true;
    },
  );
});

test('DATABASE_URL rejects non-PostgreSQL schemes without exposing credentials', () => {
  const canary = 'wrong-scheme-secret';
  const databaseUrl = `mysql://user:${canary}@localhost/app`;

  assert.throws(
    () => parse({ DATABASE_URL: databaseUrl }),
    (error) => {
      assert.ok(error instanceof ConfigurationValidationError);
      assert.equal(error.field, 'DATABASE_URL');
      assert.equal(error.rule, 'must use the postgres: or postgresql: scheme');
      assert.equal(error.message.includes(canary), false);
      assert.equal(error.message.includes(databaseUrl), false);
      return true;
    },
  );
});

test('DATABASE_URL is required', () => {
  assertValidationError(
    () => parse({ DATABASE_URL: undefined }),
    'DATABASE_URL',
    'is required',
  );
});

const BOUNDED_INTEGER_CASES = [
  {
    field: 'DB_POOL_MAX',
    property: 'dbPoolMax',
    defaultValue: 10,
    minimum: 1,
    maximum: 50,
  },
  {
    field: 'DB_ACQUIRE_TIMEOUT_MS',
    property: 'dbAcquireTimeoutMs',
    defaultValue: 1_000,
    minimum: 100,
    maximum: 30_000,
  },
  {
    field: 'DB_STATEMENT_TIMEOUT_MS',
    property: 'dbStatementTimeoutMs',
    defaultValue: 3_000,
    minimum: 100,
    maximum: 60_000,
  },
  {
    field: 'SHUTDOWN_TIMEOUT_MS',
    property: 'shutdownTimeoutMs',
    defaultValue: 10_000,
    minimum: 1_000,
    maximum: 60_000,
  },
];

for (const {
  field,
  property,
  defaultValue,
  minimum,
  maximum,
} of BOUNDED_INTEGER_CASES) {
  test(`${field} preserves its frozen default`, () => {
    assert.equal(parse({ [field]: undefined })[property], defaultValue);
  });

  test(`${field} accepts its frozen minimum and maximum`, () => {
    assert.equal(parse({ [field]: String(minimum) })[property], minimum);
    assert.equal(parse({ [field]: String(maximum) })[property], maximum);
  });

  test(`${field} rejects values outside its frozen range`, () => {
    assertValidationError(
      () => parse({ [field]: String(minimum - 1) }),
      field,
      `must be between ${minimum} and ${maximum}`,
    );
    assertValidationError(
      () => parse({ [field]: String(maximum + 1) }),
      field,
      `must be between ${minimum} and ${maximum}`,
    );
  });

  test(`${field} rejects malformed integers`, () => {
    assertValidationError(
      () => parse({ [field]: 'not-an-integer' }),
      field,
      'must be an integer',
    );
  });
}

test('unspecified environment variables never enter AppConfig', () => {
  const config = parseEnvironment({
    ...BASE_ENVIRONMENT,
    REDIS_URL: 'redis://should-not-exist',
    JWT_SECRET: 'should-not-exist',
    READINESS_DB_TIMEOUT_MS: '9999',
    HTTP_REQUEST_TIMEOUT_MS: '9999',
  });

  assert.deepEqual(Object.keys(config).sort(), [
    'databaseUrl',
    'dbAcquireTimeoutMs',
    'dbPoolMax',
    'dbStatementTimeoutMs',
    'logLevel',
    'nodeEnv',
    'port',
    'shutdownTimeoutMs',
  ]);
  assert.equal('REDIS_URL' in config, false);
  assert.equal('JWT_SECRET' in config, false);
  assert.equal('READINESS_DB_TIMEOUT_MS' in config, false);
  assert.equal('HTTP_REQUEST_TIMEOUT_MS' in config, false);
});

test('explicit empty optional values are rejected rather than defaulted', () => {
  assertValidationError(
    () => parse({ LOG_LEVEL: '' }),
    'LOG_LEVEL',
    'must be one of: fatal, error, warn, info, debug, trace, silent',
  );
  assertValidationError(
    () => parse({ DB_POOL_MAX: '' }),
    'DB_POOL_MAX',
    'must be an integer',
  );
});
