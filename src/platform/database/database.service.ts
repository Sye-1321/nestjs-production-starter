import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';

import type { PrismaClient } from '../../generated/prisma/client.js';
import { ApplicationLogger } from '../logging/application-logger.js';
import { PG_POOL, PRISMA_CLIENT } from './database.tokens.js';

const DATABASE_CLEANUP_ERROR_MESSAGE = 'Database cleanup failed';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private cleanupPromise: Promise<void> | undefined;

  public constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(PRISMA_CLIENT) private readonly prismaClient: PrismaClient,
    private readonly logger: ApplicationLogger,
  ) {}

  public get prisma(): PrismaClient {
    return this.prismaClient;
  }

  public async probe(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  public onApplicationShutdown(): Promise<void> {
    this.cleanupPromise ??= this.cleanup();
    return this.cleanupPromise;
  }

  private async cleanup(): Promise<void> {
    let failed = false;

    try {
      await this.prismaClient.$disconnect();
    } catch (error: unknown) {
      failed = true;
      this.logger.databaseCleanupFailed('prisma_disconnect', error);
    }

    try {
      await this.pool.end();
    } catch (error: unknown) {
      failed = true;
      this.logger.databaseCleanupFailed('pool_end', error);
    }

    if (failed) {
      throw new Error(DATABASE_CLEANUP_ERROR_MESSAGE);
    }
  }
}
