import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { Lifecycle } from '../../bootstrap/lifecycle.js';
import { HttpErrorBoundary } from '../errors/http-error-boundary.js';

function isBusinessPath(path: string): boolean {
  return path === '/v1' || path.startsWith('/v1/');
}

@Injectable()
export class DrainingGateMiddleware implements NestMiddleware<
  Request,
  Response
> {
  public constructor(
    private readonly lifecycle: Lifecycle,
    private readonly boundary: HttpErrorBoundary,
  ) {}

  public use(request: Request, response: Response, next: NextFunction): void {
    if (this.lifecycle.state !== 'DRAINING' || !isBusinessPath(request.path)) {
      next();
      return;
    }

    response.setHeader('Connection', 'close');
    this.boundary.respond(response, 'DEPENDENCY_UNAVAILABLE');
  }
}
