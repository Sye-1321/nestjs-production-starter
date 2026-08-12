import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { RequestContextStorage } from './request-context.js';
import { REQUEST_ID_HEADER, selectRequestId } from './request-id.js';

type RequestWithNativeSignal = Request & { readonly signal: AbortSignal };

@Injectable()
export class RequestContextMiddleware implements NestMiddleware<
  RequestWithNativeSignal,
  Response
> {
  public constructor(private readonly context: RequestContextStorage) {}

  public use(
    request: RequestWithNativeSignal,
    response: Response,
    next: NextFunction,
  ): void {
    const requestId = selectRequestId(request);
    response.setHeader(REQUEST_ID_HEADER, requestId);

    this.context.run(
      {
        requestId,
        abortSignal: request.signal,
      },
      () => {
        next();
      },
    );
  }
}
