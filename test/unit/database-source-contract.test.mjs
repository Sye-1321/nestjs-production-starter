import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SOURCE_ROOT = path.join(REPOSITORY_ROOT, 'src');
const DATABASE_ROOT = path.join(SOURCE_ROOT, 'platform', 'database');

async function read(relativePath) {
  return readFile(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
}

async function typescriptSources(directory = SOURCE_ROOT) {
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

test('database dependency pins are exact and match the approved M3 baseline', async () => {
  const packageJson = JSON.parse(await read('package.json'));

  assert.equal(packageJson.dependencies['@prisma/adapter-pg'], '7.9.1');
  assert.equal(packageJson.dependencies['@prisma/client'], '7.9.1');
  assert.equal(packageJson.dependencies.pg, '8.23.0');
  assert.equal(packageJson.devDependencies.prisma, '7.9.1');
  assert.equal(packageJson.devDependencies['@types/pg'], '8.21.0');
});

test('generated client scripts are exact and preserve serialized process tests', async () => {
  const packageJson = JSON.parse(await read('package.json'));

  assert.equal(packageJson.scripts['prisma:generate'], 'prisma generate');
  assert.equal(packageJson.scripts.pretypecheck, 'npm run prisma:generate');
  assert.equal(packageJson.scripts.prebuild, 'npm run prisma:generate');
  assert.equal(
    packageJson.scripts['test:process'],
    'node --test --test-concurrency=1 "test/process/*.test.mjs"',
  );
});

test('DatabaseModule is global, registered exactly once, and owns one pool plus one Prisma client', async () => {
  const appModule = await read('src/app.module.ts');
  const databaseModule = await read('src/platform/database/database.module.ts');
  const registrations = [];

  for (const sourcePath of await typescriptSources()) {
    const source = await readFile(sourcePath, 'utf8');
    if (/DatabaseModule\.forRoot\(config\)/u.test(source)) {
      registrations.push(
        path.relative(REPOSITORY_ROOT, sourcePath).split(path.sep).join('/'),
      );
    }
  }

  assert.deepEqual(registrations, ['src/app.module.ts']);
  assert.equal(
    [...appModule.matchAll(/DatabaseModule\.forRoot\(config\)/gu)].length,
    1,
  );
  assert.equal([...databaseModule.matchAll(/global:\s*true/gu)].length, 1);
  assert.equal([...databaseModule.matchAll(/provide:\s*PG_POOL/gu)].length, 1);
  assert.equal(
    [...databaseModule.matchAll(/provide:\s*PRISMA_CLIENT/gu)].length,
    1,
  );
  assert.equal([...databaseModule.matchAll(/new Pool\(/gu)].length, 1);
  assert.equal(
    [...databaseModule.matchAll(/new PrismaPg\(pool\)/gu)].length,
    1,
  );
  assert.equal(
    [...databaseModule.matchAll(/new PrismaClient\(\{ adapter \}\)/gu)].length,
    1,
  );
  assert.match(databaseModule, /inject:\s*\[PG_POOL\]/u);

  const exportLists = [...databaseModule.matchAll(/exports:\s*\[([^\]]*)\]/gu)];
  assert.equal(exportLists.length, 1);
  assert.equal(exportLists[0][1].trim(), 'DatabaseService');
});

test('owned pool attaches its idle error handler immediately after construction', async () => {
  const source = await read('src/platform/database/database.module.ts');
  const construction = source.indexOf('new Pool(poolConfig)');
  const errorHandler = source.indexOf("pool.on('error'", construction);
  const returnPool = source.indexOf('return pool;', construction);

  assert.ok(construction >= 0);
  assert.ok(errorHandler > construction);
  assert.ok(returnPool > errorHandler);
  assert.match(source, /logger\.databasePoolError\(error\)/u);
});

test('database source contains no Promise.race or pg query_timeout', async () => {
  for (const entry of await readdir(DATABASE_ROOT)) {
    if (!entry.endsWith('.ts')) continue;
    const source = await read(`src/platform/database/${entry}`);
    assert.doesNotMatch(source, /Promise\.race\s*\(/u, entry);
    assert.doesNotMatch(source, /\bquery_timeout\b/u, entry);
  }

  const poolConfig = await read('src/platform/database/pool-config.ts');
  assert.match(
    poolConfig,
    /connectionTimeoutMillis:\s*config\.dbAcquireTimeoutMs/u,
  );
  assert.match(
    poolConfig,
    /statement_timeout:\s*config\.dbStatementTimeoutMs/u,
  );
  assert.match(poolConfig, /application_name:\s*DATABASE_APPLICATION_NAME/u);
});

test('PrismaClient construction is application-scoped and not per request', async () => {
  const constructionOwners = [];

  for (const sourcePath of await typescriptSources()) {
    const source = await readFile(sourcePath, 'utf8');
    if (/new\s+PrismaClient\s*\(/u.test(source)) {
      constructionOwners.push(
        path.relative(REPOSITORY_ROOT, sourcePath).split(path.sep).join('/'),
      );
    }
  }

  assert.deepEqual(constructionOwners, [
    'src/platform/database/database.module.ts',
  ]);
});

test('C1 defines a real shared-pool probe but does not wire it into bootstrap yet', async () => {
  const databaseService = await read(
    'src/platform/database/database.service.ts',
  );
  const bootstrap = await read('src/bootstrap/bootstrap.ts');

  assert.match(databaseService, /this\.pool\.query\('SELECT 1'\)/u);
  assert.doesNotMatch(bootstrap, /DatabaseService/u);
  assert.doesNotMatch(bootstrap, /\.probe\(\)/u);
});

test('Prisma schema is PostgreSQL-only with exactly the frozen Task shape', async () => {
  const schema = await read('prisma/schema.prisma');

  assert.match(schema, /provider\s*=\s*"prisma-client"/u);
  assert.match(schema, /output\s*=\s*"\.\.\/src\/generated\/prisma"/u);
  assert.match(schema, /datasource db \{\s*provider = "postgresql"\s*\}/u);
  assert.doesNotMatch(schema, /\burl\s*=/u);
  assert.equal([...schema.matchAll(/^model\s+/gmu)].length, 1);
  assert.match(schema, /model Task/u);
  assert.match(schema, /id\s+String\s+@id\s+@default\(uuid\(\)\)\s+@db\.Uuid/u);
  assert.match(schema, /title\s+String\s+@db\.VarChar\(200\)/u);
  assert.match(
    schema,
    /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@map\("created_at"\)\s+@db\.Timestamptz\(3\)/u,
  );
  assert.match(schema, /@@map\("tasks"\)/u);
  for (const forbidden of [
    'User',
    'owner',
    'status',
    'updatedAt',
    'deletedAt',
  ]) {
    assert.equal(schema.includes(forbidden), false, forbidden);
  }
});

test('Prisma config has no fake datasource fallback and migration path is explicit', async () => {
  const source = await read('prisma.config.ts');

  assert.match(source, /schema:\s*'prisma\/schema\.prisma'/u);
  assert.match(source, /path:\s*'prisma\/migrations'/u);
  assert.match(source, /const databaseUrl = process\.env\.DATABASE_URL/u);
  assert.match(source, /databaseUrl === undefined/u);
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\//u);
  assert.doesNotMatch(source, /dotenv/u);
});

test('initial migration contains only the mapped Task table', async () => {
  const migration = await read(
    'prisma/migrations/20260813160000_init_task/migration.sql',
  );
  const lock = await read('prisma/migrations/migration_lock.toml');

  assert.equal([...migration.matchAll(/CREATE TABLE/gu)].length, 1);
  assert.match(migration, /CREATE TABLE "tasks"/u);
  assert.match(migration, /"id" UUID NOT NULL/u);
  assert.match(migration, /"title" VARCHAR\(200\) NOT NULL/u);
  assert.match(
    migration,
    /"created_at" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/u,
  );
  assert.match(migration, /PRIMARY KEY \("id"\)/u);
  assert.doesNotMatch(migration, /CREATE EXTENSION/u);
  assert.match(lock, /provider = "postgresql"/u);
});

test('generated Prisma client is ignored by Git, ESLint, and Prettier and is untracked', async () => {
  const gitignore = await read('.gitignore');
  const eslintConfig = await read('eslint.config.mjs');
  const prettierIgnore = await read('.prettierignore');

  assert.match(gitignore, /^src\/generated\/prisma\/$/mu);
  assert.match(eslintConfig, /'src\/generated\/prisma\/\*\*'/u);
  assert.match(prettierIgnore, /^src\/generated\/prisma\/$/mu);

  const tracked = execFileSync('git', ['ls-files', 'src/generated/prisma/**'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
  assert.equal(tracked.trim(), '');
});

test('Prisma config has a narrow non-type-aware ESLint override', async () => {
  const eslintConfig = await read('eslint.config.mjs');

  assert.match(
    eslintConfig,
    /files:\s*\['prisma\.config\.ts'\],[\s\S]*?\.\.\.tseslint\.configs\.disableTypeChecked/u,
  );
  assert.match(
    eslintConfig,
    /files:\s*\['src\/\*\*\/\*\.ts'\],[\s\S]*?projectService:\s*true/u,
  );
});

test('local Compose contains only one exact PostgreSQL dependency service', async () => {
  const compose = await read('compose.yaml');

  assert.match(compose, /^services:\s*\n\s{2}postgres:/u);
  assert.match(compose, /image:\s*postgres:18\.4-bookworm/u);
  assert.match(compose, /-\s*['"]127\.0\.0\.1:5432:5432['"]/u);
  assert.doesNotMatch(compose, /- "5432:5432"/u);
  assert.equal(
    [...compose.matchAll(/^\s{2}[a-z][a-z0-9_-]*:\s*$/gmu)].length,
    1,
  );
  for (const forbidden of ['redis:', 'app:', 'pgbouncer:', 'adminer:']) {
    assert.equal(compose.includes(forbidden), false, forbidden);
  }
});
