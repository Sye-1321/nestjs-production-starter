import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { PostgreSqlContainer } from '@testcontainers/postgresql';

const POSTGRES_IMAGE = 'postgres:18.4-bookworm';
const TEST_DATABASE = 'nestjs_production_starter_process';
const TEST_USERNAME = 'nestjs_process';
const TEST_PASSWORD = 'nestjs_process';
const TEST_ARGUMENTS = [
  '--test',
  '--test-concurrency=1',
  'test/process/*.test.mjs',
];
const PRISMA_CLI = path.join(
  process.cwd(),
  'node_modules',
  'prisma',
  'build',
  'index.js',
);

let container;
let exitCode = 1;

try {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(TEST_DATABASE)
    .withUsername(TEST_USERNAME)
    .withPassword(TEST_PASSWORD)
    .start();
  const databaseUrl = container.getConnectionUri();

  const migrationExitCode = await runNode(
    [PRISMA_CLI, 'migrate', 'deploy'],
    { ...process.env, DATABASE_URL: databaseUrl },
    'Prisma migration deployment',
  );
  if (migrationExitCode !== 0) {
    throw new Error(
      `Prisma migration deployment exited ${String(migrationExitCode)}`,
    );
  }

  exitCode = await runProcessTests(databaseUrl);
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'unknown Testcontainers failure';
  process.stderr.write(`Process-test PostgreSQL harness failed: ${message}\n`);
} finally {
  if (container !== undefined) {
    try {
      await container.stop();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown cleanup failure';
      process.stderr.write(
        `Process-test PostgreSQL cleanup failed: ${message}\n`,
      );
      exitCode = exitCode === 0 ? 1 : exitCode;
    }
  }
}

process.exitCode = exitCode;

function runProcessTests(databaseUrl) {
  return runNode(
    TEST_ARGUMENTS,
    {
      ...process.env,
      PROCESS_TEST_DATABASE_URL: databaseUrl,
    },
    'Process test suite',
  );
}

function runNode(arguments_, environment, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, arguments_, {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`${label} terminated by signal ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
  });
}
