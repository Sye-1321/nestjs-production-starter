const OBSERVED_PRISMA_CLIENT_VERSION = '7.9.1';
const PG_POOL_ACQUISITION_TIMEOUT_MESSAGE =
  'timeout exceeded when trying to connect';
const PG_UNEXPECTED_CONNECTION_TERMINATION_MESSAGE =
  'Connection terminated unexpectedly';
const OBSERVED_ADAPTER_ERROR_PROPERTIES = [
  'clientVersion',
  'message',
  'stack',
] as const;
const OBSERVED_KNOWN_REQUEST_ERROR_PROPERTIES = [
  'batchRequestIdx',
  'clientVersion',
  'code',
  'message',
  'meta',
  'name',
  'stack',
] as const;
const PRISMA_KNOWN_REQUEST_ERROR_NAME = 'PrismaClientKnownRequestError';
const PG_CONNECTION_REFUSED_CODE = 'ECONNREFUSED';
const PRISMA_DATABASE_ERROR_CODE = 'P2039';
const PG_STATEMENT_TIMEOUT_CODE = '57014';
const PG_STATEMENT_TIMEOUT_MESSAGE =
  'canceling statement due to statement timeout';
const TASK_MODEL_NAME = 'Task';
const DRIVER_ADAPTER_ERROR_NAME = 'DriverAdapterError';
const OBSERVED_DRIVER_ADAPTER_ERROR_PROPERTIES = [
  'cause',
  'message',
  'name',
  'stack',
] as const;
const OBSERVED_POSTGRES_ERROR_PROPERTIES = [
  'code',
  'column',
  'detail',
  'hint',
  'kind',
  'message',
  'originalCode',
  'originalMessage',
  'severity',
] as const;

interface PrismaPgPoolAcquisitionTimeoutError extends Error {
  readonly clientVersion: string;
}

interface PrismaPgTaskConnectionRefusedError extends Error {
  readonly batchRequestIdx: undefined;
  readonly clientVersion: string;
  readonly code: string;
  readonly meta: { readonly modelName: string };
}

interface PrismaPgTaskStatementTimeoutError extends Error {
  readonly batchRequestIdx: undefined;
  readonly clientVersion: string;
  readonly code: string;
  readonly meta: {
    readonly modelName: string;
    readonly driverAdapterError: Error & {
      readonly cause: Record<string, unknown>;
    };
  };
}

export class DatabaseUnavailableError extends Error {
  public constructor() {
    super('Required database is unavailable');
    this.name = 'DatabaseUnavailableError';
  }
}

export function isObservedPrismaPgPoolAcquisitionTimeout(
  error: unknown,
): error is PrismaPgPoolAcquisitionTimeoutError {
  return (
    isObservedPrismaPgAdapterError(error) &&
    error.message === PG_POOL_ACQUISITION_TIMEOUT_MESSAGE
  );
}

export function isObservedPrismaPgUnexpectedConnectionTermination(
  error: unknown,
): error is PrismaPgPoolAcquisitionTimeoutError {
  return (
    isObservedPrismaPgAdapterError(error) &&
    error.message === PG_UNEXPECTED_CONNECTION_TERMINATION_MESSAGE
  );
}

export function isObservedPrismaPgTaskConnectionRefused(
  error: unknown,
): error is PrismaPgTaskConnectionRefusedError {
  if (
    !(error instanceof Error) ||
    error.constructor.name !== PRISMA_KNOWN_REQUEST_ERROR_NAME ||
    error.name !== PRISMA_KNOWN_REQUEST_ERROR_NAME
  ) {
    return false;
  }

  const properties = Object.getOwnPropertyNames(error).sort();
  const expectedProperties = [
    ...OBSERVED_KNOWN_REQUEST_ERROR_PROPERTIES,
  ].sort();
  if (
    properties.length !== expectedProperties.length ||
    properties.some((property, index) => property !== expectedProperties[index])
  ) {
    return false;
  }

  const candidate = error as Error & Record<string, unknown>;
  const meta = candidate.meta;
  if (
    candidate.clientVersion !== OBSERVED_PRISMA_CLIENT_VERSION ||
    candidate.code !== PG_CONNECTION_REFUSED_CODE ||
    candidate.batchRequestIdx !== undefined ||
    meta === null ||
    typeof meta !== 'object'
  ) {
    return false;
  }

  const metaRecord = meta as Record<string, unknown>;
  const metaProperties = Object.keys(metaRecord);
  return (
    metaProperties.length === 1 &&
    metaProperties[0] === 'modelName' &&
    metaRecord.modelName === TASK_MODEL_NAME
  );
}

export function isObservedPrismaPgTaskStatementTimeout(
  error: unknown,
): error is PrismaPgTaskStatementTimeoutError {
  if (!hasObservedKnownRequestErrorShape(error)) {
    return false;
  }

  const meta = error.meta;
  if (
    error.code !== PRISMA_DATABASE_ERROR_CODE ||
    error.batchRequestIdx !== undefined ||
    meta === null ||
    typeof meta !== 'object'
  ) {
    return false;
  }

  const metaRecord = meta as Record<string, unknown>;
  if (
    !hasExactProperties(metaRecord, ['driverAdapterError', 'modelName']) ||
    metaRecord.modelName !== TASK_MODEL_NAME
  ) {
    return false;
  }

  const driverError = metaRecord.driverAdapterError;
  if (
    !(driverError instanceof Error) ||
    driverError.constructor.name !== DRIVER_ADAPTER_ERROR_NAME ||
    driverError.name !== DRIVER_ADAPTER_ERROR_NAME ||
    !hasExactOwnProperties(
      driverError,
      OBSERVED_DRIVER_ADAPTER_ERROR_PROPERTIES,
    )
  ) {
    return false;
  }

  const cause = (driverError as Error & { readonly cause?: unknown }).cause;
  if (
    cause === null ||
    typeof cause !== 'object' ||
    Object.getPrototypeOf(cause) !== Object.prototype ||
    !hasExactOwnProperties(cause, OBSERVED_POSTGRES_ERROR_PROPERTIES)
  ) {
    return false;
  }

  const postgresError = cause as Record<string, unknown>;
  return (
    postgresError.kind === 'postgres' &&
    postgresError.code === PG_STATEMENT_TIMEOUT_CODE &&
    postgresError.originalCode === PG_STATEMENT_TIMEOUT_CODE &&
    postgresError.severity === 'ERROR' &&
    postgresError.message === PG_STATEMENT_TIMEOUT_MESSAGE &&
    postgresError.originalMessage === PG_STATEMENT_TIMEOUT_MESSAGE &&
    postgresError.column === undefined &&
    postgresError.detail === undefined &&
    postgresError.hint === undefined
  );
}

function hasObservedKnownRequestErrorShape(
  error: unknown,
): error is Error & Record<string, unknown> {
  return (
    error instanceof Error &&
    error.constructor.name === PRISMA_KNOWN_REQUEST_ERROR_NAME &&
    error.name === PRISMA_KNOWN_REQUEST_ERROR_NAME &&
    hasExactOwnProperties(error, OBSERVED_KNOWN_REQUEST_ERROR_PROPERTIES) &&
    (error as Error & Record<string, unknown>).clientVersion ===
      OBSERVED_PRISMA_CLIENT_VERSION
  );
}

function hasExactOwnProperties(
  value: object,
  expected: readonly string[],
): boolean {
  const properties = Object.getOwnPropertyNames(value).sort();
  const expectedProperties = [...expected].sort();
  return (
    properties.length === expectedProperties.length &&
    properties.every(
      (property, index) => property === expectedProperties[index],
    )
  );
}

function hasExactProperties(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const properties = Object.keys(value).sort();
  const expectedProperties = [...expected].sort();
  return (
    properties.length === expectedProperties.length &&
    properties.every(
      (property, index) => property === expectedProperties[index],
    )
  );
}

function isObservedPrismaPgAdapterError(
  error: unknown,
): error is PrismaPgPoolAcquisitionTimeoutError {
  if (
    !(error instanceof Error) ||
    error.constructor !== Error ||
    error.name !== 'Error'
  ) {
    return false;
  }

  const properties = Object.getOwnPropertyNames(error).sort();
  const expectedProperties = [...OBSERVED_ADAPTER_ERROR_PROPERTIES].sort();
  if (
    properties.length !== expectedProperties.length ||
    properties.some((property, index) => property !== expectedProperties[index])
  ) {
    return false;
  }

  const candidate = error as Partial<PrismaPgPoolAcquisitionTimeoutError>;
  return candidate.clientVersion === OBSERVED_PRISMA_CLIENT_VERSION;
}
