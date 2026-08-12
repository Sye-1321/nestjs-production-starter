import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { HttpErrorBoundary } from './http-error-boundary.js';

interface ParserError {
  readonly type?: unknown;
  readonly status?: unknown;
  readonly statusCode?: unknown;
}

function isParserError(error: unknown, type: string, status: number): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const parserError = error as ParserError;
  const statusMatches =
    parserError.status === status || parserError.statusCode === status;
  return parserError.type === type && statusMatches;
}

@Injectable()
export class BodyParserErrorMiddleware {
  public constructor(private readonly boundary: HttpErrorBoundary) {}

  public use(
    error: unknown,
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    void next;

    if (isParserError(error, 'entity.parse.failed', 400)) {
      this.boundary.respond(response, 'MALFORMED_JSON');
      return;
    }

    if (isParserError(error, 'entity.too.large', 413)) {
      this.boundary.respond(response, 'PAYLOAD_TOO_LARGE');
      return;
    }

    this.boundary.unexpected(error, request, response);
  }
}
