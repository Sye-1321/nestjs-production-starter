import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { performance } from 'node:perf_hooks';

import { RequestContextStorage } from '../context/request-context.js';
import {
  ApplicationLogger,
  type LoggedHttpMethod,
  type RequestLogLevel,
} from './application-logger.js';

const UNMATCHED_ROUTE = 'UNMATCHED';
const SUCCESSFUL_OPERATIONAL_ROUTES = new Set([
  '/health/live',
  '/health/ready',
  '/metrics',
]);

function normalizeMethod(method: string): LoggedHttpMethod {
  switch (method) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
    case 'HEAD':
    case 'OPTIONS':
      return method;
    default:
      return 'OTHER';
  }
}

function matchedRoute(request: Request): string {
  const route = request.route as { readonly path?: unknown } | undefined;
  return typeof route?.path === 'string' ? route.path : UNMATCHED_ROUTE;
}

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
    const method = normalizeMethod(request.method);
    const startedAt = performance.now();

    response.once('finish', () => {
      const route = matchedRoute(request);
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
