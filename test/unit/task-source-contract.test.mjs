import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SOURCE_ROOT = path.join(REPOSITORY_ROOT, 'src');
const TASK_ROOT = path.join(SOURCE_ROOT, 'task');

async function read(relativePath) {
  return readFile(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
}

async function typescriptSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entryPath === path.join(SOURCE_ROOT, 'generated')) continue;
      files.push(...(await typescriptSources(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath);
    }
  }

  return files;
}

test('TaskModule is wired exactly once with one controller, service, and repository', async () => {
  const appModule = await read('src/app.module.ts');
  const taskModule = await read('src/task/task.module.ts');

  assert.equal([...appModule.matchAll(/\bTaskModule\b/gu)].length, 2);
  assert.match(
    appModule,
    /import \{ TaskModule \} from ['"]\.\/task\/task\.module\.js['"]/u,
  );
  assert.equal([...appModule.matchAll(/\bTaskModule,/gu)].length, 1);
  assert.match(taskModule, /controllers:\s*\[TaskController\]/u);
  assert.match(taskModule, /providers:\s*\[TaskRepository, TaskService\]/u);
  assert.doesNotMatch(taskModule, /\bimports\s*:/u);
  assert.doesNotMatch(taskModule, /\bexports\s*:/u);
});

test('TaskRepository is the only concrete repository and reuses DatabaseService.prisma', async () => {
  const repository = await read('src/task/task.repository.ts');
  const repositoryOwners = [];

  for (const sourcePath of await typescriptSources(SOURCE_ROOT)) {
    const source = await readFile(sourcePath, 'utf8');
    if (/class\s+TaskRepository\b/u.test(source)) {
      repositoryOwners.push(
        path.relative(REPOSITORY_ROOT, sourcePath).split(path.sep).join('/'),
      );
    }
  }

  assert.deepEqual(repositoryOwners, ['src/task/task.repository.ts']);
  assert.match(
    repository,
    /import \{ DatabaseService \} from ['"]\.\.\/platform\/database\/database\.service\.js['"]/u,
  );
  assert.match(repository, /private readonly database: DatabaseService/u);
  assert.match(repository, /this\.database\.prisma\.task\.create\(/u);
  assert.match(repository, /this\.database\.prisma\.task\.findUnique\(/u);
  assert.match(
    repository,
    /import type \{ Task \} from ['"]\.\.\/generated\/prisma\/client\.js['"]/u,
  );
  assert.doesNotMatch(
    repository,
    /\bnew\s+(?:PrismaClient|PrismaPg|Pool|Client)\s*\(/u,
  );
  assert.doesNotMatch(repository, /\bDATABASE_URL\b/u);
  assert.doesNotMatch(repository, /\$transaction\b/u);
});

test('Task API contains exactly POST create and GET by UUID with frozen DTO policy', async () => {
  const controller = await read('src/task/task.controller.ts');
  const createDto = await read('src/task/dto/create-task.dto.ts');
  const idDto = await read('src/task/dto/task-id-params.dto.ts');

  assert.match(controller, /@Controller\(['"]v1\/tasks['"]\)/u);
  assert.equal([...controller.matchAll(/@Post\(\)/gu)].length, 1);
  assert.equal([...controller.matchAll(/@Get\(['"]:id['"]\)/gu)].length, 1);
  assert.equal([...controller.matchAll(/@(Put|Patch|Delete)\b/gu)].length, 0);
  assert.match(controller, /@Body\(\) input: CreateTaskDto/u);
  assert.match(controller, /@Param\(\) params: TaskIdParamsDto/u);
  assert.doesNotMatch(controller, /\bHttpException\b/u);

  assert.match(createDto, /value\.trim\(\)/u);
  assert.match(createDto, /@IsString\(\)/u);
  assert.match(createDto, /@Length\(1, 200\)/u);
  assert.match(idDto, /@IsUUID\(\)/u);
});

test('Task slice has no generic abstractions, extra database ownership, or speculative DB mapping', async () => {
  const taskSources = await typescriptSources(TASK_ROOT);
  const combined = (
    await Promise.all(
      taskSources.map((sourcePath) => readFile(sourcePath, 'utf8')),
    )
  ).join('\n');

  for (const pattern of [
    /\bIRepository\b/u,
    /\bBaseRepository\b/u,
    /\bBaseService\b/u,
    /\bPrismaClientKnownRequestError\b/u,
    /\bPrismaClientInitializationError\b/u,
    /\bquery_timeout\b/u,
    /\bPromise\.race\s*\(/u,
    /\$transaction\b/u,
    /\bDATABASE_URL\b/u,
    /\bHttpException\b/u,
  ]) {
    assert.doesNotMatch(combined, pattern);
  }

  assert.equal([...combined.matchAll(/\.trim\(\)/gu)].length, 2);
  assert.equal(
    [...combined.matchAll(/class\s+TaskNotFoundError\b/gu)].length,
    1,
  );
  assert.equal([...combined.matchAll(/class\s+TaskRepository\b/gu)].length, 1);
});

test('existing global Problem Details filter owns Task-not-found transport mapping', async () => {
  const filter = await read(
    'src/platform/errors/problem-details-exception.filter.ts',
  );
  const service = await read('src/task/task.service.ts');

  assert.match(filter, /exception instanceof TaskNotFoundError/u);
  assert.match(
    filter,
    /this\.boundary\.respond\(response, 'TASK_NOT_FOUND'\)/u,
  );
  assert.match(service, /throw new TaskNotFoundError\(\)/u);
  assert.doesNotMatch(service, /\bHttpException\b/u);
  assert.doesNotMatch(service, /\bNotFoundException\b/u);
});
