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
  const requestContextResolveIndex = source.indexOf(
    'app.get(RequestContextMiddleware)',
  );
  const requestLoggingResolveIndex = source.indexOf(
    'app.get(RequestLoggingMiddleware)',
  );
  const drainingGateResolveIndex = source.indexOf(
    'app.get(DrainingGateMiddleware)',
  );
  const getServerIndex = source.indexOf('server = app.getHttpServer();');
  const serverPolicyIndex = source.indexOf('configureHttpServer(server);');
  const applicationPolicyIndex = source.indexOf('configureHttpApplication(');
  const initIndex = source.indexOf('await app.init();');
  const listenIndex = source.indexOf('await app.listen(options.config.port);');

  assert.ok(createIndex >= 0);
  assert.ok(source.indexOf('bodyParser: false', createIndex) > createIndex);
  assert.ok(requestContextResolveIndex > createIndex);
  assert.ok(requestLoggingResolveIndex > requestContextResolveIndex);
  assert.ok(drainingGateResolveIndex > requestLoggingResolveIndex);
  assert.ok(getServerIndex > drainingGateResolveIndex);
  assert.ok(serverPolicyIndex > getServerIndex);
  assert.ok(applicationPolicyIndex > serverPolicyIndex);
  assert.ok(initIndex > applicationPolicyIndex);
  assert.ok(listenIndex > initIndex);
});

test('HTTP application policy orders context, request logging, Helmet, drain gate, then JSON parsing', async () => {
  const source = await readFile(
    path.join(SOURCE_ROOT, 'bootstrap', 'http-server.ts'),
    'utf8',
  );

  const requestContextIndex = source.indexOf(
    'app.use(requestContextMiddleware.use.bind(requestContextMiddleware));',
  );
  const requestLoggingIndex = source.indexOf(
    'app.use(requestLoggingMiddleware.use.bind(requestLoggingMiddleware));',
  );
  const helmetIndex = source.indexOf('app.use(helmet());');
  const drainingGateIndex = source.indexOf(
    'app.use(drainingGateMiddleware.use.bind(drainingGateMiddleware));',
  );
  const bodyParserIndex = source.indexOf(
    "app.useBodyParser('json', { limit: JSON_BODY_LIMIT_BYTES });",
  );

  assert.match(source, /import helmet from ['"]helmet['"];?/u);
  assert.doesNotMatch(source, /from ['"]express['"]/u);
  assert.ok(requestContextIndex >= 0);
  assert.ok(requestLoggingIndex > requestContextIndex);
  assert.ok(helmetIndex > requestLoggingIndex);
  assert.ok(drainingGateIndex > helmetIndex);
  assert.ok(bodyParserIndex > drainingGateIndex);
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

test('request context uses AsyncLocalStorage and the native request signal', async () => {
  const contextSource = await readFile(
    path.join(SOURCE_ROOT, 'platform', 'context', 'request-context.ts'),
    'utf8',
  );
  const middlewareSource = await readFile(
    path.join(
      SOURCE_ROOT,
      'platform',
      'context',
      'request-context.middleware.ts',
    ),
    'utf8',
  );

  assert.match(contextSource, /AsyncLocalStorage<RequestContext>/u);
  assert.match(middlewareSource, /abortSignal:\s*request\.signal/u);
  assert.doesNotMatch(contextSource, /\bAbortController\b/u);
  assert.doesNotMatch(middlewareSource, /\bAbortController\b/u);
});

test('request ID selection uses duplicate-preserving headers only', async () => {
  const source = await readFile(
    path.join(SOURCE_ROOT, 'platform', 'context', 'request-id.ts'),
    'utf8',
  );

  assert.match(source, /request\.headersDistinct\[REQUEST_ID_HEADER\]/u);
  assert.doesNotMatch(source, /request\.headers(?:\[|\.)/u);
  assert.match(source, /\brandomUUID\(\)/u);
  assert.doesNotMatch(source, /Math\.random\(\)/u);
});

test('context platform is global, singly registered, and DI-owned', async () => {
  const contextModuleSource = await readFile(
    path.join(SOURCE_ROOT, 'platform', 'context', 'context.module.ts'),
    'utf8',
  );
  const appModuleSource = await readFile(
    path.join(SOURCE_ROOT, 'app.module.ts'),
    'utf8',
  );
  const bootstrapSource = await readFile(
    path.join(SOURCE_ROOT, 'bootstrap', 'bootstrap.ts'),
    'utf8',
  );

  assert.match(contextModuleSource, /\bglobal:\s*true/u);
  assert.match(
    contextModuleSource,
    /\{ provide: Lifecycle, useValue: lifecycle \}/u,
  );
  assert.doesNotMatch(contextModuleSource, /\bMiddlewareConsumer\b/u);
  assert.doesNotMatch(contextModuleSource, /\bNestModule\b/u);
  assert.doesNotMatch(contextModuleSource, /\bconfigure\s*\(/u);
  assert.doesNotMatch(contextModuleSource, /new\s+Lifecycle\s*\(/u);

  assert.equal(
    [...appModuleSource.matchAll(/ContextModule\.forRoot\(lifecycle\)/gu)]
      .length,
    1,
  );

  assert.match(bootstrapSource, /app\.get\(RequestContextMiddleware\)/u);
  assert.match(bootstrapSource, /app\.get\(DrainingGateMiddleware\)/u);
  assert.doesNotMatch(
    bootstrapSource,
    /new\s+(?:RequestContextMiddleware|DrainingGateMiddleware)\s*\(/u,
  );
});

test('logging dependency policy pins direct Pino without wrapper packages', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
  );

  assert.equal(packageJson.dependencies.pino, '10.3.1');
  assert.equal('nestjs-pino' in packageJson.dependencies, false);
  assert.equal('pino-http' in packageJson.dependencies, false);
  assert.equal('pino-pretty' in packageJson.dependencies, false);
});

test('application logger uses direct Pino with fixed service base and no transport', async () => {
  const source = await readFile(
    path.join(SOURCE_ROOT, 'platform', 'logging', 'application-logger.ts'),
    'utf8',
  );

  assert.match(source, /import pino,/u);
  assert.equal([...source.matchAll(/\bpino\(/gu)].length, 1);
  assert.match(source, /service: SERVICE_NAME/u);
  assert.match(source, /nestjs-production-starter/u);
  assert.doesNotMatch(source, /\btransport\s*:/u);
  assert.doesNotMatch(source, /\bpino\.transport\s*\(/u);
  assert.doesNotMatch(source, /pino-pretty/u);
  assert.doesNotMatch(source, /nestjs-pino/u);
  assert.doesNotMatch(source, /pino-http/u);
});

test('request completion source does not collect raw request or response objects', async () => {
  const source = await readFile(
    path.join(
      SOURCE_ROOT,
      'platform',
      'logging',
      'request-logging.middleware.ts',
    ),
    'utf8',
  );

  const forbidden = [
    /request\.url/u,
    /request\.originalUrl/u,
    /request\.query/u,
    /request\.body/u,
    /request\.headers/u,
    /response\.body/u,
    /response\.getHeaders\s*\(/u,
    /response\.getHeader\s*\(/u,
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern);
  }
  assert.match(source, /response\.once\(['"]finish['"]/u);
  assert.doesNotMatch(source, /response\.(?:on|once)\(['"]close['"]/u);
  assert.match(source, /performance\.now\(\)/u);
  assert.doesNotMatch(source, /Date\.now\(\)/u);
});

test('logging platform is singly registered and request middleware is DI-owned', async () => {
  const appModuleSource = await readFile(
    path.join(SOURCE_ROOT, 'app.module.ts'),
    'utf8',
  );
  const loggingModuleSource = await readFile(
    path.join(SOURCE_ROOT, 'platform', 'logging', 'logging.module.ts'),
    'utf8',
  );
  const bootstrapSource = await readFile(
    path.join(SOURCE_ROOT, 'bootstrap', 'bootstrap.ts'),
    'utf8',
  );

  assert.equal(
    [
      ...appModuleSource.matchAll(
        /LoggingModule\.forRoot\(config\.logLevel\)/gu,
      ),
    ].length,
    1,
  );
  assert.match(loggingModuleSource, /\bglobal:\s*true/u);
  assert.match(loggingModuleSource, /RequestLoggingMiddleware/u);
  assert.doesNotMatch(loggingModuleSource, /\bMiddlewareConsumer\b/u);
  assert.doesNotMatch(loggingModuleSource, /\bNestModule\b/u);
  assert.match(bootstrapSource, /app\.get\(RequestLoggingMiddleware\)/u);
  assert.doesNotMatch(bootstrapSource, /new\s+RequestLoggingMiddleware\s*\(/u);
  assert.match(bootstrapSource, /logger:\s*false/u);
});
