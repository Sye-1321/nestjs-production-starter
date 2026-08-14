# V1 requirement traceability

This matrix is the M7 release disposition for every normative ID in the frozen
v1 contract. `PASS` means the repository contains the named implementation and
the exact automated or repository-setting evidence shown. CI names are workflow
job IDs; `Manual` identifies evidence that cannot live entirely in Git.

## Configuration

| ID      | Status | Implementation                                | Exact evidence name                                                  | CI job(s)          |
| ------- | ------ | --------------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| CFG-001 | PASS   | `src/main.ts`, `src/config/env.validation.ts` | “invalid required configuration exits non-zero without ever serving” | `process`          |
| CFG-002 | PASS   | `src/config/env.validation.ts`                | “configuration environment surface remains exactly frozen”           | `quality-and-unit` |
| CFG-003 | PASS   | `src/config/env.validation.ts`                | “unspecified environment variables never enter AppConfig”            | `quality-and-unit` |
| CFG-004 | PASS   | `src/bootstrap/bootstrap-logger.ts`           | “invalid DATABASE_URL never leaks its credential canary”             | `process`          |
| CFG-005 | PASS   | `src/config/config.types.ts`, `.env.example`  | “configuration environment surface remains exactly frozen”           | `quality-and-unit` |

## Bootstrap

| ID       | Status | Implementation                                                            | Exact evidence name                                                                 | CI job(s)          |
| -------- | ------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------ |
| BOOT-001 | PASS   | `src/bootstrap/bootstrap.ts`                                              | “PostgreSQL unavailable at startup prevents listen and leaks no database details”   | `process`          |
| BOOT-002 | PASS   | `src/bootstrap/bootstrap.ts`, `src/platform/database/database.service.ts` | “startup PostgreSQL probe succeeds before listen and health endpoints are ready”    | `process`          |
| BOOT-003 | PASS   | `src/main.ts`, `src/bootstrap/bootstrap.ts`                               | “invalid required configuration exits non-zero without ever serving”                | `process`          |
| BOOT-004 | PASS   | `prisma.config.ts`, `prisma/migrations`                                   | “runtime source has no Prisma migration execution and no Testcontainers dependency” | `quality-and-unit` |
| BOOT-005 | PASS   | `src/bootstrap/shutdown-coordinator.ts`                                   | “SIGTERM during controlled BOOTING pause prevents later listen”                     | `process`          |
| BOOT-006 | PASS   | `src/main.ts`, `src/bootstrap/bootstrap-logger.ts`                        | “arbitrary bootstrap errors are not serialized into startup failure output”         | `quality-and-unit` |

## Lifecycle

| ID       | Status | Implementation                                     | Exact evidence name                                                                      | CI job(s)          |
| -------- | ------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| LIFE-001 | PASS   | `src/bootstrap/lifecycle.ts`                       | “lifecycle supports BOOTING -> READY -> DRAINING -> STOPPED”                             | `quality-and-unit` |
| LIFE-002 | PASS   | `src/bootstrap/shutdown-coordinator.ts`            | “ShutdownCoordinator is the only production SIGTERM/SIGINT listener owner”               | `quality-and-unit` |
| LIFE-003 | PASS   | `src/bootstrap/shutdown-coordinator.ts`            | “first shutdown request enters DRAINING synchronously and records one absolute deadline” | `quality-and-unit` |
| LIFE-004 | PASS   | `src/platform/context/draining-gate.middleware.ts` | “a pre-existing keep-alive transport starts no Task work after DRAINING”                 | `process`          |
| LIFE-005 | PASS   | `src/bootstrap/bootstrap.ts`                       | “a pre-existing keep-alive transport starts no Task work after DRAINING”                 | `process`          |
| LIFE-006 | PASS   | `src/bootstrap/bootstrap.ts`                       | “active Task work completes before provider teardown and natural exit”                   | `process`          |
| LIFE-007 | PASS   | `src/bootstrap/bootstrap.ts`                       | “deadline force-closes active HTTP work and exits non-zero exactly once”                 | `process`          |
| LIFE-008 | PASS   | `src/bootstrap/shutdown-coordinator.ts`            | “idle SIGTERM drains and exits naturally”                                                | `process`          |
| LIFE-009 | PASS   | `src/bootstrap/shutdown-coordinator.ts`            | “repeated shutdown requests preserve the original deadline and sequence”                 | `quality-and-unit` |
| LIFE-010 | PASS   | `test/process/run-process-tests.mjs`, `Dockerfile` | “final image receives SIGTERM through PID 1 and drains active work naturally”            | `container`        |

## HTTP

| ID       | Status | Implementation                                                         | Exact evidence name                                                                                               | CI job(s)          |
| -------- | ------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------ |
| HTTP-001 | PASS   | `package.json`, `src/bootstrap/bootstrap.ts`                           | “HTTP dependency policy preserves Express and pins Helmet directly”                                               | `quality-and-unit` |
| HTTP-002 | PASS   | `src/bootstrap/http-server.ts`                                         | “raw Node HTTP server receives the exact fixed transport policy”                                                  | `quality-and-unit` |
| HTTP-003 | PASS   | `src/bootstrap/http-server.ts`                                         | “real HTTP malformed, media-type, and oversized inputs fail before Task work”                                     | `e2e`              |
| HTTP-004 | PASS   | `src/platform/errors/task-content-type.middleware.ts`                  | “real HTTP malformed, media-type, and oversized inputs fail before Task work”                                     | `e2e`              |
| HTTP-005 | PASS   | `src/platform/errors/body-parser-error.middleware.ts`                  | “body-parser failures map narrowly without exposing parser metadata”                                              | `quality-and-unit` |
| HTTP-006 | PASS   | `src/platform/errors/strict-validation.pipe.ts`                        | “strict validation rejects unknown fields and does not implicitly convert values”                                 | `quality-and-unit` |
| HTTP-007 | PASS   | `src/task/dto/create-task.dto.ts`                                      | “CreateTaskDto validates the normalized title and rejects unknown input”                                          | `quality-and-unit` |
| HTTP-008 | PASS   | `src/task/dto/task-id-params.dto.ts`                                   | “Task identifier validation rejects invalid UUIDs before repository execution”                                    | `quality-and-unit` |
| HTTP-009 | PASS   | `src/bootstrap/http-server.ts`                                         | “HTTP application installs the complete pre-router policy in frozen order”                                        | `quality-and-unit` |
| HTTP-010 | PASS   | `src/bootstrap/http-server.ts`                                         | “production source does not enable forbidden HTTP transport mechanisms”                                           | `quality-and-unit` |
| HTTP-011 | PASS   | `src/bootstrap/http-server.ts`                                         | “production source does not enable forbidden HTTP transport mechanisms”                                           | `quality-and-unit` |
| HTTP-012 | PASS   | `src/platform/context/draining-gate.middleware.ts`                     | “DRAINING /v1 returns Problem Details, closes the connection, blocks downstream, and remains completion-loggable” | `quality-and-unit` |
| HTTP-013 | PASS   | `src/bootstrap/http-server.ts`, `src/platform/database/pool-config.ts` | “production source does not enable forbidden HTTP transport mechanisms”                                           | `quality-and-unit` |

## Errors

| ID      | Status | Implementation                                                                       | Exact evidence name                                                                       | CI job(s)          |
| ------- | ------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------ |
| ERR-001 | PASS   | `src/platform/errors/problem-details.ts`                                             | “problem catalogue is exactly the frozen seven categories”                                | `quality-and-unit` |
| ERR-002 | PASS   | `src/platform/errors/problem-catalogue.ts`                                           | “problem catalogue is exactly the frozen seven categories”                                | `quality-and-unit` |
| ERR-003 | PASS   | `src/platform/errors/problem-details.ts`                                             | “Problem Details uses the existing request context ID and no instance”                    | `quality-and-unit` |
| ERR-004 | PASS   | `src/platform/errors/problem-details-exception.filter.ts`                            | “TaskNotFoundError maps through the existing Problem Details boundary”                    | `quality-and-unit` |
| ERR-005 | PASS   | `src/platform/errors/problem-details-exception.filter.ts`                            | “unexpected HTTP 5xx payload is sanitized publicly and logged once without canaries”      | `process`          |
| ERR-006 | PASS   | `src/task/task.errors.ts`, `src/platform/errors/problem-details-exception.filter.ts` | “transport-specific HttpException ownership remains inside the HTTP boundary”             | `quality-and-unit` |
| ERR-007 | PASS   | `src/platform/logging/application-logger.ts`                                         | “unexpected-error child fixture emits one bounded failure record without nested canaries” | `process`          |
| ERR-008 | PASS   | `src/platform/errors/problem-details-exception.filter.ts`                            | “routine readiness HttpException remains operational JSON, not Problem Details”           | `quality-and-unit` |

## Request context

| ID      | Status | Implementation                                                              | Exact evidence name                                                                               | CI job(s)          |
| ------- | ------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------ |
| CTX-001 | PASS   | `src/platform/context/request-context.ts`                                   | “request context survives promise and timer continuations”                                        | `quality-and-unit` |
| CTX-002 | PASS   | `src/platform/context/request-context.middleware.ts`                        | “native request signal aborts active disconnected work without misclassifying later socket close” | `process`          |
| CTX-003 | PASS   | `src/platform/context/request-context.middleware.ts`                        | “native request signal aborts active disconnected work without misclassifying later socket close” | `process`          |
| CTX-004 | PASS   | `src/platform/context/request-id.ts`                                        | “invalid upstream request IDs are replaced with generated UUIDs”                                  | `quality-and-unit` |
| CTX-005 | PASS   | `src/platform/context/request-id.ts`                                        | “raw duplicate x-request-id field lines are replaced by a generated UUID”                         | `process`          |
| CTX-006 | PASS   | `src/platform/context/request-id.ts`, `src/platform/http/http-telemetry.ts` | “request metrics use only the shared bounded method, route, and status labels”                    | `quality-and-unit` |
| CTX-007 | PASS   | `src/platform/context/request-context.middleware.ts`                        | “request middleware propagates one chosen ID and the native request signal”                       | `quality-and-unit` |
| CTX-008 | PASS   | `src/platform/context/request-context.ts`                                   | “100 interleaved Task requests preserve context through real PostgreSQL success and rejection”    | `e2e`              |

## Logging

| ID      | Status | Implementation                                       | Exact evidence name                                                                       | CI job(s)          |
| ------- | ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------ |
| LOG-001 | PASS   | `src/platform/logging/application-logger.ts`         | “Pino dependency is direct, exact, and has no logging wrappers”                           | `quality-and-unit` |
| LOG-002 | PASS   | `src/platform/logging/request-logging.middleware.ts` | “application logger emits one bounded parseable JSON completion record”                   | `quality-and-unit` |
| LOG-003 | PASS   | `src/platform/http/http-telemetry.ts`                | “HTTP route normalization uses only a matched template or UNMATCHED”                      | `quality-and-unit` |
| LOG-004 | PASS   | `src/platform/logging/request-logging.middleware.ts` | “full application process output excludes request header, body, and query canaries”       | `process`          |
| LOG-005 | PASS   | `src/platform/logging/application-logger.ts`         | “unexpected-error child fixture emits one bounded failure record without nested canaries” | `process`          |
| LOG-006 | PASS   | `src/platform/logging/request-logging.middleware.ts` | “successful operational completions are DEBUG and failures remain INFO”                   | `quality-and-unit` |
| LOG-007 | PASS   | `src/platform/logging/application-logger.ts`         | “unexpected HTTP 5xx payload is sanitized publicly and logged once without canaries”      | `process`          |
| LOG-008 | PASS   | `src/bootstrap/bootstrap-logger.ts`                  | “forced shutdown uses a distinct synchronous event identity”                              | `quality-and-unit` |

## Health

| ID       | Status | Implementation                              | Exact evidence name                                                                        | CI job(s)          |
| -------- | ------ | ------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------ |
| HLTH-001 | PASS   | `src/platform/health/health.controller.ts`  | “liveness controller behavior remains unchanged”                                           | `quality-and-unit` |
| HLTH-002 | PASS   | `src/platform/health/readiness.service.ts`  | “READY runs the shared database probe and evaluates true on success”                       | `quality-and-unit` |
| HLTH-003 | PASS   | `src/platform/health/readiness.service.ts`  | “DRAINING is not ready and does not invoke the dependency probe”                           | `quality-and-unit` |
| HLTH-004 | PASS   | `src/platform/health/readiness.service.ts`  | “readiness and Task operations recover after the same PostgreSQL container restarts”       | `e2e`              |
| HLTH-005 | PASS   | `src/platform/health/readiness.service.ts`  | “readiness and Task operations recover after the same PostgreSQL container restarts”       | `e2e`              |
| HLTH-006 | PASS   | `src/platform/database/database.service.ts` | “readiness uses the DI-owned DatabaseService probe and no alternate timeout or pool”       | `quality-and-unit` |
| HLTH-007 | PASS   | `src/platform/database/pool-config.ts`      | “real PostgreSQL statement timeout classifies narrowly and leaves the shared pool healthy” | `integration`      |
| HLTH-008 | PASS   | `src/platform/health/health.controller.ts`  | “startup PostgreSQL probe succeeds before listen and health endpoints are ready”           | `process`          |

## Database

| ID     | Status | Implementation                              | Exact evidence name                                                                           | CI job(s)          |
| ------ | ------ | ------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------ |
| DB-001 | PASS   | `src/platform/database/database.module.ts`  | “DatabaseModule is global, registered exactly once, and owns one pool plus one Prisma client” | `quality-and-unit` |
| DB-002 | PASS   | `src/platform/database/pool-config.ts`      | “pool config maps only the required bounded database settings”                                | `quality-and-unit` |
| DB-003 | PASS   | `src/platform/database/pool-config.ts`      | “real pool acquisition timeout is bounded, drains waiters, classifies narrowly, and recovers” | `integration`      |
| DB-004 | PASS   | `src/platform/database/pool-config.ts`      | “real PostgreSQL statement timeout classifies narrowly and leaves the shared pool healthy”    | `integration`      |
| DB-005 | PASS   | `src/platform/database/database.module.ts`  | “PrismaClient construction is application-scoped and not per request”                         | `quality-and-unit` |
| DB-006 | PASS   | `src/platform/database/database.module.ts`  | “idle pool errors emit only a fixed event and bounded error type”                             | `quality-and-unit` |
| DB-007 | PASS   | `src/bootstrap/bootstrap.ts`                | “startup PostgreSQL probe succeeds before listen and health endpoints are ready”              | `process`          |
| DB-008 | PASS   | `src/platform/database/database.service.ts` | “cleanup disconnects Prisma before ending the external pool”                                  | `quality-and-unit` |
| DB-009 | PASS   | `prisma.config.ts`, `prisma/migrations`     | “external migrate deploy produces the exact Task schema from an empty database”               | `integration`      |
| DB-010 | PASS   | `src/task/task.repository.ts`               | “TaskRepository is the only concrete repository and reuses DatabaseService.prisma”            | `quality-and-unit` |
| DB-011 | PASS   | `src/task/task.repository.ts`               | “database waits and Task creation contain no fake timeout or transaction mechanisms”          | `quality-and-unit` |
| DB-012 | PASS   | `src/platform/database/database.errors.ts`  | “DB classifier has exact pinned transient branches”                                           | `quality-and-unit` |

## Metrics

| ID      | Status | Implementation                                       | Exact evidence name                                                                           | CI job(s)          |
| ------- | ------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------ |
| MET-001 | PASS   | `src/platform/metrics/metrics.controller.ts`         | “prom-client is one exact direct production dependency”                                       | `quality-and-unit` |
| MET-002 | PASS   | `src/platform/metrics/metrics.service.ts`            | “owned registry renders baseline application and selected default metrics”                    | `quality-and-unit` |
| MET-003 | PASS   | `src/platform/http/http-telemetry.ts`                | “application metric recording emits only the fixed bounded label set”                         | `quality-and-unit` |
| MET-004 | PASS   | `src/platform/metrics/request-metrics.middleware.ts` | “request metrics use only the shared bounded method, route, and status labels”                | `quality-and-unit` |
| MET-005 | PASS   | `src/platform/http/http-telemetry.ts`                | “Prometheus metrics are complete and 100 random unmatched paths have one bounded route label” | `e2e`              |
| MET-006 | PASS   | `src/platform/metrics/metrics.service.ts`            | “baseline metrics are exact and pull-only”                                                    | `quality-and-unit` |

## Security

| ID      | Status | Implementation                                    | Exact evidence name                                                                                              | CI job(s)                                |
| ------- | ------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| SEC-001 | PASS   | `src/bootstrap/http-server.ts`, `Dockerfile`      | “HTTP application policy orders context, metrics, logging, Helmet, drain, media type, parser, and parser errors” | `quality-and-unit`, `container`, `trivy` |
| SEC-002 | PASS   | `src/task/task.controller.ts`, `docs/security.md` | “Task API contains exactly POST create and GET by UUID with frozen DTO policy”                                   | `quality-and-unit`                       |
| SEC-003 | PASS   | `.env.example`, `.gitignore`, `.dockerignore`     | “repository secret controls retain placeholders while excluding local environments”                              | `quality-and-unit`                       |
| SEC-004 | PASS   | `src/bootstrap/http-server.ts`                    | “production source does not enable forbidden HTTP transport mechanisms”                                          | `quality-and-unit`                       |

## Container

| ID       | Status | Implementation                             | Exact evidence name                                                                    | CI job(s)          |
| -------- | ------ | ------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------ |
| CONT-001 | PASS   | `Dockerfile`                               | “final image source pins the approved runtime and preserves the runtime-only contract” | `quality-and-unit` |
| CONT-002 | PASS   | `Dockerfile`, `.dockerignore`              | “final image is non-root, signal-correct, and contains runtime material only”          | `container`        |
| CONT-003 | PASS   | `Dockerfile`                               | “final image is non-root, signal-correct, and contains runtime material only”          | `container`        |
| CONT-004 | PASS   | `Dockerfile`                               | “final image receives SIGTERM through PID 1 and drains active work naturally”          | `container`        |
| CONT-005 | PASS   | `test/container/sigterm.contract.test.mjs` | “final image receives SIGTERM through PID 1 and drains active work naturally”          | `container`        |
| CONT-006 | PASS   | `Dockerfile`, `docs/operations.md`         | “final image source pins the approved runtime and preserves the runtime-only contract” | `quality-and-unit` |

## Verification strategy

| ID       | Status | Implementation                                          | Exact evidence name                                                                               | CI job(s)                                                        |
| -------- | ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| TEST-001 | PASS   | `docs/testing.md`, `package.json`                       | “CI and dependency automation cover the complete frozen verification surface”                     | `quality-and-unit`, `integration`, `e2e`, `process`, `container` |
| TEST-002 | PASS   | `test/support/run-postgresql-suite.mjs`                 | “integration and e2e suites use one external migration harness with real PostgreSQL”              | `integration`, `e2e`                                             |
| TEST-003 | PASS   | `test/process/startup.process.test.mjs`                 | “PostgreSQL unavailable at startup prevents listen and leaks no database details”                 | `process`                                                        |
| TEST-004 | PASS   | `test/e2e/readiness-recovery.e2e.test.mjs`              | “readiness and Task operations recover after the same PostgreSQL container restarts”              | `e2e`                                                            |
| TEST-005 | PASS   | `test/e2e/context-isolation.e2e.test.mjs`               | “100 interleaved Task requests preserve context through real PostgreSQL success and rejection”    | `e2e`                                                            |
| TEST-006 | PASS   | `test/process/http-boundary.process.test.mjs`           | “raw duplicate x-request-id field lines are replaced by a generated UUID”                         | `process`                                                        |
| TEST-007 | PASS   | `test/process/native-abort.process.test.mjs`            | “native request signal aborts active disconnected work without misclassifying later socket close” | `process`                                                        |
| TEST-008 | PASS   | `test/process/context-logging.process.test.mjs`         | “unexpected-error child fixture emits one bounded failure record without nested canaries”         | `process`                                                        |
| TEST-009 | PASS   | `test/process/shutdown.process.test.mjs`                | “idle SIGTERM drains and exits naturally”                                                         | `process`                                                        |
| TEST-010 | PASS   | `test/process/shutdown.process.test.mjs`                | “active Task work completes before provider teardown and natural exit”                            | `process`                                                        |
| TEST-011 | PASS   | `test/process/shutdown.process.test.mjs`                | “a pre-existing keep-alive transport starts no Task work after DRAINING”                          | `process`                                                        |
| TEST-012 | PASS   | `test/process/shutdown.process.test.mjs`                | “deadline force-closes active HTTP work and exits non-zero exactly once”                          | `process`                                                        |
| TEST-013 | PASS   | `test/integration/postgresql-task.integration.test.mjs` | “real pool acquisition timeout is bounded, drains waiters, classifies narrowly, and recovers”     | `integration`                                                    |
| TEST-014 | PASS   | `test/integration/postgresql-task.integration.test.mjs` | “real PostgreSQL statement timeout classifies narrowly and leaves the shared pool healthy”        | `integration`                                                    |
| TEST-015 | PASS   | `test/e2e/task.e2e.test.mjs`                            | “real HTTP malformed, media-type, and oversized inputs fail before Task work”                     | `e2e`, `process`                                                 |
| TEST-016 | PASS   | `test/e2e/metrics.e2e.test.mjs`                         | “Prometheus metrics are complete and 100 random unmatched paths have one bounded route label”     | `e2e`                                                            |
| TEST-017 | PASS   | `test/integration/postgresql-task.integration.test.mjs` | “external migrate deploy produces the exact Task schema from an empty database”                   | `integration`                                                    |
| TEST-018 | PASS   | `docs/testing.md`, `docs/spec/v1-contract.md`           | “frozen specification file is byte-for-byte the approved Git blob”                                | `quality-and-unit`                                               |

## CI and supply chain

| ID     | Status | Implementation                                                                                                                                    | Exact evidence name                                                                 | CI job(s)                                                                                                 |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| CI-001 | PASS   | `.github/workflows/ci.yml`, `package-lock.json`                                                                                                   | “CI and dependency automation cover the complete frozen verification surface”       | `quality-and-unit`, `integration`, `e2e`, `process`, `container`                                          |
| CI-002 | PASS   | `.github/workflows/ci.yml`                                                                                                                        | “CI and dependency automation cover the complete frozen verification surface”       | `quality-and-unit`, `integration`, `e2e`, `process`, `container`                                          |
| CI-003 | PASS   | `.github/workflows/dependency-review.yml`                                                                                                         | “CI and dependency automation cover the complete frozen verification surface”       | `dependency-review`                                                                                       |
| CI-004 | PASS   | `.github/workflows/codeql.yml`                                                                                                                    | “CI and dependency automation cover the complete frozen verification surface”       | `analyze`                                                                                                 |
| CI-005 | PASS   | `.github/workflows/container-security.yml`                                                                                                        | “Trivy reports every severe finding and blocks only fixable severe findings”        | `trivy`                                                                                                   |
| CI-006 | PASS   | `.github/workflows/ci.yml`, `.github/workflows/dependency-review.yml`, `.github/workflows/codeql.yml`, `.github/workflows/container-security.yml` | “every external workflow action is SHA-pinned with a nearby release version”        | `quality-and-unit`, `integration`, `e2e`, `process`, `container`, `dependency-review`, `analyze`, `trivy` |
| CI-007 | PASS   | `.github/dependabot.yml`                                                                                                                          | “CI and dependency automation cover the complete frozen verification surface”       | Dependabot service                                                                                        |
| CI-008 | PASS   | `docs/security.md`, `.gitignore`                                                                                                                  | “repository secret controls retain placeholders while excluding local environments” | `quality-and-unit`; Manual GitHub API                                                                     |
| CI-009 | PASS   | `docs/security.md`                                                                                                                                | “CI and dependency automation cover the complete frozen verification surface”       | Manual scope audit: no published image                                                                    |
| CI-010 | PASS   | `README.md`, `CONTRIBUTING.md`, `.github/workflows/ci.yml`                                                                                        | “CI and dependency automation cover the complete frozen verification surface”       | `quality-and-unit`, `integration`, `e2e`, `process`, `container`                                          |

## Manual repository-setting evidence

GitHub secret scanning and push protection were verified enabled through the
repository API for `Sye-1321/nestjs-production-starter` on 2026-08-14. The exact
recheck command and user-interface path are recorded in `docs/security.md`.

The scope audit found no supported published runtime image. CI-009 therefore
passes by preserving the contract's optional boundary: v1 does not claim SBOM
publication, attestation, signing, or provenance for an artifact it does not
publish.
