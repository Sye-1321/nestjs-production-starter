import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly requestId: string;
  readonly abortSignal: AbortSignal;
}

@Injectable()
export class RequestContextStorage {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  public run<TResult>(
    context: RequestContext,
    callback: () => TResult,
  ): TResult {
    return this.storage.run(context, callback);
  }

  public get(): RequestContext | undefined {
    return this.storage.getStore();
  }
}
