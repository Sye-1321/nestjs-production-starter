import type { AppConfig, LogLevel, NodeEnvironment } from './config.types.js';

type Environment = Readonly<Record<string, string | undefined>>;

export type ConfigurationField =
  | 'NODE_ENV'
  | 'PORT'
  | 'LOG_LEVEL'
  | 'DATABASE_URL'
  | 'DB_POOL_MAX'
  | 'DB_ACQUIRE_TIMEOUT_MS'
  | 'DB_STATEMENT_TIMEOUT_MS'
  | 'SHUTDOWN_TIMEOUT_MS';

const NODE_ENVIRONMENTS = [
  'development',
  'test',
  'production',
] as const satisfies readonly NodeEnvironment[];

const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const satisfies readonly LogLevel[];

const INTEGER_PATTERN = /^\d+$/;

export class ConfigurationValidationError extends Error {
  public readonly field: ConfigurationField;
  public readonly rule: string;

  public constructor(field: ConfigurationField, rule: string) {
    super(`Invalid configuration: ${field} ${rule}`);
    this.name = 'ConfigurationValidationError';
    this.field = field;
    this.rule = rule;
  }
}

export function parseEnvironment(environment: Environment): AppConfig {
  return {
    nodeEnv: parseRequiredEnum(
      environment.NODE_ENV,
      'NODE_ENV',
      NODE_ENVIRONMENTS,
    ),
    port: parseBoundedInteger(environment.PORT, 'PORT', 1, 65_535),
    logLevel: parseOptionalEnum(
      environment.LOG_LEVEL,
      'LOG_LEVEL',
      LOG_LEVELS,
      'info',
    ),
    databaseUrl: parseDatabaseUrl(environment.DATABASE_URL),
    dbPoolMax: parseBoundedInteger(
      environment.DB_POOL_MAX,
      'DB_POOL_MAX',
      1,
      50,
      10,
    ),
    dbAcquireTimeoutMs: parseBoundedInteger(
      environment.DB_ACQUIRE_TIMEOUT_MS,
      'DB_ACQUIRE_TIMEOUT_MS',
      100,
      30_000,
      1_000,
    ),
    dbStatementTimeoutMs: parseBoundedInteger(
      environment.DB_STATEMENT_TIMEOUT_MS,
      'DB_STATEMENT_TIMEOUT_MS',
      100,
      60_000,
      3_000,
    ),
    shutdownTimeoutMs: parseBoundedInteger(
      environment.SHUTDOWN_TIMEOUT_MS,
      'SHUTDOWN_TIMEOUT_MS',
      1_000,
      60_000,
      10_000,
    ),
  };
}

function parseRequiredEnum<const TValue extends string>(
  rawValue: string | undefined,
  field: ConfigurationField,
  values: readonly TValue[],
): TValue {
  if (rawValue === undefined || rawValue === '') {
    throw validationError(field, 'is required');
  }

  if (!isAllowedValue(rawValue, values)) {
    throw validationError(field, `must be one of: ${values.join(', ')}`);
  }

  return rawValue;
}

function parseOptionalEnum<const TValue extends string>(
  rawValue: string | undefined,
  field: ConfigurationField,
  values: readonly TValue[],
  defaultValue: TValue,
): TValue {
  if (rawValue === undefined) {
    return defaultValue;
  }

  if (!isAllowedValue(rawValue, values)) {
    throw validationError(field, `must be one of: ${values.join(', ')}`);
  }

  return rawValue;
}

function parseBoundedInteger(
  rawValue: string | undefined,
  field: ConfigurationField,
  minimum: number,
  maximum: number,
  defaultValue?: number,
): number {
  if (rawValue === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    throw validationError(field, 'is required');
  }

  if (!INTEGER_PATTERN.test(rawValue)) {
    throw validationError(field, 'must be an integer');
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value)) {
    throw validationError(field, 'must be an integer');
  }

  if (value < minimum || value > maximum) {
    throw validationError(
      field,
      `must be between ${String(minimum)} and ${String(maximum)}`,
    );
  }

  return value;
}

function parseDatabaseUrl(rawValue: string | undefined): string {
  if (rawValue === undefined || rawValue === '') {
    throw validationError('DATABASE_URL', 'is required');
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawValue);
  } catch {
    throw validationError(
      'DATABASE_URL',
      'must be a valid PostgreSQL connection URL',
    );
  }

  if (
    parsedUrl.protocol !== 'postgres:' &&
    parsedUrl.protocol !== 'postgresql:'
  ) {
    throw validationError(
      'DATABASE_URL',
      'must use the postgres: or postgresql: scheme',
    );
  }

  return rawValue;
}

function isAllowedValue<const TValue extends string>(
  value: string,
  allowedValues: readonly TValue[],
): value is TValue {
  return (allowedValues as readonly string[]).includes(value);
}

function validationError(
  field: ConfigurationField,
  rule: string,
): ConfigurationValidationError {
  return new ConfigurationValidationError(field, rule);
}
