import pino, { type DestinationStream, type Logger } from 'pino';

import type { LogLevel } from '../../config/config.types.js';

const SERVICE_NAME = 'nestjs-production-starter';
const REQUEST_COMPLETION_EVENT = 'http_request_completed';

export type RequestLogLevel = 'debug' | 'info';
export type LoggedHttpMethod =
  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'OTHER';

export interface RequestCompletion {
  readonly requestId: string;
  readonly method: LoggedHttpMethod;
  readonly route: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

export class ApplicationLogger {
  private readonly logger: Logger;

  public constructor(level: LogLevel, destination?: DestinationStream) {
    const options = {
      level,
      base: { service: SERVICE_NAME },
    };

    this.logger = pino(options, destination);
  }

  public requestCompleted(
    completion: RequestCompletion,
    level: RequestLogLevel,
  ): void {
    const record = {
      event: REQUEST_COMPLETION_EVENT,
      request_id: completion.requestId,
      method: completion.method,
      route: completion.route,
      status_code: completion.statusCode,
      duration_ms: completion.durationMs,
    };

    if (level === 'debug') {
      this.logger.debug(record);
      return;
    }

    this.logger.info(record);
  }
}
