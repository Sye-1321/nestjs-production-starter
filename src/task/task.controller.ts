import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type { Task } from '../generated/prisma/client.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { TaskIdParamsDto } from './dto/task-id-params.dto.js';
import { TaskService } from './task.service.js';

@Controller('v1/tasks')
export class TaskController {
  public constructor(private readonly service: TaskService) {}

  @Post()
  public create(@Body() input: CreateTaskDto): Promise<Task> {
    return this.service.create(input.title);
  }

  @Get(':id')
  public findById(@Param() params: TaskIdParamsDto): Promise<Task> {
    return this.service.findById(params.id);
  }
}
