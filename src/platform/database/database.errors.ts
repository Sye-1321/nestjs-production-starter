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
const TASK_MODEL_NAME = 'Task';

interface PrismaPgPoolAcquisitionTimeoutError extends Error {
  readonly clientVersion: string;
}

interface PrismaPgTaskConnectionRefusedError extends Error {
  readonly batchRequestIdx: undefined;
  readonly clientVersion: string;
  readonly code: string;
  readonly meta: { readonly modelName: string };
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
