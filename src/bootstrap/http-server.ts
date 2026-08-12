import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Server } from 'node:http';

import type { DrainingGateMiddleware } from '../platform/context/draining-gate.middleware.js';
import type { RequestContextMiddleware } from '../platform/context/request-context.middleware.js';

export const JSON_BODY_LIMIT_BYTES = 100 * 1024;

export function configureHttpApplication(
  app: NestExpressApplication,
  requestContextMiddleware: RequestContextMiddleware,
  drainingGateMiddleware: DrainingGateMiddleware,
): void {
  app.use(requestContextMiddleware.use.bind(requestContextMiddleware));
  app.use(helmet());
  app.use(drainingGateMiddleware.use.bind(drainingGateMiddleware));
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT_BYTES });
}

export function configureHttpServer(server: Server): void {
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.keepAliveTimeoutBuffer = 1_000;
  server.timeout = 0;
}
