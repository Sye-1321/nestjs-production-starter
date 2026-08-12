import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { HttpErrorBoundary } from './http-error-boundary.js';

function hasApplicationJsonContentType(request: Request): boolean {
  const contentType = request.get('content-type');
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

@Injectable()
export class TaskContentTypeMiddleware implements NestMiddleware<
  Request,
  Response
> {
  public constructor(private readonly boundary: HttpErrorBoundary) {}

  public use(request: Request, response: Response, next: NextFunction): void {
    if (request.method !== 'POST' || request.path !== '/v1/tasks') {
      next();
      return;
    }

    if (!hasApplicationJsonContentType(request)) {
      this.boundary.respond(response, 'UNSUPPORTED_MEDIA_TYPE');
      return;
    }

    next();
  }
}
