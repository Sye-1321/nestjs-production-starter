import { Module } from '@nestjs/common';

import { TaskController } from './task.controller.js';
import { TaskRepository } from './task.repository.js';
import { TaskService } from './task.service.js';

@Module({
  controllers: [TaskController],
  providers: [TaskRepository, TaskService],
})
export class TaskModule {}
