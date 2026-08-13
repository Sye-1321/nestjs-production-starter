import { spawn } from 'node:child_process';
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

let container;
let exitCode = 1;

try {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(TEST_DATABASE)
    .withUsername(TEST_USERNAME)
    .withPassword(TEST_PASSWORD)
    .start();

  exitCode = await runProcessTests(container.getConnectionUri());
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
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, TEST_ARGUMENTS, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROCESS_TEST_DATABASE_URL: databaseUrl,
      },
      shell: false,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal !== null) {
        process.stderr.write(
          `Process-test runner terminated by signal ${signal}.\n`,
        );
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });
  });
}
