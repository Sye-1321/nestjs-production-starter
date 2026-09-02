# NestJS Production Starter

[![CI](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/codeql.yml/badge.svg)](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/codeql.yml)
[![Container Security](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/container-security.yml/badge.svg)](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/container-security.yml)
[![Release](https://img.shields.io/github/v/release/Sye-1321/nestjs-production-starter)](https://github.com/Sye-1321/nestjs-production-starter/releases)
[![License](https://img.shields.io/github/license/Sye-1321/nestjs-production-starter)](LICENSE)

A NestJS service can compile, pass its happy-path tests, and still behave badly
when configuration is invalid, PostgreSQL disappears, traffic is malformed, or
the process receives `SIGTERM` while requests are active.

This repository is an executable reference for those moments. It uses one small
PostgreSQL-backed Task resource so the important part stays visible: how an HTTP
service starts, reports health, handles failures, drains work, and shuts down.

**The business logic is intentionally small. The failure semantics are not.**

This is a reference to study and adapt, not a one-click generator, npm package,
or claim that application code alone makes a system production-ready.

## The problems it makes explicit

| Situation                                                            | Expected behavior                                                                                   | Evidence                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Configuration is invalid or PostgreSQL is unavailable during startup | Fail before binding the HTTP listener                                                               | Linux child-process startup tests                 |
| PostgreSQL becomes unavailable after startup and later recovers      | Readiness changes to unavailable and returns to ready without restarting the process                | PostgreSQL E2E and integration tests              |
| `SIGTERM` arrives while a request is active                          | Enter `DRAINING`, reject new Task work, let admitted work finish, and enforce one absolute deadline | Linux process and final-container tests           |
| Malformed input or an unexpected exception reaches the HTTP boundary | Return stable, sanitized errors without exposing credentials, request data, or internals            | E2E and process-level canary tests                |
| Concurrent requests carry different request IDs                      | Keep request context isolated and correlate logs without treating IDs as identity                   | 100-request database-backed E2E test              |
| Random unmatched paths reach the service                             | Keep metric labels bounded instead of creating one time series per path                             | Cardinality-focused E2E test                      |
| The final image receives a real termination signal                   | Forward the signal through PID 1, drain naturally, and run without root or build tooling            | Final-image inspection and SIGTERM contract tests |

Each claim is tested at the boundary it describes: PostgreSQL behavior uses real
PostgreSQL, signal behavior uses real Linux processes, and image behavior uses
the final runtime container.

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> BOOTING
  BOOTING --> READY: initialization, PostgreSQL probe, listen
  BOOTING --> FAILED_START: startup failure
  READY --> DRAINING: SIGTERM or SIGINT
  DRAINING --> STOPPED: listener and providers close
  DRAINING --> [*]: absolute deadline exceeded
```

The application validates configuration, initializes NestJS, and completes a
real PostgreSQL probe before it listens. During shutdown, one application-owned
coordinator moves the service into `DRAINING`, closes the listener, waits for
active work and provider cleanup, and forces a nonzero exit if the configured
deadline is exceeded.

There is no startup probe endpoint because an uninitialized process never opens
the port. Liveness reports whether the process can answer; readiness additionally
requires the `READY` lifecycle state and a successful query through the shared
database pool.

## Architecture

```mermaid
flowchart TD
  Client --> HTTP[Node HTTP server]
  HTTP --> Platform[Context · metrics · logging · draining · validation]
  Platform --> Task[Task feature]
  Task --> Prisma[Prisma client]
  Prisma --> Pool[Owned pg.Pool]
  Pool --> PostgreSQL[(PostgreSQL)]
```

`AppModule` composes configuration, request context, logging, database, error,
metrics, health, and Task modules. The Task module owns the only business feature;
platform modules own cross-cutting runtime behavior.

One externally owned `pg.Pool` is shared by Prisma and infrastructure probes.
Migrations remain an external deployment operation and never run during
application startup.

See [`docs/architecture.md`](docs/architecture.md) for the complete ownership and
runtime model.

## Quick start

Prerequisites:

- Node.js `24.19.0`
- npm `11.17.0`
- Docker using Linux containers

Install the committed dependency graph and start PostgreSQL:

```sh
npm ci
docker compose up -d postgres
```

The application reads the process environment directly and does not load `.env`
files. Export the reference development configuration:

```sh
export NODE_ENV=development
export PORT=3000
export LOG_LEVEL=debug
export DATABASE_URL=postgresql://nestjs_production_starter:nestjs_production_starter@127.0.0.1:5432/nestjs_production_starter
export DB_POOL_MAX=10
export DB_ACQUIRE_TIMEOUT_MS=1000
export DB_STATEMENT_TIMEOUT_MS=3000
export SHUTDOWN_TIMEOUT_MS=10000
```

Apply the committed migration, build, and start the service:

```sh
npm exec prisma migrate deploy
npm run build
npm run start:prod
```

Create a Task:

```sh
curl -i -X POST http://127.0.0.1:3000/v1/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"Prove the production contract"}'
```

Read it using the returned UUID:

```sh
curl -i http://127.0.0.1:3000/v1/tasks/<task-uuid>
```

Task responses contain only `id`, `title`, and `createdAt`. Validation,
not-found, recognized dependency, and unexpected failures cross a stable RFC
9457 boundary.

## Endpoints

| Method | Path            | Purpose                                             |
| ------ | --------------- | --------------------------------------------------- |
| `POST` | `/v1/tasks`     | Create one Task                                     |
| `GET`  | `/v1/tasks/:id` | Read one Task by UUID                               |
| `GET`  | `/health/live`  | Report process liveness without querying PostgreSQL |
| `GET`  | `/health/ready` | Require `READY` state and a shared-pool `SELECT 1`  |
| `GET`  | `/metrics`      | Expose Prometheus text from the in-process registry |

## Runtime and configuration

The stable `v1.0.0` baseline uses:

- Node.js policy: `>=24.16.0 <25`
- development and CI patch: `24.19.0`
- npm: `11.17.0`
- NestJS: `11.1.28` with Express
- Prisma: `7.9.1` with `@prisma/adapter-pg`
- PostgreSQL test and local image: `18.4-bookworm`
- strict TypeScript, ESM, and `NodeNext` resolution

Application and development dependencies are exact in `package.json` and
`package-lock.json`. The repository is `private: true` because it is an
application reference, not a published package.

| Variable                  | Required | Default or accepted range              |
| ------------------------- | -------- | -------------------------------------- |
| `NODE_ENV`                | yes      | `development`, `test`, or `production` |
| `PORT`                    | yes      | integer `1..65535`                     |
| `LOG_LEVEL`               | no       | `info`                                 |
| `DATABASE_URL`            | yes      | PostgreSQL URL                         |
| `DB_POOL_MAX`             | no       | `10`; range `1..50`                    |
| `DB_ACQUIRE_TIMEOUT_MS`   | no       | `1000`; range `100..30000`             |
| `DB_STATEMENT_TIMEOUT_MS` | no       | `3000`; range `100..60000`             |
| `SHUTDOWN_TIMEOUT_MS`     | no       | `10000`; range `1000..60000`           |

Invalid values fail without echoing credentials or rejected input. These bounds
are reference policies, not universal defaults; adopters must reassess them
against their own traffic, latency objectives, database capacity, and deployment
grace periods.

## Error, logging, and metrics boundaries

- Strict DTO validation rejects unknown fields and malformed input.
- Task writes require a JSON media type and use a `100 KiB` body limit.
- RFC 9457 responses expose only catalogue-controlled fields.
- Unexpected failures, database details, stack traces, and rejected values stay
  outside public responses.
- Structured logs use an allowlist rather than recording raw bodies, complete
  headers, database URLs, or arbitrary error objects.
- Request IDs are untrusted correlation values, not identities or authorization
  inputs.
- Metrics use route templates or bounded constants instead of raw URLs, resource
  IDs, request IDs, or error messages.

The database boundary maps only failure shapes observed against the pinned
Prisma and `pg` stack to dependency-unavailable `503` responses. Unknown failures
remain sanitized `500` responses rather than being guessed to be transient.

## Verification

Start from an exact install:

```sh
npm ci
```

Run the verification layers:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:process
npm run test:container
```

Docker is required for every suite after unit tests. Linux CI is authoritative
for POSIX signal behavior; the container suite sends a real `SIGTERM` through
PID 1. CI also runs dependency review, CodeQL, and Trivy image scanning with
external actions pinned to full commit SHAs.

See [`docs/testing.md`](docs/testing.md) for the evidence hierarchy and how to
interpret environment, timeout, process, and scanner failures.

## Container contract

Build the final image:

```sh
docker build --tag nestjs-production-starter:local .
```

Run it with a production environment file whose PostgreSQL hostname is reachable
from the container network:

```sh
docker run --rm --env-file .env -p 3000:3000 \
  nestjs-production-starter:local
```

Run `prisma migrate deploy` from a separately controlled checkout or migration
job before rollout. The runtime image:

- uses a digest-pinned Node 24 Debian-slim base;
- runs as the non-root `node` user;
- uses `dumb-init` as PID 1;
- contains runtime dependencies and compiled output only; and
- excludes npm, the Prisma CLI, source, tests, development dependencies, source
  maps, Git data, and environment files.

The image deliberately has no Docker `HEALTHCHECK`. Orchestrators should target
`/health/live` and `/health/ready` independently and provide a termination grace
period longer than `SHUTDOWN_TIMEOUT_MS`.

## Adapting the starter

Keep the operational foundations that match your service, replace the Task slice
as one coherent domain change, and retest every guarantee after adaptation.

At minimum, replacing Task means updating its module, controller, service,
repository, DTOs, errors, Prisma model, migration, metric, routes, tests, and
traceability mappings together. Do not keep Task names around a different
domain, and do not copy timeout or capacity values without measuring the new
deployment.

[`docs/adapting-the-starter.md`](docs/adapting-the-starter.md) separates the
foundations normally retained, the application-specific pieces to replace, and
the policy values every adopter must reconsider.

## Deliberate boundaries

V1 does not add authentication, authorization, CORS, or proxy trust without an
actual principal, browser, or deployment-topology requirement. It also avoids
Redis, brokers, queues, GraphQL, CQRS, event sourcing, generic repositories,
in-process migrations, Kubernetes, Helm, Terraform, a service mesh, and
OpenTelemetry merely for appearance.

TLS termination, secret delivery, network policy, PostgreSQL backup and recovery,
scheduling, and platform hardening remain deployment responsibilities. The
repository documents these boundaries instead of implying that it supplies
them.

## Engineering evidence

The stable contract contains 122 normative requirements. Each maps to
implementation, named evidence, and CI or manual ownership in
[`docs/traceability.md`](docs/traceability.md).

- [`docs/spec/v1-contract.md`](docs/spec/v1-contract.md) — frozen behavioral
  contract
- [`docs/architecture.md`](docs/architecture.md) — runtime and module ownership
- [`docs/operations.md`](docs/operations.md) — deployment and incident runbook
- [`docs/testing.md`](docs/testing.md) — verification strategy
- [`docs/security.md`](docs/security.md) — controls and claim boundaries
- [`docs/adapting-the-starter.md`](docs/adapting-the-starter.md) — adoption guide
- [`docs/decisions`](docs/decisions) — accepted architecture decisions
- [`docs/release-review.md`](docs/release-review.md) — `v1.0.0` acceptance record
- [`SECURITY.md`](SECURITY.md) — private vulnerability reporting policy

## License

Licensed under the [MIT License](LICENSE).
