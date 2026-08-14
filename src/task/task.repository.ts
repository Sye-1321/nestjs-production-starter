import { Injectable } from '@nestjs/common';

import type { Task } from '../generated/prisma/client.js';
import {
  DatabaseUnavailableError,
  isObservedPrismaPgPoolAcquisitionTimeout,
  isObservedPrismaPgTaskConnectionRefused,
  isObservedPrismaPgTaskStatementTimeout,
  isObservedPrismaPgUnexpectedConnectionTermination,
} from '../platform/database/database.errors.js';
import { DatabaseService } from '../platform/database/database.service.js';

const TASK_SELECT = {
  id: true,
  title: true,
  createdAt: true,
} as const;

@Injectable()
export class TaskRepository {
  public constructor(private readonly database: DatabaseService) {}

  public async create(title: string): Promise<Task> {
    try {
      return await this.database.prisma.task.create({
        data: { title },
        select: TASK_SELECT,
      });
    } catch (error: unknown) {
      rethrowDatabaseFailure(error);
    }
  }

  public async findById(id: string): Promise<Task | null> {
    try {
      return await this.database.prisma.task.findUnique({
        where: { id },
        select: TASK_SELECT,
      });
    } catch (error: unknown) {
      rethrowDatabaseFailure(error);
    }
  }
}

function rethrowDatabaseFailure(error: unknown): never {
  if (
    isObservedPrismaPgPoolAcquisitionTimeout(error) ||
    isObservedPrismaPgUnexpectedConnectionTermination(error) ||
    isObservedPrismaPgTaskConnectionRefused(error) ||
    isObservedPrismaPgTaskStatementTimeout(error)
  ) {
    throw new DatabaseUnavailableError();
  }

  throw error;
}
