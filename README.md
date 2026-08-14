# NestJS Production Starter

A compact, executable reference for the operational contract of a NestJS HTTP
service. The repository implements one PostgreSQL-backed Task resource and
concentrates on startup, failure, observability, shutdown, container, and supply-
chain behavior that automated evidence can falsify.

The frozen v1 implementation contract is
[`docs/spec/v1-contract.md`](docs/spec/v1-contract.md). Every one of its 122
normative IDs maps to implementation, an exact test, and a CI/manual evidence
target in [`docs/traceability.md`](docs/traceability.md).

## Milestone status

| Milestone                                        | Status   |
| ------------------------------------------------ | -------- |
| M0 — Repository foundation                       | Complete |
| M1 — Configuration, lifecycle, and health        | Complete |
| M2 — HTTP boundary, errors, context, and logging | Complete |
| M3 — PostgreSQL and tiny Task feature            | Complete |
| M4 — Readiness transitions and metrics           | Complete |
| M5 — Shutdown and failure hardening              | Complete |
| M6 — Container and supply chain                  | Complete |
| M7 — Documentation and v1 release review         | Complete |

## What is implemented

- fail-before-listen configuration, Nest initialization, and PostgreSQL probe;
- explicit `BOOTING`, `READY`, `DRAINING`, `STOPPED`, and `FAILED_START`
  lifecycle;
- application-owned `SIGTERM`/`SIGINT`, graceful drain, and one global force
  deadline;
- strict JSON/media/DTO boundary with RFC 9457 Problem Details;
- duplicate-aware request IDs, native request abort signals, and
  `AsyncLocalStorage` context;
- bounded Pino JSON completion/error events with full-process secret canaries;
- one external `pg.Pool` shared by Prisma and real startup/readiness probes;
- external Prisma migrations and a concrete atomic Task repository;
- outage/recovery readiness, Prometheus metrics, and bounded route cardinality;
- a non-root multi-stage Node 24 image with `dumb-init` and final-image SIGTERM
  evidence;
- GitHub Actions verification, dependency review, CodeQL, Trivy, Dependabot,
  SHA-pinned actions, secret scanning, and push protection.

## Runtime baseline

- Node.js policy: `>=24.16.0 <25`
- development and CI patch: `24.19.0`
- npm: `11.17.0`
- NestJS: `11.1.28` with Express
- Prisma: `7.9.1` with `@prisma/adapter-pg`
- PostgreSQL test/local image: `18.4-bookworm`
- strict TypeScript, ESM, and `NodeNext` resolution

Versions and the complete dependency graph are exact in `package.json` and
`package-lock.json`.

## Quick start

Install and start the local PostgreSQL dependency:

```sh
npm ci
docker compose up -d postgres
```

Export the eight variables shown in `.env.example`. For the included Compose
database, use:

```text
DATABASE_URL=postgresql://nestjs_production_starter:nestjs_production_starter@127.0.0.1:5432/nestjs_production_starter
```

The application reads the process environment directly; `.env` is not loaded
automatically. Apply the committed migration, then build and run:

```sh
npm exec prisma migrate deploy
npm run build
npm run start:prod
```

With `PORT=3000`, create and read a Task:

```sh
curl -i -X POST http://127.0.0.1:3000/v1/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"Prove the production contract"}'

curl -i http://127.0.0.1:3000/v1/tasks/<task-uuid>
```

Task output contains only `id`, `title`, and `createdAt`. Validation, not-found,
dependency, and unexpected failures use the stable Problem Details catalogue.

## Endpoints

| Method | Path            | Purpose                                      |
| ------ | --------------- | -------------------------------------------- |
| `POST` | `/v1/tasks`     | create one Task                              |
| `GET`  | `/v1/tasks/:id` | read one Task by UUID                        |
| `GET`  | `/health/live`  | process liveness; never queries PostgreSQL   |
| `GET`  | `/health/ready` | READY lifecycle plus shared-pool `SELECT 1`  |
| `GET`  | `/metrics`      | Prometheus text from the in-process registry |

There is no startup endpoint: the HTTP listener is not opened before required
initialization succeeds.

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

Invalid values fail safely without echoing credentials or rejected data. See
[`docs/operations.md`](docs/operations.md) for deployment ordering, probe setup,
termination grace, incidents, and rollback boundaries.

## Container

Build the reproducible final image:

```sh
docker build --tag nestjs-production-starter:local .
```

Run it with a production environment file whose database hostname is reachable
from the container network:

```sh
docker run --rm --env-file .env -p 3000:3000 \
  nestjs-production-starter:local
```

Run `prisma migrate deploy` from a separately controlled checkout/migration job
before rollout. The runtime image deliberately excludes npm, Prisma CLI, source,
tests, development dependencies, source maps, Git data, and `.env` files.

The image has no Docker `HEALTHCHECK`. Orchestrators must target `/health/live`
and `/health/ready` independently and give the process a termination grace period
longer than `SHUTDOWN_TIMEOUT_MS`.

## Verification

From an exact install, run:

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

These commands are the GitHub Actions contract. Docker is required for every
suite after unit tests. Linux CI is authoritative for POSIX child-process signals;
the final-container test sends a real SIGTERM through PID 1 on Linux.

See [`docs/testing.md`](docs/testing.md) for evidence boundaries and failure
interpretation.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — runtime and module design
- [`docs/operations.md`](docs/operations.md) — deployment and incident runbook
- [`docs/testing.md`](docs/testing.md) — verification strategy
- [`docs/security.md`](docs/security.md) — controls and claim boundaries
- [`docs/traceability.md`](docs/traceability.md) — all normative IDs to evidence
- [`docs/decisions`](docs/decisions) — the four accepted architecture decisions

## Deliberate scope

V1 does not add authentication/authorization, CORS, proxy trust, Redis, queues,
generic repositories, a fake transaction layer, in-process migrations,
Kubernetes/Helm manifests, an outbound metrics backend, or supported published
images. TLS, secret delivery, network policy, PostgreSQL backups/recovery,
scheduling, and platform hardening remain deployment responsibilities.

These omissions are maintained boundaries, not implied production features. Add
a mechanism only with a concrete requirement, an ownership model, and evidence
at the boundary it claims to control.
