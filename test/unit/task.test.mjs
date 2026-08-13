import 'reflect-metadata';

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { TaskController } from '../../dist/task/task.controller.js';
import { CreateTaskDto } from '../../dist/task/dto/create-task.dto.js';
import { TaskIdParamsDto } from '../../dist/task/dto/task-id-params.dto.js';
import { TaskNotFoundError } from '../../dist/task/task.errors.js';
import { TaskRepository } from '../../dist/task/task.repository.js';
import { TaskService } from '../../dist/task/task.service.js';
import { RequestContextStorage } from '../../dist/platform/context/request-context.js';
import {
  HttpErrorBoundary,
  PROBLEM_DETAILS_CONTENT_TYPE,
} from '../../dist/platform/errors/http-error-boundary.js';
import { ProblemDetailsExceptionFilter } from '../../dist/platform/errors/problem-details-exception.filter.js';
import {
  RequestValidationError,
  StrictValidationPipe,
} from '../../dist/platform/errors/strict-validation.pipe.js';

const TASK_ID = '550e8400-e29b-41d4-a716-446655440000';
const CREATED_AT = new Date('2026-08-13T12:34:56.789Z');

function taskRecord(overrides = {}) {
  return {
    id: TASK_ID,
    title: 'normalized task',
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function responseDouble() {
  const response = new EventEmitter();
  response.statusCode = 200;
  response.headers = new Map();
  response.body = undefined;
  response.status = function status(value) {
    this.statusCode = value;
    return this;
  };
  response.setHeader = function setHeader(name, value) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  };
  response.getHeader = function getHeader(name) {
    return this.headers.get(name.toLowerCase());
  };
  response.json = function json(body) {
    this.body = body;
    return this;
  };
  return response;
}

function hostDouble(response) {
  return {
    switchToHttp() {
      return {
        getRequest() {
          return { method: 'GET', route: { path: '/v1/tasks/:id' } };
        },
        getResponse() {
          return response;
        },
      };
    },
  };
}

test('CreateTaskDto validates the normalized title and rejects unknown input', async () => {
  const pipe = new StrictValidationPipe();
  const metadata = {
    type: 'body',
    metatype: CreateTaskDto,
    data: undefined,
  };

  assert.deepEqual(
    await pipe.transform({ title: '  normalized task\t' }, metadata),
    { title: 'normalized task' },
  );
  assert.deepEqual(
    await pipe.transform({ title: `  ${'x'.repeat(200)}  ` }, metadata),
    { title: 'x'.repeat(200) },
  );

  for (const invalid of [
    { title: 123 },
    { title: '   ' },
    { title: 'x'.repeat(201) },
    { title: 'valid', extra: 'UNKNOWN_FIELD_CANARY' },
  ]) {
    await assert.rejects(
      pipe.transform(invalid, metadata),
      (error) => error instanceof RequestValidationError,
    );
  }
});

test('Task identifier validation rejects invalid UUIDs before repository execution', async () => {
  let repositoryCalls = 0;
  const repository = {
    async findById(id) {
      repositoryCalls += 1;
      return taskRecord({ id });
    },
  };
  const controller = new TaskController(new TaskService(repository));
  const pipe = new StrictValidationPipe();
  const metadata = {
    type: 'param',
    metatype: TaskIdParamsDto,
    data: undefined,
  };

  await assert.rejects(
    pipe.transform({ id: 'not-a-uuid' }, metadata),
    (error) => error instanceof RequestValidationError,
  );
  assert.equal(repositoryCalls, 0);

  const params = await pipe.transform({ id: TASK_ID }, metadata);
  const task = await controller.findById(params);

  assert.equal(repositoryCalls, 1);
  assert.equal(task.id, TASK_ID);
});

test('TaskRepository uses the shared Prisma Task delegate with explicit operations', async () => {
  const created = taskRecord();
  const found = taskRecord({ title: 'found task' });
  const calls = [];
  const database = {
    prisma: {
      task: {
        async create(args) {
          calls.push({ operation: 'create', args });
          return created;
        },
        async findUnique(args) {
          calls.push({ operation: 'findUnique', args });
          return found;
        },
      },
    },
  };
  const repository = new TaskRepository(database);

  assert.equal(await repository.create('normalized task'), created);
  assert.equal(await repository.findById(TASK_ID), found);
  assert.deepEqual(calls, [
    {
      operation: 'create',
      args: {
        data: { title: 'normalized task' },
        select: { id: true, title: true, createdAt: true },
      },
    },
    {
      operation: 'findUnique',
      args: {
        where: { id: TASK_ID },
        select: { id: true, title: true, createdAt: true },
      },
    },
  ]);
});

test('TaskService applies only trim normalization before one atomic create', async () => {
  const createCalls = [];
  const expected = taskRecord();
  const repository = {
    async create(title) {
      createCalls.push(title);
      return expected;
    },
  };
  const service = new TaskService(repository);

  assert.equal(await service.create(' \t normalized task \n '), expected);
  assert.deepEqual(createCalls, ['normalized task']);
});

test('TaskService returns existing Tasks and raises one narrow missing-Task error', async () => {
  const expected = taskRecord();
  const repository = {
    responses: [expected, null],
    ids: [],
    async findById(id) {
      this.ids.push(id);
      return this.responses.shift();
    },
  };
  const service = new TaskService(repository);

  assert.equal(await service.findById(TASK_ID), expected);
  await assert.rejects(
    service.findById(TASK_ID),
    (error) =>
      error instanceof TaskNotFoundError && error.message === 'Task not found',
  );
  assert.deepEqual(repository.ids, [TASK_ID, TASK_ID]);
});

test('TaskController exposes only the frozen Task representation', async () => {
  const expected = taskRecord();
  const calls = [];
  const service = {
    async create(title) {
      calls.push({ operation: 'create', value: title });
      return expected;
    },
    async findById(id) {
      calls.push({ operation: 'findById', value: id });
      return expected;
    },
  };
  const controller = new TaskController(service);

  const created = await controller.create({ title: 'normalized task' });
  const found = await controller.findById({ id: TASK_ID });

  assert.equal(created, expected);
  assert.equal(found, expected);
  assert.deepEqual(calls, [
    { operation: 'create', value: 'normalized task' },
    { operation: 'findById', value: TASK_ID },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(created)), {
    id: TASK_ID,
    title: 'normalized task',
    createdAt: '2026-08-13T12:34:56.789Z',
  });
});

test('TaskNotFoundError maps through the existing Problem Details boundary', () => {
  const storage = new RequestContextStorage();
  let unexpectedLogs = 0;
  const boundary = new HttpErrorBoundary(storage, {
    httpRequestFailed() {
      unexpectedLogs += 1;
    },
  });
  const filter = new ProblemDetailsExceptionFilter(boundary);
  const response = responseDouble();

  storage.run({ requestId: 'missing-task-request', abortSignal: {} }, () => {
    filter.catch(new TaskNotFoundError(), hostDouble(response));
  });

  assert.equal(response.statusCode, 404);
  assert.equal(
    response.getHeader('content-type'),
    PROBLEM_DETAILS_CONTENT_TYPE,
  );
  assert.deepEqual(response.body, {
    type: 'urn:nestjs-production-starter:problem:not-found',
    title: 'Resource not found',
    status: 404,
    detail: 'The requested resource was not found.',
    code: 'TASK_NOT_FOUND',
    requestId: 'missing-task-request',
  });
  assert.equal(unexpectedLogs, 0);
});
