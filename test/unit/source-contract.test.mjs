import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

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

test('production shutdown escalation is singular and force-only', async () => {
  const bootstrapSource = await readFile(
    path.join(SOURCE_ROOT, 'bootstrap', 'bootstrap.ts'),
    'utf8',
  );
  const closeAllMatches = bootstrapSource.match(/\.closeAllConnections\(\)/gu);
  const closeAllIndex = bootstrapSource.indexOf(
    'server?.closeAllConnections();',
  );
  const forcedLogIndex = bootstrapSource.indexOf(
    'options.logger.forcedShutdown();',
  );
  const forceExitIndex = bootstrapSource.indexOf('process.exit(1);');

  assert.equal(closeAllMatches?.length, 1);
  assert.ok(closeAllIndex >= 0);
  assert.ok(forcedLogIndex > closeAllIndex);
  assert.ok(forceExitIndex > forcedLogIndex);

  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    assert.doesNotMatch(source, /\.closeIdleConnections\(\)/u);
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

test('production bootstrap installs HTTP policy, global pipe, and global filter before init and listen', async () => {
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
  const requestMetricsResolveIndex = source.indexOf(
    'app.get(RequestMetricsMiddleware)',
  );
  const drainingGateResolveIndex = source.indexOf(
    'app.get(DrainingGateMiddleware)',
  );
  const contentTypeResolveIndex = source.indexOf(
    'app.get(TaskContentTypeMiddleware)',
  );
  const parserErrorResolveIndex = source.indexOf(
    'app.get(BodyParserErrorMiddleware)',
  );
  const validationResolveIndex = source.indexOf(
    'app.get(StrictValidationPipe)',
  );
  const filterResolveIndex = source.search(
    /app\.get\(\s*ProblemDetailsExceptionFilter\s*,?\s*\)/u,
  );
  const getServerIndex = source.indexOf('server = app.getHttpServer();');
  const serverPolicyIndex = source.indexOf('configureHttpServer(server);');
  const applicationPolicyIndex = source.indexOf('configureHttpApplication(');
  const globalPipeIndex = source.indexOf(
    'app.useGlobalPipes(strictValidationPipe);',
  );
  const globalFilterIndex = source.indexOf(
    'app.useGlobalFilters(problemDetailsExceptionFilter);',
  );
  const initIndex = source.indexOf('await app.init();');
  const listenIndex = source.indexOf('await app.listen(options.config.port);');

  assert.ok(createIndex >= 0);
  assert.ok(source.indexOf('bodyParser: false', createIndex) > createIndex);
  assert.ok(requestContextResolveIndex > createIndex);
  assert.ok(requestMetricsResolveIndex > requestContextResolveIndex);
  assert.ok(requestLoggingResolveIndex > requestMetricsResolveIndex);
  assert.ok(drainingGateResolveIndex > requestLoggingResolveIndex);
  assert.ok(contentTypeResolveIndex > drainingGateResolveIndex);
  assert.ok(parserErrorResolveIndex > contentTypeResolveIndex);
  assert.ok(validationResolveIndex > parserErrorResolveIndex);
  assert.ok(filterResolveIndex > validationResolveIndex);
  assert.ok(getServerIndex > filterResolveIndex);
  assert.ok(serverPolicyIndex > getServerIndex);
  assert.ok(applicationPolicyIndex > serverPolicyIndex);
  assert.ok(globalPipeIndex > applicationPolicyIndex);
  assert.ok(globalFilterIndex > globalPipeIndex);
  assert.ok(initIndex > globalFilterIndex);
  assert.ok(listenIndex > initIndex);
});

test('HTTP application policy orders context, metrics, logging, Helmet, drain, media type, parser, and parser errors', async () => {
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
  const requestMetricsIndex = source.indexOf(
    'app.use(requestMetricsMiddleware.use.bind(requestMetricsMiddleware));',
  );
  const helmetIndex = source.indexOf('app.use(helmet());');
  const drainingGateIndex = source.indexOf(
    'app.use(drainingGateMiddleware.use.bind(drainingGateMiddleware));',
  );
  const contentTypeIndex = source.indexOf(
    'app.use(taskContentTypeMiddleware.use.bind(taskContentTypeMiddleware));',
  );
  const bodyParserIndex = source.indexOf(
    "app.useBodyParser('json', { limit: JSON_BODY_LIMIT_BYTES });",
  );
  const parserErrorIndex = source.indexOf(
    'app.use(bodyParserErrorMiddleware.use.bind(bodyParserErrorMiddleware));',
  );

  assert.match(source, /import helmet from ['"]helmet['"];?/u);
  assert.doesNotMatch(source, /from ['"]express['"]/u);
  assert.ok(requestContextIndex >= 0);
  assert.ok(requestMetricsIndex > requestContextIndex);
  assert.ok(requestLoggingIndex > requestMetricsIndex);
  assert.ok(helmetIndex > requestLoggingIndex);
  assert.ok(drainingGateIndex > helmetIndex);
  assert.ok(contentTypeIndex > drainingGateIndex);
  assert.ok(bodyParserIndex > contentTypeIndex);
  assert.ok(parserErrorIndex > bodyParserIndex);
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

test('validation dependencies are exact and alternate validators remain absent', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
  );

  assert.equal(packageJson.dependencies['class-validator'], '0.15.1');
  assert.equal(packageJson.dependencies['class-transformer'], '0.5.1');
  assert.equal(packageJson.dependencies.pino, '10.3.1');
  for (const dependency of ['zod', 'joi', 'ajv', 'express-validator']) {
    assert.equal(dependency in packageJson.dependencies, false);
  }
});

test('strict global validation policy is frozen and uses a typed exception factory', async () => {
  const source = await readFile(
    path.join(SOURCE_ROOT, 'platform', 'errors', 'strict-validation.pipe.ts'),
    'utf8',
  );

  assert.match(source, /whitelist:\s*true/u);
  assert.match(source, /forbidNonWhitelisted:\s*true/u);
  assert.match(source, /transform:\s*false/u);
  assert.match(source, /enableImplicitConversion:\s*false/u);
  assert.match(source, /target:\s*false/u);
  assert.match(source, /value:\s*false/u);
  assert.match(
    source,
    /exceptionFactory:\s*\(\)\s*=>\s*new RequestValidationError\(\)/u,
  );
  assert.doesNotMatch(source, /BadRequestException/u);
});

test('Problem Details adapters are DI-owned and registered once before Nest init', async () => {
  const bootstrapSource = await readFile(
    path.join(SOURCE_ROOT, 'bootstrap', 'bootstrap.ts'),
    'utf8',
  );
  const appModuleSource = await readFile(
    path.join(SOURCE_ROOT, 'app.module.ts'),
    'utf8',
  );
  const errorsModuleSource = await readFile(
    path.join(SOURCE_ROOT, 'platform', 'errors', 'errors.module.ts'),
    'utf8',
  );

  assert.equal([...appModuleSource.matchAll(/\bErrorsModule\b/gu)].length, 2);
  assert.match(errorsModuleSource, /@Global\(\)/u);
  assert.match(errorsModuleSource, /HttpErrorBoundary/u);
  assert.match(errorsModuleSource, /ProblemDetailsExceptionFilter/u);
  assert.match(errorsModuleSource, /StrictValidationPipe/u);
  assert.match(errorsModuleSource, /TaskContentTypeMiddleware/u);
  assert.match(errorsModuleSource, /BodyParserErrorMiddleware/u);

  assert.match(bootstrapSource, /app\.get\(TaskContentTypeMiddleware\)/u);
  assert.match(bootstrapSource, /app\.get\(BodyParserErrorMiddleware\)/u);
  assert.match(bootstrapSource, /app\.get\(StrictValidationPipe\)/u);
  assert.match(
    bootstrapSource,
    /app\.get\(\s*ProblemDetailsExceptionFilter\s*,?\s*\)/u,
  );
  assert.equal(
    [
      ...bootstrapSource.matchAll(
        /app\.useGlobalPipes\(strictValidationPipe\)/gu,
      ),
    ].length,
    1,
  );
  assert.equal(
    [
      ...bootstrapSource.matchAll(
        /app\.useGlobalFilters\(problemDetailsExceptionFilter\)/gu,
      ),
    ].length,
    1,
  );
  assert.doesNotMatch(
    bootstrapSource,
    /new\s+(?:TaskContentTypeMiddleware|BodyParserErrorMiddleware|StrictValidationPipe|ProblemDetailsExceptionFilter)\s*\(/u,
  );
});

test('public error boundary never logs raw request objects or passes an Error object to Pino', async () => {
  const boundarySource = await readFile(
    path.join(SOURCE_ROOT, 'platform', 'errors', 'http-error-boundary.ts'),
    'utf8',
  );
  const loggerSource = await readFile(
    path.join(SOURCE_ROOT, 'platform', 'logging', 'application-logger.ts'),
    'utf8',
  );

  for (const pattern of [
    /request\.url/u,
    /request\.originalUrl/u,
    /request\.query/u,
    /request\.body/u,
    /request\.headers/u,
  ]) {
    assert.doesNotMatch(boundarySource, pattern);
  }
  assert.match(boundarySource, /httpRequestFailed\(\{/u);
  assert.doesNotMatch(boundarySource, /httpRequestFailed\(\s*error/u);
  assert.match(loggerSource, /this\.logger\.error\(\{/u);
  assert.doesNotMatch(
    loggerSource,
    /this\.logger\.error\(\s*(?:error|failure)\b/u,
  );
  assert.doesNotMatch(loggerSource, /error\.cause/u);
  assert.doesNotMatch(loggerSource, /error\.stack/u);
  assert.doesNotMatch(loggerSource, /error\.message/u);
});

test('Problem Details filter preserves known HttpException values outside unexpected-error logging', async () => {
  const source = await readFile(
    path.join(
      SOURCE_ROOT,
      'platform',
      'errors',
      'problem-details-exception.filter.ts',
    ),
    'utf8',
  );

  const validationIndex = source.indexOf(
    'exception instanceof RequestValidationError',
  );
  const knownHttpIndex = source.lastIndexOf(
    'if (exception instanceof HttpException)',
  );
  const unexpectedIndex = source.indexOf(
    'this.boundary.unexpected(exception, request, response);',
  );

  assert.ok(validationIndex >= 0);
  assert.ok(knownHttpIndex > validationIndex);
  assert.ok(unexpectedIndex > knownHttpIndex);
  assert.match(source, /preserveHttpException\(exception, response\);/u);
});

test('transport-specific HttpException ownership remains inside the HTTP boundary', async () => {
  const owners = [];

  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    if (/\bHttpException\b/u.test(source)) {
      owners.push(
        path.relative(REPOSITORY_ROOT, sourcePath).split(path.sep).join('/'),
      );
    }
  }

  assert.deepEqual(owners, [
    'src/platform/errors/problem-details-exception.filter.ts',
  ]);
});

test('frozen specification file is byte-for-byte the approved Git blob', async () => {
  const contract = await readFile(
    path.join(REPOSITORY_ROOT, 'docs', 'spec', 'v1-contract.md'),
  );
  const hash = createHash('sha1')
    .update(Buffer.from(`blob ${contract.byteLength}\0`))
    .update(contract)
    .digest('hex');

  assert.equal(hash, 'c40f8382adc998365c52604102a7b595cd5b2cf0');
});
