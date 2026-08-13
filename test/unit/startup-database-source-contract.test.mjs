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

function matchIndex(source, pattern) {
  const match = pattern.exec(source);
  pattern.lastIndex = 0;
  return match?.index ?? -1;
}

const BOOTING_GUARD =
  /if\s*\(\s*!isBooting\(lifecycle\)\s*\)\s*\{\s*return;\s*\}/u;

test('bootstrap awaits the DI-owned database probe after init and before listen with BOOTING re-checks', async () => {
  const source = await read('src/bootstrap/bootstrap.ts');

  const resolveIndex = matchIndex(
    source,
    /(?:const|let)\s+databaseService\s*=\s*app\.get\(\s*DatabaseService\s*\)/u,
  );
  const initIndex = matchIndex(source, /await\s+app\.init\(\)/u);
  const probeIndex = matchIndex(source, /await\s+databaseService\.probe\(\)/u);
  const listenIndex = matchIndex(
    source,
    /await\s+app\.listen\(\s*options\.config\.port\s*\)/u,
  );
  const readyIndex = matchIndex(source, /lifecycle\.markReady\(\)/u);

  assert.ok(resolveIndex >= 0);
  assert.ok(initIndex > resolveIndex);
  assert.ok(probeIndex > initIndex);
  assert.ok(listenIndex > probeIndex);
  assert.ok(readyIndex > listenIndex);
  assert.match(source.slice(initIndex, probeIndex), BOOTING_GUARD);
  assert.match(source.slice(probeIndex, listenIndex), BOOTING_GUARD);
  assert.match(source.slice(listenIndex, readyIndex), BOOTING_GUARD);
  assert.equal([...source.matchAll(/databaseService\.probe\(\)/gu)].length, 1);
});

test('startup database handling contains no raw SQL, duplicate database construction, retry loop, or Promise.race', async () => {
  const source = await read('src/bootstrap/bootstrap.ts');
  const initIndex = matchIndex(source, /await\s+app\.init\(\)/u);
  const listenIndex = matchIndex(source, /await\s+app\.listen\(/u);
  const startupDatabaseRegion = source.slice(initIndex, listenIndex);

  assert.doesNotMatch(source, /SELECT\s+1/iu);
  assert.doesNotMatch(source, /new\s+(?:Pool|PrismaPg|PrismaClient)\s*\(/u);
  assert.doesNotMatch(source, /new\s+(?:pg\.)?Client\s*\(/u);
  assert.doesNotMatch(source, /Promise\.race\s*\(/u);
  assert.doesNotMatch(startupDatabaseRegion, /\b(?:retry|backoff)\b/iu);
  assert.doesNotMatch(startupDatabaseRegion, /\b(?:for|while)\s*\(/u);
  assert.doesNotMatch(startupDatabaseRegion, /\bset(?:Timeout|Interval)\s*\(/u);
});

test('runtime source has no Prisma migration execution and no Testcontainers dependency', async () => {
  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    const relative = path
      .relative(REPOSITORY_ROOT, sourcePath)
      .split(path.sep)
      .join('/');

    assert.doesNotMatch(source, /@testcontainers\//u, relative);
    assert.doesNotMatch(source, /\btestcontainers\b/iu, relative);
    assert.doesNotMatch(source, /\bprisma\s+migrate\b/iu, relative);
    assert.doesNotMatch(source, /\bmigrate\s+(?:deploy|dev)\b/iu, relative);
  }
});

test('readiness uses the DI-owned DatabaseService probe and no alternate timeout or pool', async () => {
  const service = await read('src/platform/health/readiness.service.ts');
  const module = await read('src/platform/health/health.module.ts');
  const appModule = await read('src/app.module.ts');
  const bootstrap = await read('src/bootstrap/bootstrap.ts');

  assert.match(service, /DatabaseService/u);
  assert.equal([...service.matchAll(/this\.database\.probe\(\)/gu)].length, 1);
  assert.match(module, /ReadinessService/u);
  assert.equal(
    [...appModule.matchAll(/HealthModule\.forRoot\(lifecycle\)/gu)].length,
    1,
  );

  for (const [relative, source] of [
    ['src/platform/health/readiness.service.ts', service],
    ['src/platform/health/health.module.ts', module],
    ['src/app.module.ts', appModule],
    ['src/bootstrap/bootstrap.ts', bootstrap],
  ]) {
    assert.doesNotMatch(
      source,
      /new\s+(?:Pool|PrismaPg|PrismaClient)\s*\(/u,
      relative,
    );
    assert.doesNotMatch(source, /PG_POOL/u, relative);
    assert.doesNotMatch(source, /Promise\.race\s*\(/u, relative);
    assert.doesNotMatch(source, /\bquery_timeout\b/u, relative);
    assert.doesNotMatch(source, /READINESS_PROBE|ReadinessProbe/u, relative);
  }
});

test('process suite uses one PostgreSQL Testcontainer and remains serialized', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const runner = await read('test/process/run-process-tests.mjs');

  assert.equal(
    packageJson.devDependencies['@testcontainers/postgresql'],
    '12.0.4',
  );
  assert.equal(packageJson.devDependencies.testcontainers, '12.0.4');
  assert.equal(
    packageJson.scripts['test:process'],
    'node test/process/run-process-tests.mjs',
  );

  assert.match(
    runner,
    /import\s+\{\s*PostgreSqlContainer\s*\}\s+from\s+['"]@testcontainers\/postgresql['"]/u,
  );
  assert.equal([...runner.matchAll(/new\s+PostgreSqlContainer\(/gu)].length, 1);
  assert.match(runner, /postgres:18\.4-bookworm/u);
  assert.match(runner, /\.getConnectionUri\(\)/u);
  assert.match(runner, /PROCESS_TEST_DATABASE_URL/u);
  assert.match(runner, /['"]--test-concurrency=1['"]/u);
  assert.match(runner, /['"]test\/process\/\*\.test\.mjs['"]/u);
  assert.match(runner, /await\s+container\.stop\(\)/u);
  assert.doesNotMatch(runner, /\bprisma\s+migrate\b/iu);
  assert.doesNotMatch(runner, /Promise\.race\s*\(/u);
});

test('successful process child DATABASE_URL must come from the suite harness while explicit overrides remain possible', async () => {
  const helper = await read('test/process/support/process-test-helpers.mjs');

  assert.match(helper, /process\.env\.PROCESS_TEST_DATABASE_URL/u);
  assert.match(helper, /Object\.hasOwn\(overrides,\s*['"]DATABASE_URL['"]\)/u);
  assert.match(helper, /PROCESS_TEST_DATABASE_URL is required/u);
  assert.match(helper, /DATABASE_URL:\s*databaseUrl/u);
  assert.doesNotMatch(helper, /postgres(?:ql)?:\/\//u);
  assert.doesNotMatch(helper, /\.\.\.process\.env/u);

  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    assert.doesNotMatch(source, /PROCESS_TEST_DATABASE_URL/u);
  }
});
