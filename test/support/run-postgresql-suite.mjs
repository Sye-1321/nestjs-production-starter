import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RandomPortGenerator } from 'testcontainers';

const POSTGRES_IMAGE = 'postgres:18.4-bookworm';
const POSTGRES_PORT = 5432;
const SUPPORTED_SUITES = new Set([
  'test/integration/*.test.mjs',
  'test/e2e/*.test.mjs',
]);
const PRISMA_CLI = path.join(
  process.cwd(),
  'node_modules',
  'prisma',
  'build',
  'index.js',
);

const suitePattern = process.argv[2];
if (suitePattern === undefined || !SUPPORTED_SUITES.has(suitePattern)) {
  throw new Error('A supported PostgreSQL test suite pattern is required');
}

let container;
let exitCode = 1;

try {
  const hostPort = await new RandomPortGenerator().generatePort();
  container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withExposedPorts({ container: POSTGRES_PORT, host: hostPort })
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

  exitCode = await runNode(
    ['--test', '--test-concurrency=1', '--test-timeout=30000', suitePattern],
    {
      ...process.env,
      POSTGRES_TEST_DATABASE_URL: databaseUrl,
      POSTGRES_TEST_CONTAINER_ID: container.getId(),
      PROCESS_TEST_DATABASE_URL: databaseUrl,
    },
    'PostgreSQL test suite',
  );
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'unknown PostgreSQL suite failure';
  process.stderr.write(`PostgreSQL test harness failed: ${message}\n`);
} finally {
  if (container !== undefined) {
    try {
      await container.stop();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown cleanup failure';
      process.stderr.write(
        `PostgreSQL test harness cleanup failed: ${message}\n`,
      );
      exitCode = exitCode === 0 ? 1 : exitCode;
    }
  }
}

process.exitCode = exitCode;

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
