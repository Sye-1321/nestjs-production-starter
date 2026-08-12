import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/u;

type RequestWithDistinctHeaders = Pick<IncomingMessage, 'headersDistinct'>;

export function selectRequestId(request: RequestWithDistinctHeaders): string {
  const values = request.headersDistinct[REQUEST_ID_HEADER];

  if (values?.length === 1) {
    const candidate = values[0];
    if (candidate !== undefined && REQUEST_ID_PATTERN.test(candidate)) {
      return candidate;
    }
  }

  return randomUUID();
}
