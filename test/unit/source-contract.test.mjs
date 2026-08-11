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
const SHUTDOWN_COORDINATOR = path.join(
  SOURCE_ROOT,
  'bootstrap',
  'shutdown-coordinator.ts',
);

async function productionSources(directory = SOURCE_ROOT) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await productionSources(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath);
    }
  }

  return files;
}

test('production source does not enable Nest shutdown hooks', async () => {
  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    assert.equal(
      source.includes('enableShutdownHooks('),
      false,
      `${path.relative(REPOSITORY_ROOT, sourcePath)} must not call enableShutdownHooks()`,
    );
  }
});

test('production source does not use successful process.exit(0)', async () => {
  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    assert.equal(
      /process\.exit\(\s*0\s*\)/u.test(source),
      false,
      `${path.relative(REPOSITORY_ROOT, sourcePath)} must not call process.exit(0)`,
    );
  }
});

test('ShutdownCoordinator is the only production SIGTERM/SIGINT listener owner', async () => {
  const listenerPattern =
    /process\.(?:on|once|addListener|prependListener|prependOnceListener)\(\s*['"](SIGTERM|SIGINT)['"]/gu;
  const owners = [];

  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    const signals = [...source.matchAll(listenerPattern)].map(
      (match) => match[1],
    );

    if (signals.length > 0) {
      owners.push({ sourcePath, signals });
    }
  }

  assert.equal(owners.length, 1);
  assert.equal(owners[0].sourcePath, SHUTDOWN_COORDINATOR);
  assert.deepEqual(owners[0].signals.sort(), ['SIGINT', 'SIGTERM']);
});

test('main is the only startup-failure logging owner', async () => {
  const callPattern = /\.startupFailed\(/gu;
  const callOwners = [];

  for (const sourcePath of await productionSources()) {
    if (sourcePath.endsWith('bootstrap-logger.ts')) {
      continue;
    }

    const source = await readFile(sourcePath, 'utf8');
    if (callPattern.test(source)) {
      callOwners.push(
        path.relative(REPOSITORY_ROOT, sourcePath).split(path.sep).join('/'),
      );
    }
    callPattern.lastIndex = 0;
  }

  assert.deepEqual(callOwners, ['src/main.ts']);
});

test('production source does not install an uncaughtException continuation handler', async () => {
  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    assert.equal(
      /process\.(?:on|once|addListener|prependListener|prependOnceListener)\(\s*['"]uncaughtException['"]/u.test(
        source,
      ),
      false,
      `${path.relative(REPOSITORY_ROOT, sourcePath)} must not own uncaughtException continuation`,
    );
  }
});

test('production bootstrap installs HTTP policy before application init and listen', async () => {
  const source = await readFile(
    path.join(SOURCE_ROOT, 'bootstrap', 'bootstrap.ts'),
    'utf8',
  );

  const createIndex = source.indexOf(
    'NestFactory.create<NestExpressApplication>',
  );
  const applicationPolicyIndex = source.indexOf(
    'configureHttpApplication(app);',
  );
  const initIndex = source.indexOf('await app.init();');
  const getServerIndex = source.indexOf('server = app.getHttpServer();');
  const serverPolicyIndex = source.indexOf('configureHttpServer(server);');
  const listenIndex = source.indexOf('await app.listen(options.config.port);');

  assert.ok(createIndex >= 0);
  assert.ok(source.indexOf('bodyParser: false', createIndex) > createIndex);
  assert.ok(getServerIndex > createIndex);
  assert.ok(serverPolicyIndex > getServerIndex);
  assert.ok(initIndex > serverPolicyIndex);
  assert.ok(applicationPolicyIndex > createIndex);
  assert.ok(initIndex > applicationPolicyIndex);
  assert.ok(listenIndex > initIndex);
});

test('HTTP application policy uses Helmet and the supported Nest body-parser API', async () => {
  const source = await readFile(
    path.join(SOURCE_ROOT, 'bootstrap', 'http-server.ts'),
    'utf8',
  );

  assert.match(source, /import helmet from ['"]helmet['"];?/u);
  assert.doesNotMatch(source, /from ['"]express['"]/u);
  assert.match(source, /app\.use\(helmet\(\)\);/u);
  assert.match(
    source,
    /app\.useBodyParser\(['"]json['"], \{ limit: JSON_BODY_LIMIT_BYTES \}\);/u,
  );
});

test('configuration environment surface remains exactly frozen', async () => {
  const source = await readFile(
    path.join(SOURCE_ROOT, 'config', 'env.validation.ts'),
    'utf8',
  );
  const referencedVariables = [
    ...new Set(
      [...source.matchAll(/environment\.([A-Z][A-Z0-9_]*)/gu)].map(
        (match) => match[1],
      ),
    ),
  ].sort();

  assert.deepEqual(referencedVariables, [
    'DATABASE_URL',
    'DB_ACQUIRE_TIMEOUT_MS',
    'DB_POOL_MAX',
    'DB_STATEMENT_TIMEOUT_MS',
    'LOG_LEVEL',
    'NODE_ENV',
    'PORT',
    'SHUTDOWN_TIMEOUT_MS',
  ]);
});

test('HTTP dependency policy preserves Express and pins Helmet directly', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
  );

  assert.equal(packageJson.dependencies['@nestjs/platform-express'], '11.1.28');
  assert.equal(packageJson.dependencies.helmet, '8.3.0');
  assert.equal('@nestjs/platform-fastify' in packageJson.dependencies, false);
});

test('production source does not enable forbidden HTTP transport mechanisms', async () => {
  const bootstrapSource = await readFile(
    path.join(SOURCE_ROOT, 'bootstrap', 'bootstrap.ts'),
    'utf8',
  );
  assert.doesNotMatch(bootstrapSource, /\bcors\s*:/u);

  const forbidden = [
    ['CORS', /\.enableCors\s*\(/u],
    ['trust proxy', /\.(?:set|enable)\(\s*['"]trust proxy['"]/u],
    ['insecure HTTP parser', /\binsecureHTTPParser\b/u],
    ['custom AbortController', /\bnew\s+AbortController\s*\(/u],
    ['Nest timeout interceptor', /\bTimeoutInterceptor\b/u],
    [
      'generic application timeout abstraction',
      /\b(?:Request|Operation|Application)Timeout\b/u,
    ],
    ['RxJS timeout operator', /\btimeout\s*\(/u],
  ];

  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');

    for (const [mechanism, pattern] of forbidden) {
      assert.equal(
        pattern.test(source),
        false,
        `${path.relative(REPOSITORY_ROOT, sourcePath)} must not enable ${mechanism}`,
      );
    }
  }
});
