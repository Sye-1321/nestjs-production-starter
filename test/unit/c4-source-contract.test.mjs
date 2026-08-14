import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SOURCE_ROOT = path.join(REPOSITORY_ROOT, 'src');

async function read(relativePath) {
  return readFile(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
}

async function productionSources(directory = SOURCE_ROOT) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entryPath === path.join(SOURCE_ROOT, 'generated')) continue;
      files.push(...(await productionSources(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath);
    }
  }

  return files;
}

test('integration and e2e suites use one external migration harness with real PostgreSQL', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const runner = await read('test/support/run-postgresql-suite.mjs');

  assert.equal(
    packageJson.scripts['test:integration'],
    'node test/support/run-postgresql-suite.mjs "test/integration/*.test.mjs"',
  );
  assert.equal(
    packageJson.scripts['test:e2e'],
    'node test/support/run-postgresql-suite.mjs "test/e2e/*.test.mjs"',
  );
  assert.match(runner, /new PostgreSqlContainer\(POSTGRES_IMAGE\)/u);
  assert.match(
    runner,
    /\.withExposedPorts\(\{ container: POSTGRES_PORT, host: hostPort \}\)/u,
  );
  assert.match(runner, /postgres:18\.4-bookworm/u);
  assert.match(runner, /'migrate', 'deploy'/u);
  assert.match(runner, /POSTGRES_TEST_DATABASE_URL: databaseUrl/u);
  assert.match(runner, /POSTGRES_TEST_CONTAINER_ID: container\.getId\(\)/u);
  assert.match(runner, /PROCESS_TEST_DATABASE_URL: databaseUrl/u);
  assert.match(runner, /await container\.stop\(\)/u);
  assert.doesNotMatch(runner, /localhost:5432/u);
  assert.doesNotMatch(runner, /Promise\.race\s*\(/u);

  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    const relative = path
      .relative(REPOSITORY_ROOT, sourcePath)
      .split(path.sep)
      .join('/');
    assert.doesNotMatch(source, /prisma\s+migrate\s+deploy/iu, relative);
    assert.doesNotMatch(source, /@testcontainers\//u, relative);
  }
});

test('C4 fixture preserves the one external pool and long-lived Prisma ownership model', async () => {
  const fixture = await read('test/support/database-test-fixture.mjs');
  const repository = await read('src/task/task.repository.ts');

  assert.equal([...fixture.matchAll(/new Pool\(/gu)].length, 1);
  assert.equal([...fixture.matchAll(/new PrismaPg\(pool\)/gu)].length, 1);
  assert.equal(
    [...fixture.matchAll(/new PrismaClient\(\{ adapter:/gu)].length,
    1,
  );
  assert.match(fixture, /new DatabaseService\(pool, prisma, logger\)/u);
  assert.match(fixture, /new TaskRepository\(databaseService\)/u);
  assert.match(repository, /this\.database\.prisma\.task\.create\(/u);
  assert.match(repository, /this\.database\.prisma\.task\.findUnique\(/u);
  assert.doesNotMatch(repository, /\$transaction/u);
});

test('database waits and Task creation contain no fake timeout or transaction mechanisms', async () => {
  const checkedFiles = [
    'src/platform/database/database.errors.ts',
    'src/platform/database/database.service.ts',
    'src/platform/database/pool-config.ts',
    'src/task/task.repository.ts',
    'src/task/task.service.ts',
  ];

  for (const relative of checkedFiles) {
    const source = await read(relative);
    assert.doesNotMatch(source, /Promise\.race\s*\(/u, relative);
    assert.doesNotMatch(source, /\bquery_timeout\b/u, relative);
    assert.doesNotMatch(source, /\$transaction\b/u, relative);
  }
});

test('DB classifier has exact pinned transient branches', async () => {
  const classifier = await read('src/platform/database/database.errors.ts');
  const repository = await read('src/task/task.repository.ts');
  const filter = await read(
    'src/platform/errors/problem-details-exception.filter.ts',
  );

  assert.match(classifier, /OBSERVED_PRISMA_CLIENT_VERSION = '7\.9\.1'/u);
  assert.match(
    classifier,
    /PG_POOL_ACQUISITION_TIMEOUT_MESSAGE\s*=\s*\n?\s*'timeout exceeded when trying to connect'/u,
  );
  assert.match(
    classifier,
    /PG_UNEXPECTED_CONNECTION_TERMINATION_MESSAGE\s*=\s*\n?\s*'Connection terminated unexpectedly'/u,
  );
  assert.equal(
    [...classifier.matchAll(/export function isObserved/gu)].length,
    4,
  );
  assert.match(
    classifier,
    /export function isObservedPrismaPgPoolAcquisitionTimeout\(/u,
  );
  assert.match(classifier, /Object\.getOwnPropertyNames\(error\)\.sort\(\)/u);
  assert.match(
    classifier,
    /error\.message === PG_POOL_ACQUISITION_TIMEOUT_MESSAGE/u,
  );
  assert.match(
    classifier,
    /error\.message === PG_UNEXPECTED_CONNECTION_TERMINATION_MESSAGE/u,
  );
  assert.doesNotMatch(classifier, /\.includes\(/u);
  assert.doesNotMatch(
    classifier,
    /(?:new\s+RegExp|RegExp\s*\(|\.match\s*\(|\.test\s*\()/u,
  );
  assert.match(classifier, /PG_CONNECTION_REFUSED_CODE = 'ECONNREFUSED'/u);
  assert.match(classifier, /PRISMA_DATABASE_ERROR_CODE = 'P2039'/u);
  assert.match(classifier, /PG_STATEMENT_TIMEOUT_CODE = '57014'/u);
  assert.match(classifier, /PrismaClientKnownRequestError/u);
  assert.deepEqual(
    [...classifier.matchAll(/'P20\d\d'/gu)].map((match) => match[0]),
    ["'P2039'"],
  );

  assert.equal(
    [
      ...repository.matchAll(
        /isObservedPrismaPgPoolAcquisitionTimeout\(error\)/gu,
      ),
    ].length,
    1,
  );
  assert.equal(
    [
      ...repository.matchAll(
        /isObservedPrismaPgTaskStatementTimeout\(error\)/gu,
      ),
    ].length,
    1,
  );
  assert.equal(
    [
      ...repository.matchAll(
        /isObservedPrismaPgTaskConnectionRefused\(error\)/gu,
      ),
    ].length,
    1,
  );
  assert.equal(
    [
      ...repository.matchAll(
        /isObservedPrismaPgUnexpectedConnectionTermination\(error\)/gu,
      ),
    ].length,
    1,
  );
  assert.match(repository, /throw new DatabaseUnavailableError\(\)/u);
  assert.match(
    filter,
    /exception instanceof DatabaseUnavailableError[\s\S]*?'DEPENDENCY_UNAVAILABLE'/u,
  );
});
