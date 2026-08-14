import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { performance } from 'node:perf_hooks';

import {
  matchedHttpRoute,
  normalizeHttpMethod,
  normalizeHttpStatus,
} from '../http/http-telemetry.js';
import { MetricsService } from './metrics.service.js';

const TASK_CREATE_ROUTE = '/v1/tasks';
const TASK_CREATED_STATUS = 201;

@Injectable()
export class RequestMetricsMiddleware implements NestMiddleware<
  Request,
  Response
> {
  public constructor(private readonly metrics: MetricsService) {}

  public use(request: Request, response: Response, next: NextFunction): void {
    const method = normalizeHttpMethod(request.method);
    const startedAt = performance.now();

    response.once('finish', () => {
      const route = matchedHttpRoute(request);
      const elapsedSeconds = (performance.now() - startedAt) / 1_000;
      const durationSeconds =
        Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0
          ? elapsedSeconds
          : 0;

      this.metrics.recordHttpRequest(
        {
          method,
          route,
          status_code: normalizeHttpStatus(response.statusCode),
        },
        durationSeconds,
      );

      if (
        method === 'POST' &&
        route === TASK_CREATE_ROUTE &&
        response.statusCode === TASK_CREATED_STATUS
      ) {
        this.metrics.recordTaskCreated();
      }
    });

    next();
  }
}
