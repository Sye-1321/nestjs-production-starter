import { Injectable } from '@nestjs/common';

import type { Task } from '../generated/prisma/client.js';
import { DatabaseService } from '../platform/database/database.service.js';

const TASK_SELECT = {
  id: true,
  title: true,
  createdAt: true,
} as const;

@Injectable()
export class TaskRepository {
  public constructor(private readonly database: DatabaseService) {}

  public create(title: string): Promise<Task> {
    return this.database.prisma.task.create({
      data: { title },
      select: TASK_SELECT,
    });
  }

  public findById(id: string): Promise<Task | null> {
    return this.database.prisma.task.findUnique({
      where: { id },
      select: TASK_SELECT,
    });
  }
}
