import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

async function read(relativePath) {
  return readFile(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
}

test('prom-client is one exact direct production dependency', async () => {
  const packageJson = JSON.parse(await read('package.json'));

  assert.equal(packageJson.dependencies['prom-client'], '15.1.3');
  for (const alternate of [
    '@willsoto/nestjs-prometheus',
    'nestjs-prometheus',
    'prometheus-api-metrics',
  ]) {
    assert.equal(packageJson.dependencies[alternate], undefined);
  }
});

test('metrics platform owns one non-global registry on the application server', async () => {
  const service = await read('src/platform/metrics/metrics.service.ts');
  const controller = await read('src/platform/metrics/metrics.controller.ts');
  const module = await read('src/platform/metrics/metrics.module.ts');
  const appModule = await read('src/app.module.ts');

  assert.equal([...service.matchAll(/new Registry\(\)/gu)].length, 1);
  assert.doesNotMatch(service, /\bregister\.(?:registerMetric|metrics|clear)/u);
  assert.match(service, /process_resident_memory_bytes/u);
  assert.match(service, /nodejs_heap_size_used_bytes/u);
  assert.match(controller, /@Controller\(['"]metrics['"]\)/u);
  assert.match(controller, /Registry\.PROMETHEUS_CONTENT_TYPE/u);
  assert.match(module, /@Global\(\)/u);
  assert.equal([...appModule.matchAll(/\bMetricsModule\b/gu)].length, 2);
});

test('baseline metrics are exact and pull-only', async () => {
  const service = await read('src/platform/metrics/metrics.service.ts');
  const productionPackage = await read('package.json');
  const combined = `${service}\n${productionPackage}`;

  for (const name of [
    'http_server_requests_total',
    'http_server_request_duration_seconds',
    'tasks_created_total',
    'service_dependency_ready',
  ]) {
    assert.equal([...service.matchAll(new RegExp(name, 'gu'))].length, 1, name);
  }

  for (const forbidden of [
    /Pushgateway/iu,
    /pushgateway/iu,
    /OTLP/iu,
    /metrics[_-]?backend/iu,
    /prometheus[_-]?(?:url|host)/iu,
  ]) {
    assert.doesNotMatch(combined, forbidden);
  }
});

test('request metrics use only the shared bounded method, route, and status labels', async () => {
  const telemetry = await read('src/platform/http/http-telemetry.ts');
  const middleware = await read(
    'src/platform/metrics/request-metrics.middleware.ts',
  );
  const service = await read('src/platform/metrics/metrics.service.ts');
  const logging = await read(
    'src/platform/logging/request-logging.middleware.ts',
  );
  const boundary = await read('src/platform/errors/http-error-boundary.ts');

  assert.match(service, /\['method', 'route', 'status_code'\] as const/u);
  assert.match(telemetry, /UNMATCHED/u);
  assert.match(telemetry, /OTHER_HTTP_METHOD/u);
  assert.match(telemetry, /OTHER_HTTP_STATUS/u);

  for (const consumer of [middleware, logging, boundary]) {
    assert.match(consumer, /normalizeHttpMethod/u);
    assert.match(consumer, /matchedHttpRoute/u);
  }
  assert.match(middleware, /normalizeHttpStatus/u);

  for (const pattern of [
    /request\.url/u,
    /request\.originalUrl/u,
    /request\.query/u,
    /request\.body/u,
    /request\.headers/u,
    /requestId/u,
    /taskId/u,
    /userAgent/u,
    /errorMessage/u,
  ]) {
    assert.doesNotMatch(middleware, pattern);
    assert.doesNotMatch(service, pattern);
  }
});

test('request metrics register before completion logging and readiness owns the dependency gauge', async () => {
  const bootstrap = await read('src/bootstrap/bootstrap.ts');
  const httpServer = await read('src/bootstrap/http-server.ts');
  const readiness = await read('src/platform/health/readiness.service.ts');

  const metricsResolve = bootstrap.indexOf('app.get(RequestMetricsMiddleware)');
  const loggingResolve = bootstrap.indexOf('app.get(RequestLoggingMiddleware)');
  const metricsRegistration = httpServer.indexOf(
    'app.use(requestMetricsMiddleware.use.bind(requestMetricsMiddleware));',
  );
  const loggingRegistration = httpServer.indexOf(
    'app.use(requestLoggingMiddleware.use.bind(requestLoggingMiddleware));',
  );

  assert.ok(metricsResolve >= 0);
  assert.ok(loggingResolve > metricsResolve);
  assert.ok(metricsRegistration >= 0);
  assert.ok(loggingRegistration > metricsRegistration);
  assert.equal(
    [...readiness.matchAll(/this\.metrics\.setDependencyReady\(/gu)].length,
    3,
  );
});
