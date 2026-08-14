# NestJS Production Starter

[![CI](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/codeql.yml/badge.svg)](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/codeql.yml)
[![Container Security](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/container-security.yml/badge.svg)](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/container-security.yml)
[![Release](https://img.shields.io/github/v/release/Sye-1321/nestjs-production-starter)](https://github.com/Sye-1321/nestjs-production-starter/releases)
[![License](https://img.shields.io/github/license/Sye-1321/nestjs-production-starter)](LICENSE)

NestJS Production Starter is a compact executable reference for the operational
contract of a production-oriented NestJS HTTP service.

**Business logic is intentionally small. Failure semantics are not.**

The repository contains one PostgreSQL-backed Task resource so attention stays
on runtime correctness rather than feature breadth. Production claims are tested
at the boundary they describe: PostgreSQL claims use PostgreSQL, shutdown claims
use real processes and signals, and container claims use the final Linux image.

## Why this exists

Framework tutorials make successful requests easy to demonstrate. They rarely
make startup ordering, dependency failure, readiness recovery, request isolation,
bounded error exposure, and termination ownership equally explicit.

This project keeps the domain deliberately tiny and makes those process-level
decisions executable. It is a reference for understanding and adapting a service
contract, not a generic boilerplate, generator, npm package, or infrastructure
platform.

## Operational guarantees

| Guarantee                                                                  | Principal evidence                              |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| Invalid configuration or unavailable PostgreSQL fails before listen        | Linux child-process startup tests               |
| Readiness follows PostgreSQL outage and recovery without a process restart | real PostgreSQL E2E and integration tests       |
| Active work can drain under one absolute shutdown deadline                 | Linux process and final-container SIGTERM tests |
| No new Task work begins after `DRAINING`                                   | persistent keep-alive process test              |
| Request context remains isolated under concurrency                         | 100-way database-backed E2E test                |
| Public errors and process logs exclude injected canaries                   | E2E and full-process boundary tests             |
| Metrics use bounded route and status labels                                | randomized-path E2E cardinality test            |
| The runtime image is non-root, signal-correct, and runtime-only            | final-image inspection and execution tests      |
| Dependency and image changes remain reviewable                             | dependency review, CodeQL, Trivy, and SHA pins  |

The database boundary maps only failure shapes observed against the pinned
Prisma/pg stack to dependency-unavailable `503` responses. Unknown failures are
not guessed to be transient; they cross the same sanitized `500` boundary as
other unexpected errors.

## Architecture

```mermaid
flowchart TD
  Client --> Node[Node / NestJS]
  Node --> Platform[Request context · metrics · logging · draining · validation]
  Platform --> Task[Task feature]
  Task --> Prisma[Prisma]
  Prisma --> Pool[One owned pg.Pool]
  Pool --> PostgreSQL[(PostgreSQL)]
```

Configuration, Nest initialization, and a real PostgreSQL probe complete before
the listener binds. One application-owned lifecycle coordinates readiness,
draining, provider cleanup, and forced termination. One external `pg.Pool` is
shared by Prisma and infrastructure probes.

See [`docs/architecture.md`](docs/architecture.md) for the complete runtime and
ownership model.

## Quick start

Prerequisites are Node.js `24.19.0`, npm `11.17.0`, and Docker using Linux
containers.

Install the committed dependency graph and start local PostgreSQL:

```sh
npm ci
docker compose up -d postgres
```

The application reads the process environment directly; it does not load
`.env`. Export the reference development values:

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

Apply the committed migration externally, then build and start the service:

```sh
npm exec prisma migrate deploy
npm run build
npm run start:prod
```

Create and read a Task:

```sh
curl -i -X POST http://127.0.0.1:3000/v1/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"Prove the production contract"}'

curl -i http://127.0.0.1:3000/v1/tasks/<task-uuid>
```

Task output contains only `id`, `title`, and `createdAt`. Validation, not-found,
recognized dependency, and unexpected failures use the stable RFC 9457 boundary.

## Endpoints

| Method | Path            | Purpose                                       |
| ------ | --------------- | --------------------------------------------- |
| `POST` | `/v1/tasks`     | create one Task                               |
| `GET`  | `/v1/tasks/:id` | read one Task by UUID                         |
| `GET`  | `/health/live`  | process liveness; never queries PostgreSQL    |
| `GET`  | `/health/ready` | `READY` lifecycle plus shared-pool `SELECT 1` |
| `GET`  | `/metrics`      | Prometheus text from the in-process registry  |

There is no startup endpoint because the service does not listen before required
initialization succeeds.

## Runtime baseline

- Node.js policy: `>=24.16.0 <25`
- development and CI patch: `24.19.0`
- npm: `11.17.0`
- NestJS: `11.1.28` with Express
- Prisma: `7.9.1` with `@prisma/adapter-pg`
- PostgreSQL test/local image: `18.4-bookworm`
- strict TypeScript, ESM, and `NodeNext` resolution

Versions and the resolved dependency graph are exact in `package.json` and
`package-lock.json`. The repository remains `private: true` because it is an
application/reference repository, not an npm-published package.

## Configuration

| Variable                  | Required | Default/bound                          |
| ------------------------- | -------- | -------------------------------------- |
| `NODE_ENV`                | yes      | `development`, `test`, or `production` |
| `PORT`                    | yes      | integer `1..65535`                     |
| `LOG_LEVEL`               | no       | `info`                                 |
| `DATABASE_URL`            | yes      | PostgreSQL URL                         |
| `DB_POOL_MAX`             | no       | `10`, range `1..50`                    |
| `DB_ACQUIRE_TIMEOUT_MS`   | no       | `1000`, range `100..30000`             |
| `DB_STATEMENT_TIMEOUT_MS` | no       | `3000`, range `100..60000`             |
| `SHUTDOWN_TIMEOUT_MS`     | no       | `10000`, range `1000..60000`           |

Invalid values fail without echoing credentials or rejected data. The timeout
and pool defaults are reference policies, not universal constants. See
[`docs/operations.md`](docs/operations.md) for deployment ordering, probe
configuration, termination grace, incidents, and rollback boundaries.

## Verification

Run the complete local gate from an exact install:

```sh
npm ci
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
for POSIX child-process signals; the final-container suite sends a real SIGTERM
through PID 1. See [`docs/testing.md`](docs/testing.md) for the evidence
hierarchy and failure interpretation.

## Container

Build the reproducible final image:

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
job before rollout. The runtime image excludes npm, the Prisma CLI, source,
tests, development dependencies, source maps, Git data, and environment files.

The image has no Docker `HEALTHCHECK`. Orchestrators must target
`/health/live` and `/health/ready` independently and provide a termination grace
period longer than `SHUTDOWN_TIMEOUT_MS`.

## Adapting the starter

[`docs/adapting-the-starter.md`](docs/adapting-the-starter.md) separates the
operational foundations normally retained, the Task-specific pieces to replace,
and the timeout/version/capacity values every adopter must reassess.

Adapt the evidence with the code. A mechanism should remain only when the new
service can explain its ownership, failure behavior, and falsifying test.

## Scope and deliberate exclusions

V1 does not add authentication or authorization without a principal/domain
requirement; CORS without a browser cross-origin requirement; proxy trust without
a deployment topology; or Redis, brokers, queues, GraphQL, CQRS, event sourcing,
generic repositories, fake transactions, in-process migrations, Kubernetes,
Helm, Terraform, a service mesh, or OpenTelemetry merely for appearance.

TLS, secret delivery, network policy, PostgreSQL backups and recovery,
scheduling, and platform hardening remain deployment responsibilities. These
are maintained boundaries, not implied capabilities.

## Engineering contract and documentation

V1 is governed by the frozen behavioral contract in
[`docs/spec/v1-contract.md`](docs/spec/v1-contract.md). Its 122 normative
requirements map to implementation, exact evidence names, and CI/manual owners
in [`docs/traceability.md`](docs/traceability.md).

- [`docs/architecture.md`](docs/architecture.md) — runtime and module design
- [`docs/operations.md`](docs/operations.md) — deployment and incident runbook
- [`docs/testing.md`](docs/testing.md) — verification strategy
- [`docs/security.md`](docs/security.md) — controls and claim boundaries
- [`SECURITY.md`](SECURITY.md) — private vulnerability reporting policy
- [`docs/decisions`](docs/decisions) — accepted architecture decisions
- [`docs/release-review.md`](docs/release-review.md) — release acceptance record

## License

Licensed under the [MIT License](LICENSE).
