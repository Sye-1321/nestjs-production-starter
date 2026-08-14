import {
  type ArgumentsHost,
  Catch,
  HttpException,
  Injectable,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { DatabaseUnavailableError } from '../database/database.errors.js';
import { TaskNotFoundError } from '../../task/task.errors.js';
import { HttpErrorBoundary } from './http-error-boundary.js';
import { RequestValidationError } from './strict-validation.pipe.js';

function routeTemplate(request: Request): string | undefined {
  const route = request.route as { readonly path?: unknown } | undefined;
  return typeof route?.path === 'string' ? route.path : undefined;
}

function isRoutineReadinessException(
  exception: HttpException,
  request: Request,
): boolean {
  if (
    routeTemplate(request) !== '/health/ready' ||
    exception.getStatus() !== 503
  ) {
    return false;
  }

  const payload = exception.getResponse();
  if (typeof payload !== 'object') {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return Object.keys(record).length === 1 && record.status === 'not_ready';
}

function preserveHttpException(
  exception: HttpException,
  response: Response,
): void {
  const status = exception.getStatus();
  const payload = exception.getResponse();

  response.status(status);
  response.json(
    typeof payload === 'object'
      ? payload
      : { statusCode: status, message: payload },
  );
}

@Catch()
@Injectable()
export class ProblemDetailsExceptionFilter implements ExceptionFilter {
  public constructor(private readonly boundary: HttpErrorBoundary) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (exception instanceof RequestValidationError) {
      this.boundary.respond(response, 'VALIDATION_ERROR');
      return;
    }

    if (exception instanceof TaskNotFoundError) {
      this.boundary.respond(response, 'TASK_NOT_FOUND');
      return;
    }

    if (exception instanceof DatabaseUnavailableError) {
      this.boundary.respond(response, 'DEPENDENCY_UNAVAILABLE');
      return;
    }

    if (
      exception instanceof HttpException &&
      isRoutineReadinessException(exception, request)
    ) {
      preserveHttpException(exception, response);
      return;
    }

    if (exception instanceof HttpException && exception.getStatus() < 500) {
      preserveHttpException(exception, response);
      return;
    }

    this.boundary.unexpected(exception, request, response);
  }
}
