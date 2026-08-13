const OBSERVED_PRISMA_CLIENT_VERSION = '7.9.1';
const PG_POOL_ACQUISITION_TIMEOUT_MESSAGE =
  'timeout exceeded when trying to connect';
const OBSERVED_ADAPTER_ERROR_PROPERTIES = [
  'clientVersion',
  'message',
  'stack',
] as const;

interface PrismaPgPoolAcquisitionTimeoutError extends Error {
  readonly clientVersion: string;
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
  return (
    candidate.clientVersion === OBSERVED_PRISMA_CLIENT_VERSION &&
    candidate.message === PG_POOL_ACQUISITION_TIMEOUT_MESSAGE
  );
}
