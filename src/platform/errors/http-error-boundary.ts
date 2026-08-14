import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import { RequestContextStorage } from '../context/request-context.js';
import {
  matchedHttpRoute,
  normalizeHttpMethod,
} from '../http/http-telemetry.js';
import {
  ApplicationLogger,
  type HttpFailureErrorType,
} from '../logging/application-logger.js';
import { type ProblemCode, PROBLEM_CATALOGUE } from './problem-catalogue.js';
import { createProblemDetails } from './problem-details.js';

export const PROBLEM_DETAILS_CONTENT_TYPE = 'application/problem+json';

function normalizeErrorType(error: unknown): HttpFailureErrorType {
  if (error instanceof TypeError) {
    return 'TypeError';
  }
  if (error instanceof RangeError) {
    return 'RangeError';
  }
  if (error instanceof ReferenceError) {
    return 'ReferenceError';
  }
  if (error instanceof SyntaxError) {
    return 'SyntaxError';
  }
  if (error instanceof Error) {
    return 'Error';
  }
  return 'UnknownError';
}

@Injectable()
export class HttpErrorBoundary {
  public constructor(
    private readonly context: RequestContextStorage,
    private readonly logger: ApplicationLogger,
  ) {}

  public respond(response: Response, code: ProblemCode): void {
    const requestId = this.requestId();
    this.write(response, code, requestId);
  }

  public unexpected(
    error: unknown,
    request: Request,
    response: Response,
  ): void {
    const requestId = this.requestId();

    this.logger.httpRequestFailed({
      requestId,
      errorType: normalizeErrorType(error),
      method: normalizeHttpMethod(request.method),
      route: matchedHttpRoute(request),
    });
    this.write(response, 'INTERNAL_ERROR', requestId);
  }

  private requestId(): string {
    const context = this.context.get();
    if (context === undefined) {
      throw new Error('Request context is not available');
    }
    return context.requestId;
  }

  private write(
    response: Response,
    code: ProblemCode,
    requestId: string,
  ): void {
    const definition = PROBLEM_CATALOGUE[code];
    response.status(definition.status);
    response.setHeader('Content-Type', PROBLEM_DETAILS_CONTENT_TYPE);
    response.json(createProblemDetails(code, requestId));
  }
}
