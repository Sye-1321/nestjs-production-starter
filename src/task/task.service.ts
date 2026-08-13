import { Injectable } from '@nestjs/common';

import type { Task } from '../generated/prisma/client.js';
import { TaskNotFoundError } from './task.errors.js';
import { TaskRepository } from './task.repository.js';

@Injectable()
export class TaskService {
  public constructor(private readonly repository: TaskRepository) {}

  public create(title: string): Promise<Task> {
    return this.repository.create(title.trim());
  }

  public async findById(id: string): Promise<Task> {
    const task = await this.repository.findById(id);

    if (task === null) {
      throw new TaskNotFoundError();
    }

    return task;
  }
}
