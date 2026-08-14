import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Server } from 'node:http';

import type { DrainingGateMiddleware } from '../platform/context/draining-gate.middleware.js';
import type { RequestContextMiddleware } from '../platform/context/request-context.middleware.js';
import type { BodyParserErrorMiddleware } from '../platform/errors/body-parser-error.middleware.js';
import type { TaskContentTypeMiddleware } from '../platform/errors/task-content-type.middleware.js';
import type { RequestLoggingMiddleware } from '../platform/logging/request-logging.middleware.js';
import type { RequestMetricsMiddleware } from '../platform/metrics/request-metrics.middleware.js';

export const JSON_BODY_LIMIT_BYTES = 100 * 1024;

export function configureHttpApplication(
  app: NestExpressApplication,
  requestContextMiddleware: RequestContextMiddleware,
  requestMetricsMiddleware: RequestMetricsMiddleware,
  requestLoggingMiddleware: RequestLoggingMiddleware,
  drainingGateMiddleware: DrainingGateMiddleware,
  taskContentTypeMiddleware: TaskContentTypeMiddleware,
  bodyParserErrorMiddleware: BodyParserErrorMiddleware,
): void {
  app.use(requestContextMiddleware.use.bind(requestContextMiddleware));
  app.use(requestMetricsMiddleware.use.bind(requestMetricsMiddleware));
  app.use(requestLoggingMiddleware.use.bind(requestLoggingMiddleware));
  app.use(helmet());
  app.use(drainingGateMiddleware.use.bind(drainingGateMiddleware));
  app.use(taskContentTypeMiddleware.use.bind(taskContentTypeMiddleware));
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT_BYTES });
  app.use(bodyParserErrorMiddleware.use.bind(bodyParserErrorMiddleware));
}

export function configureHttpServer(server: Server): void {
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.keepAliveTimeoutBuffer = 1_000;
  server.timeout = 0;
}
