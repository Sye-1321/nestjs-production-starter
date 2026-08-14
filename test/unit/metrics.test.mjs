import assert from 'node:assert/strict';
import test from 'node:test';

import { Registry } from 'prom-client';

import { MetricsController } from '../../dist/platform/metrics/metrics.controller.js';
import { MetricsService } from '../../dist/platform/metrics/metrics.service.js';

const BASELINE_METRICS = [
  'http_server_requests_total',
  'http_server_request_duration_seconds',
  'tasks_created_total',
  'service_dependency_ready',
];

test('owned registry renders baseline application and selected default metrics', async () => {
  const metrics = new MetricsService();
  const output = await metrics.render();

  for (const metricName of BASELINE_METRICS) {
    assert.match(output, new RegExp(`# HELP ${metricName} `, 'u'));
    assert.match(output, new RegExp(`# TYPE ${metricName} `, 'u'));
  }
  assert.match(output, /^tasks_created_total 0$/mu);
  assert.match(output, /^service_dependency_ready 0$/mu);
  assert.match(output, /^# HELP process_resident_memory_bytes /mu);
  assert.match(output, /^# HELP nodejs_heap_size_used_bytes /mu);
  assert.equal(metrics.contentType, Registry.PROMETHEUS_CONTENT_TYPE);
});

test('separate MetricsService instances own isolated non-global registries', async () => {
  const first = new MetricsService();
  const second = new MetricsService();

  first.recordTaskCreated();
  first.setDependencyReady(true);

  const firstOutput = await first.render();
  const secondOutput = await second.render();
  assert.match(firstOutput, /^tasks_created_total 1$/mu);
  assert.match(firstOutput, /^service_dependency_ready 1$/mu);
  assert.match(secondOutput, /^tasks_created_total 0$/mu);
  assert.match(secondOutput, /^service_dependency_ready 0$/mu);
});

test('application metric recording emits only the fixed bounded label set', async () => {
  const metrics = new MetricsService();

  metrics.recordHttpRequest(
    { method: 'POST', route: '/v1/tasks', status_code: '201' },
    0.125,
  );
  metrics.recordTaskCreated();
  metrics.setDependencyReady(true);

  const output = await metrics.render();
  assert.match(
    output,
    /^http_server_requests_total\{method="POST",route="\/v1\/tasks",status_code="201"\} 1$/mu,
  );
  assert.match(
    output,
    /^http_server_request_duration_seconds_count\{method="POST",route="\/v1\/tasks",status_code="201"\} 1$/mu,
  );
  assert.match(output, /^tasks_created_total 1$/mu);
  assert.match(output, /^service_dependency_ready 1$/mu);
});

test('metrics controller renders the owned registry', async () => {
  const metrics = { render: async () => 'metrics-payload' };
  const controller = new MetricsController(metrics);

  assert.equal(await controller.scrape(), 'metrics-payload');
});
