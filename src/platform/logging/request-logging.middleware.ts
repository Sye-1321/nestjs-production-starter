import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { performance } from 'node:perf_hooks';

import { RequestContextStorage } from '../context/request-context.js';
import {
  matchedHttpRoute,
  normalizeHttpMethod,
} from '../http/http-telemetry.js';
import {
  ApplicationLogger,
  type RequestLogLevel,
} from './application-logger.js';

const SUCCESSFUL_OPERATIONAL_ROUTES = new Set([
  '/health/live',
  '/health/ready',
  '/metrics',
]);

function completionLevel(route: string, statusCode: number): RequestLogLevel {
  const successful = statusCode >= 200 && statusCode < 300;
  return successful && SUCCESSFUL_OPERATIONAL_ROUTES.has(route)
    ? 'debug'
    : 'info';
}

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware<
  Request,
  Response
> {
  public constructor(
    private readonly context: RequestContextStorage,
    private readonly logger: ApplicationLogger,
  ) {}

  public use(request: Request, response: Response, next: NextFunction): void {
    const requestContext = this.context.get();
    if (requestContext === undefined) {
      throw new Error('Request context is not available');
    }

    const requestId = requestContext.requestId;
    const method = normalizeHttpMethod(request.method);
    const startedAt = performance.now();

    response.once('finish', () => {
      const route = matchedHttpRoute(request);
      const durationMs = performance.now() - startedAt;

      this.logger.requestCompleted(
        {
          requestId,
          method,
          route,
          statusCode: response.statusCode,
          durationMs:
            Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0,
        },
        completionLevel(route, response.statusCode),
      );
    });

    next();
  }
}
