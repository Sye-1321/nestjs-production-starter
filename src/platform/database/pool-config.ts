import type { PoolConfig } from 'pg';

import type { AppConfig } from '../../config/config.types.js';

const DATABASE_APPLICATION_NAME = 'nestjs-production-starter';

export function createPoolConfig(config: AppConfig): PoolConfig {
  return {
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    connectionTimeoutMillis: config.dbAcquireTimeoutMs,
    statement_timeout: config.dbStatementTimeoutMs,
    application_name: DATABASE_APPLICATION_NAME,
  };
}
