# NestJS Production Starter

[![CI](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/Sye-1321/nestjs-production-starter/actions/workflows/ci.yml)

A small NestJS reference application for service startup, health checks, database
recovery, request handling and graceful shutdown. It uses a PostgreSQL-backed
Task resource and Prisma.

## Features

- Validated configuration and database checks before listening.
- Separate liveness and readiness endpoints.
- Graceful shutdown with an absolute deadline.
- Structured logging, request context and bounded Prometheus metrics.
- Non-root runtime container and process-level tests.

This is a reference to adapt, not a generator or a production-readiness
guarantee. Authentication and authorization are not included.

## Quick start

Prerequisites:

- Node.js `24.22.1`
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

## Verification

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

Docker is required for the non-unit suites. Linux CI is authoritative for POSIX
signal tests.

## Documentation

- [Architecture](docs/architecture.md)
- [Adapting the starter](docs/adapting-the-starter.md)
- [Operations and deployment](docs/operations.md)
- [Testing](docs/testing.md)
- [Runtime contract](docs/spec/v1-contract.md) and [traceability](docs/traceability.md)
- [Security](SECURITY.md) and [release review](docs/release-review.md)

## License

Licensed under the [MIT License](LICENSE).
