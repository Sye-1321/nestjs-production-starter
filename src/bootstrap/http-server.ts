import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Server } from 'node:http';

export const JSON_BODY_LIMIT_BYTES = 100 * 1024;

export function configureHttpApplication(app: NestExpressApplication): void {
  app.use(helmet());
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT_BYTES });
}

export function configureHttpServer(server: Server): void {
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.keepAliveTimeoutBuffer = 1_000;
  server.timeout = 0;
}
