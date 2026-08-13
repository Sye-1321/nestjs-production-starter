import { type DynamicModule, Module } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import type { AppConfig } from '../../config/config.types.js';
import { PrismaClient } from '../../generated/prisma/client.js';
import { ApplicationLogger } from '../logging/application-logger.js';
import { DatabaseService } from './database.service.js';
import { PG_POOL, PRISMA_CLIENT } from './database.tokens.js';
import { createPoolConfig } from './pool-config.js';

@Module({})
export class DatabaseModule {
  public static forRoot(config: AppConfig): DynamicModule {
    const poolConfig = createPoolConfig(config);

    return {
      global: true,
      module: DatabaseModule,
      providers: [
        {
          provide: PG_POOL,
          inject: [ApplicationLogger],
          useFactory: (logger: ApplicationLogger): Pool => {
            const pool = new Pool(poolConfig);
            pool.on('error', (error: Error) => {
              logger.databasePoolError(error);
            });
            return pool;
          },
        },
        {
          provide: PRISMA_CLIENT,
          inject: [PG_POOL],
          useFactory: (pool: Pool): PrismaClient => {
            const adapter = new PrismaPg(pool);
            return new PrismaClient({ adapter });
          },
        },
        DatabaseService,
      ],
      exports: [DatabaseService],
    };
  }
}
