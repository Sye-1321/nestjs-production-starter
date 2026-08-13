import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

const HTTP_LABEL_NAMES = ['method', 'route', 'status_code'] as const;
const HTTP_DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

export interface HttpMetricLabels {
  readonly method: string;
  readonly route: string;
  readonly status_code: string;
}

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly httpRequests = new Counter({
    name: 'http_server_requests_total',
    help: 'Total completed HTTP server requests.',
    labelNames: HTTP_LABEL_NAMES,
    registers: [this.registry],
  });
  private readonly httpRequestDuration = new Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'HTTP server request duration in seconds.',
    labelNames: HTTP_LABEL_NAMES,
    buckets: [...HTTP_DURATION_BUCKETS_SECONDS],
    registers: [this.registry],
  });
  private readonly tasksCreated = new Counter({
    name: 'tasks_created_total',
    help: 'Total Tasks created successfully.',
    registers: [this.registry],
  });
  private readonly dependencyReady = new Gauge({
    name: 'service_dependency_ready',
    help: 'Whether the required PostgreSQL dependency is ready.',
    registers: [this.registry],
  });
  private readonly processResidentMemory = new Gauge({
    name: 'process_resident_memory_bytes',
    help: 'Resident memory size in bytes.',
    registers: [this.registry],
    collect() {
      this.set(process.memoryUsage.rss());
    },
  });
  private readonly nodeHeapUsed = new Gauge({
    name: 'nodejs_heap_size_used_bytes',
    help: 'Process heap size used from Node.js in bytes.',
    registers: [this.registry],
    collect() {
      this.set(process.memoryUsage().heapUsed);
    },
  });

  public constructor() {
    this.tasksCreated.inc(0);
    this.dependencyReady.set(0);
  }

  public get contentType(): string {
    return this.registry.contentType;
  }

  public render(): Promise<string> {
    return this.registry.metrics();
  }

  public recordHttpRequest(
    labels: HttpMetricLabels,
    durationSeconds: number,
  ): void {
    this.httpRequests.inc(labels);
    this.httpRequestDuration.observe(labels, durationSeconds);
  }

  public recordTaskCreated(): void {
    this.tasksCreated.inc();
  }

  public setDependencyReady(ready: boolean): void {
    this.dependencyReady.set(ready ? 1 : 0);
  }
}
