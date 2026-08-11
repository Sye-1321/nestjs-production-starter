# NestJS Production Starter — v1.0 Implementation Specification

Repository: `nestjs-production-starter`  
Architectural refinement date: 11 August 2026  
Status: **FROZEN — approved for M0 implementation**  
Supersedes for implementation: the normative/implementation portions of the 10 August 2026 research specification. The original research document remains the rationale and landscape study.

---

## 1. Purpose

`nestjs-production-starter` is a compact executable reference for the operational contract of a single NestJS HTTP service.

It is **not** a feature-rich boilerplate. Its purpose is to prove, with automated evidence, that a small NestJS service can establish the operational guarantees that should exist before meaningful business logic is added.

The central rule is:

> **No production claim without defined failure behavior and an automated way to falsify it.**

The sophistication of this repository comes from making failure semantics explicit while keeping the application surface deliberately small.

---

## 2. Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

Every normative requirement has a stable identifier. Implementation work, tests, milestone reviews, and release review MUST refer to these identifiers.

Requirement families:

- `CFG` — configuration
- `BOOT` — bootstrap/startup
- `LIFE` — process lifecycle and shutdown
- `HTTP` — HTTP transport
- `ERR` — public error contract
- `CTX` — request context
- `LOG` — logging and redaction
- `HLTH` — liveness/readiness
- `DB` — PostgreSQL/Prisma lifecycle
- `MET` — metrics
- `SEC` — security baseline
- `CONT` — container/runtime image
- `TEST` — verification strategy
- `CI` — continuous integration and supply chain

---

## 3. Architectural thesis

The starter demonstrates these guarantees:

1. invalid required configuration prevents serving traffic;
2. required PostgreSQL initialization succeeds before the listener accepts traffic;
3. liveness and readiness have distinct semantics;
4. PostgreSQL failure after startup removes readiness without forcing a process restart;
5. PostgreSQL recovery restores readiness without restarting Nest;
6. SIGTERM/SIGINT initiates one bounded shutdown sequence;
7. after DRAINING begins, no new business/domain work is allowed to begin;
8. active requests receive bounded opportunity to complete;
9. deadline expiry escalates to forceful connection/process termination;
10. request context remains isolated under concurrency;
11. normal structured logs exclude sensitive request data by construction;
12. public errors follow a stable RFC 9457 Problem Details contract;
13. database acquisition/query execution is bounded by real driver/server mechanisms rather than abandoned JavaScript promises;
14. metrics use bounded label values;
15. the final container is non-root, reproducible, signal-correct, and contains runtime material only;
16. CI blocks correctness and supply-chain regressions that invalidate these claims.

---

## 4. Explicit v1 scope

### 4.1 Runtime and framework

- Node.js 24 LTS, **minimum 24.16.0**, maximum `<25`.
- The implementation baseline SHOULD use the current Node 24 LTS patch release at M0 and record it in the repository runtime-version files.
- NestJS 11.
- TypeScript strict mode.
- NestJS default Express adapter.
- One Node.js process per container.
- npm + committed `package-lock.json`.

The Node minimum is deliberate because `http.IncomingMessage.signal` is available from Node 24.16.0.

### 4.2 Persistence

- PostgreSQL.
- Prisma ORM 7.x.
- `@prisma/adapter-pg`.
- `pg` / node-postgres.
- M0/M3 MUST use a current stable Prisma 7 release; at the time of this refinement Prisma 7.9.1 is the current stable patch baseline. The exact resolved dependency graph is authoritative through `package-lock.json`.
- One explicitly owned application-scoped `pg.Pool`.
- The same pool is passed to `PrismaPg`.
- No second application pool is introduced for readiness.

### 4.3 Application feature

V1 contains only:

- `POST /v1/tasks`
- `GET /v1/tasks/:id`

Task representation:

```json
{
  "id": "uuid",
  "title": "normalized title",
  "createdAt": "RFC3339 timestamp"
}
```

No user, organization, assignment, workflow, authentication, authorization, update/delete API, queue, or domain expansion is permitted in v1.

---

## 5. Explicit non-goals

V1 MUST NOT include:

- authentication / JWT;
- authorization / RBAC;
- Redis;
- Kafka;
- RabbitMQ;
- BullMQ;
- CQRS;
- event sourcing;
- GraphQL;
- WebSockets;
- microservices;
- Kubernetes manifests;
- Helm;
- Terraform;
- service mesh;
- OpenTelemetry runtime integration;
- a generic outbound HTTP abstraction;
- generic retry decorators/frameworks;
- generic repositories such as `IRepository<T>` / `BaseRepository<T>`;
- generic service base classes;
- automatic application-startup migrations;
- multiple databases;
- multiple HTTP adapters;
- in-application compression;
- PM2 / Node cluster;
- a Docker `HEALTHCHECK` that collapses liveness/readiness into one state;
- Swagger/OpenAPI as a mandatory production-readiness feature;
- a generic request-timeout interceptor that returns an error without proving cancellation of underlying work.

Scope expansion requires a later requirement and, when architecturally meaningful, a later ADR.

---

## 6. Repository structure

Target structure:

```text
nestjs-production-starter/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── bootstrap/
│   │   ├── bootstrap.ts
│   │   ├── lifecycle.ts
│   │   ├── shutdown-coordinator.ts
│   │   └── http-server.ts
│   ├── config/
│   │   ├── config.module.ts
│   │   ├── env.validation.ts
│   │   └── config.types.ts
│   ├── platform/
│   │   ├── context/
│   │   ├── errors/
│   │   ├── logging/
│   │   ├── metrics/
│   │   ├── health/
│   │   └── database/
│   └── task/
│       ├── task.module.ts
│       ├── task.controller.ts
│       ├── task.service.ts
│       ├── task.repository.ts
│       └── dto/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── test/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── process/
│   ├── container/
│   └── support/
├── docs/
│   ├── research/
│   ├── spec/
│   │   └── v1-contract.md
│   ├── plans/
│   │   ├── m0-foundation.md
│   │   ├── m1-lifecycle-health.md
│   │   ├── m2-http-context-logging.md
│   │   ├── m3-postgresql-task.md
│   │   ├── m4-readiness-metrics.md
│   │   ├── m5-failure-hardening.md
│   │   ├── m6-container-supply-chain.md
│   │   └── m7-release-review.md
│   ├── architecture.md
│   ├── operations.md
│   ├── testing.md
│   ├── security.md
│   └── decisions/
│       ├── 0001-lifecycle-and-health.md
│       ├── 0002-problem-details.md
│       ├── 0003-context-and-logging.md
│       └── 0004-postgresql-and-prisma.md
├── .github/
│   ├── workflows/
│   └── dependabot.yml
├── Dockerfile
├── compose.yaml
├── .dockerignore
├── .env.example
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.build.json
└── README.md
```

`platform/` is reserved for concrete process-level capabilities shared across domain modules. A catch-all `common/`, generic `utils.ts`, or generic base hierarchy MUST NOT be introduced.

---

# Part I — Normative requirements

## 7. Configuration (`CFG`)

### CFG-001 — Parse before serving

**Required behavior:** Environment configuration MUST be parsed and validated before the application can listen for HTTP traffic.

**Failure behavior:** Invalid configuration causes deterministic startup failure and non-zero process termination.

**Forbidden behavior:** Starting the listener and validating asynchronously afterward.

**Evidence:** child-process startup tests.

**Milestone:** M1.

### CFG-002 — v1 environment surface

The v1 production environment surface is limited to:

| Variable | Requirement | Default |
|---|---|---|
| `NODE_ENV` | `development | test | production` | none |
| `PORT` | TCP port `1..65535` | implementation may provide dev default only |
| `LOG_LEVEL` | supported Pino level | `info` |
| `DATABASE_URL` | valid PostgreSQL URL | none |
| `DB_POOL_MAX` | integer `1..50` | `10` |
| `DB_ACQUIRE_TIMEOUT_MS` | integer `100..30000` | `1000` |
| `DB_STATEMENT_TIMEOUT_MS` | integer `100..60000` | `3000` |
| `SHUTDOWN_TIMEOUT_MS` | integer `1000..60000` | `10000` |

### CFG-003 — Deployment policy is not guessed

The application MUST NOT reject production configuration merely because:

- PostgreSQL resolves to localhost;
- TLS is not terminated in the application;
- a particular SSL mode is absent;
- a specific proxy topology is not configured.

Those are deployment-specific controls unless a later deployment profile requires them.

### CFG-004 — Secrets never appear in validation output

Configuration errors MUST identify the invalid field/rule without printing credentials, the complete `DATABASE_URL`, passwords, or secret environment values.

**Evidence:** canary startup tests.

### CFG-005 — Configuration remains small

Internal policy constants such as HTTP receive timeouts MUST remain code policy unless a demonstrated deployment requirement requires external configurability.

---

## 8. Bootstrap and startup (`BOOT`)

### BOOT-001 — Fail before listen

The following sequence is normative:

```text
process start
  -> validate configuration
  -> initialize bootstrap logger
  -> install application-owned signal coordination
  -> create Nest application without listening
  -> install HTTP policies
  -> initialize platform providers
  -> construct database pool + Prisma adapter/client
  -> execute real bounded PostgreSQL startup probe
  -> start HTTP listener
  -> transition BOOTING -> READY
```

The port MUST NOT accept a connection before every required pre-listen step has succeeded.

### BOOT-002 — Startup probe is real I/O

The PostgreSQL startup probe MUST execute an actual lightweight query through the explicitly owned application pool (for example `SELECT 1`). Merely constructing `PrismaClient`, constructing the adapter, or checking an internal flag is insufficient.

### BOOT-003 — Startup failure

If any required startup step fails:

- the listener MUST NOT remain open;
- resources already created MUST receive best-effort cleanup;
- one sanitized structured startup failure MUST be emitted;
- the process MUST terminate non-zero;
- startup MUST NOT retry forever inside the application.

External deployment/runtime supervision is responsible for restart/backoff policy.

### BOOT-004 — Migrations are external

Application startup MUST NOT execute production migrations.

Production schema application is a distinct deployment command using `prisma migrate deploy`.

### BOOT-005 — Termination during BOOTING

If a supported termination signal arrives while state is `BOOTING`:

- the process MUST never call `listen()` afterward;
- any created resources MUST be cleaned up within the same global shutdown bound;
- the process MUST terminate.

**Evidence:** controlled delayed-bootstrap process test.

### BOOT-006 — Fatal bootstrap exception

A top-level bootstrap rejection MUST be handled explicitly. The application MUST NOT install an `uncaughtException` handler whose purpose is to log and continue serving.

---

## 9. Lifecycle and shutdown (`LIFE`)

### LIFE-001 — State machine

The process lifecycle state is:

```text
BOOTING -> READY -> DRAINING -> STOPPED
   |                    ^
   +-> FAILED_START     |
   +--------------------+  supported signal during BOOTING enters shutdown path
```

`FAILED_START` is terminal from the service-availability perspective; cleanup may still run before process termination.

### LIFE-002 — Exclusive signal ownership

The application-owned `ShutdownCoordinator` MUST be the only component that owns `SIGTERM` and `SIGINT` shutdown sequencing.

`app.enableShutdownHooks()` MUST NOT be called in v1.

Nest provider lifecycle cleanup is triggered by explicit `app.close()` after request draining.

### LIFE-003 — First termination signal

On the first supported termination signal:

1. establish a single absolute shutdown deadline from `SHUTDOWN_TIMEOUT_MS`;
2. transition to `DRAINING` synchronously;
3. make readiness false immediately;
4. enable the draining request gate;
5. call Node's HTTP `server.close()`;
6. allow already-running requests to complete while the deadline remains;
7. after HTTP drain, call `app.close()` while the same deadline remains;
8. transition to `STOPPED` after cleanup succeeds.

The deadline MUST NOT be restarted between phases.

### LIFE-004 — Meaning of "no new work"

After lifecycle state becomes `DRAINING`, **no new business/domain work may begin**.

A request that reaches the Nest/Express application after the transition MUST be rejected before controller/service/repository/database work.

Operational probe behavior is treated separately:

- `/health/ready` MUST report not-ready if it reaches the application;
- `/health/live` MAY continue to report live while the process is still capable of answering it;
- no guarantee is made that a new probe can establish a new TCP connection after `server.close()`.

### LIFE-005 — Transport semantics during drain

`server.close()` is the normal transport drain primitive.

For Node >=19, `server.close()` already closes idle keep-alive HTTP connections; v1 therefore MUST NOT depend on `closeIdleConnections()` for correctness.

The starter MUST NOT claim that every racing request receives a structured 503. A request racing with transport closure may observe connection termination before the application sees it.

The actual guaranteed property is: **if a post-DRAINING business request reaches the application, it does not enter business/domain work.**

### LIFE-006 — Active requests

Requests that began business/domain work before the transition to `DRAINING` MAY complete while the global shutdown deadline remains.

Requests that are still only in transport/header/body parsing when `DRAINING` begins have not begun domain work. Their normal `headersTimeout`/`requestTimeout` limits do not extend the shutdown deadline; they MAY be terminated by transport closure or the force path when that global deadline expires.

The dependency tree, including the database pool, MUST remain available until the normal HTTP-drain phase has completed.

### LIFE-007 — Force path

If the global deadline expires before all shutdown work completes:

- `server.closeAllConnections()` MUST be invoked as the HTTP escalation path;
- a distinct structured `forced_shutdown` event MUST be emitted using a synchronous/best-effort fatal logging path suitable for imminent process termination;
- the process MUST terminate non-zero using a forceful termination mechanism;
- no claim is made that asynchronous cleanup still completes after this point.

Calling `closeAllConnections()` before deadline expiry is forbidden in the normal path.

### LIFE-008 — Normal exit

After successful drain and `app.close()`:

- no unconditional `process.exit(0)` is used;
- the process SHOULD exit naturally once owned handles are closed;
- `process.exitCode` MAY be set explicitly if necessary.

### LIFE-009 — Repeated termination signals

Additional SIGTERM/SIGINT signals received after `DRAINING` begins MUST NOT restart, extend, or duplicate the shutdown sequence. The original global deadline remains authoritative.

A special "second signal means immediate force" feature is outside v1.

### LIFE-010 — Linux/container authority

The normative SIGTERM acceptance behavior is validated on Linux and on the final Linux container image. Local Windows behavior is not used as the authority for container signal semantics.

---

## 10. HTTP transport (`HTTP`)

### HTTP-001 — Adapter

Use NestJS's Express adapter. Fastify is outside v1 because no measured requirement justifies changing the default adapter.

### HTTP-002 — Fixed Node HTTP receive policy

The raw Node HTTP server MUST be configured explicitly before traffic is accepted with fixed code-policy defaults:

| Setting | v1 default | Meaning |
|---|---:|---|
| `headersTimeout` | `15000 ms` | maximum time to receive complete headers |
| `requestTimeout` | `30000 ms` | maximum time to receive the complete request from the client |
| `keepAliveTimeout` | `5000 ms` | idle interval after a response before retiring the socket |
| `keepAliveTimeoutBuffer` | `1000 ms` | Node 24 buffer used to reduce keep-alive reset races |
| `server.timeout` | `0` | no generic socket inactivity timeout for application execution |

These are starter defaults, not universal deployment recommendations.

`headersTimeout` and `requestTimeout` are the v1 receive-side Slowloris/resource-exhaustion controls and MUST remain non-zero. `server.timeout` intentionally remains `0`: it is a generic inactivity timer and MUST NOT be presented as a safe application-operation deadline, because expiring a socket does not prove that underlying business/database work was cancelled.

The specification MUST describe `requestTimeout` and `headersTimeout` as **request-receive/parser limits**, not handler/business-operation cancellation.

### HTTP-003 — Body size

JSON request bodies MUST be bounded to **100 KiB**.

A body that exceeds the configured limit MUST fail with stable `413` behavior and MUST NOT reach Task domain logic.

The starter does not claim constant memory for arbitrarily large upload attacks; it claims that the configured parser bound prevents the domain handler from accepting oversized input.

### HTTP-004 — Content type

`POST /v1/tasks` MUST require `application/json`; standard media-type parameters such as a charset MAY be present. Vendor `+json` media types are outside v1 unless explicitly added later.

Missing or unsupported content type MUST produce `415 Unsupported Media Type` before Task domain logic.

### HTTP-005 — Malformed JSON

Malformed JSON MUST produce stable `400` Problem Details and MUST NOT reach the Task controller/service.

### HTTP-006 — DTO strictness

Global validation MUST:

- whitelist documented fields;
- reject unknown properties;
- use explicit constraints;
- avoid broad implicit transformation magic.

### HTTP-007 — Task title

`title` MUST be a string.

Normalization is explicitly `trim()`.

After normalization, length MUST be `1..200` characters.

The persisted and returned value is the normalized title.

### HTTP-008 — Task identifier

`GET /v1/tasks/:id` requires a UUID-shaped identifier and invalid identifiers fail as a client error without repository execution.

### HTTP-009 — Security headers

Helmet is enabled.

### HTTP-010 — CORS

CORS is disabled by default. It is added only if a browser-client architecture creates a concrete cross-origin requirement.

### HTTP-011 — Proxy trust

Express `trust proxy` is disabled by default. Enabling it requires an explicit deployment-topology decision.

### HTTP-012 — Draining gate

An early transport/platform gate MUST reject business requests that reach the application after lifecycle state is `DRAINING`.

Preferred behavior when the request reaches the application:

- `503 Service Unavailable`;
- `Connection: close`;
- no controller/service/repository execution.

Transport closure before that response is possible and is not treated as a violation.

### HTTP-013 — No generic application timeout illusion

V1 MUST NOT install a global RxJS/Nest timeout interceptor that returns 504 while underlying mutation/database work may continue uncontrolled.

---

## 11. Public error contract (`ERR`)

### ERR-001 — Standard

Business API failures use RFC 9457 Problem Details with content type:

```text
application/problem+json
```

### ERR-002 — Stable type identifiers

V1 uses stable URN problem types so no hosted documentation service is required:

```text
urn:nestjs-production-starter:problem:validation
urn:nestjs-production-starter:problem:malformed-json
urn:nestjs-production-starter:problem:payload-too-large
urn:nestjs-production-starter:problem:unsupported-media-type
urn:nestjs-production-starter:problem:not-found
urn:nestjs-production-starter:problem:dependency-unavailable
urn:nestjs-production-starter:problem:internal-error
```

`type` MUST identify a category and MUST NOT contain a request/task identifier.

### ERR-003 — Shape

Conceptual v1 shape:

```json
{
  "type": "urn:nestjs-production-starter:problem:validation",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request contains invalid fields.",
  "code": "VALIDATION_ERROR",
  "requestId": "...",
  "errors": [
    { "path": "title", "message": "must not be empty" }
  ]
}
```

`code`, `requestId`, and validation `errors` are RFC 9457 extension members.

`instance` is optional in v1 and MUST NOT be fabricated merely to carry the request ID.

### ERR-004 — Mapping

| Failure | HTTP |
|---|---:|
| malformed JSON | 400 |
| DTO validation | 400 |
| invalid UUID | 400 |
| Task not found | 404 |
| oversized body | 413 |
| unsupported/missing required media type | 415 |
| known required-DB unavailable/acquisition/statement-timeout condition | 503 |
| unexpected application/infrastructure failure | 500 |

No 409 is required unless a real domain conflict is introduced.

### ERR-005 — Sanitization

5xx responses MUST NOT expose:

- stack traces;
- Prisma internals;
- `pg` internals;
- SQL text;
- database hostname/credentials;
- filesystem paths;
- environment values;
- package-internal names;
- arbitrary upstream/raw error bodies.

### ERR-006 — Boundary ownership

Domain/application code SHOULD use typed application errors where needed and MUST NOT scatter transport-specific Nest `HttpException` classes through business logic.

The HTTP boundary owns mapping into Problem Details.

### ERR-007 — Unexpected error logging

The boundary that converts an unexpected exception into a 500 owns the detailed internal error log. The same exception MUST NOT be independently logged with stack/context by multiple layers.

### ERR-008 — Operational endpoints

`/health/live`, `/health/ready`, and `/metrics` are operational endpoints and do not need Problem Details payloads for routine health/metrics protocol behavior.

---

## 12. Request context (`CTX`)

### CTX-001 — Mechanism

Use Node `AsyncLocalStorage`.

Context is deliberately limited to:

```text
requestId
abortSignal
```

### CTX-002 — Native abort signal

For Node >=24.16.0, the request context MUST use the native `http.IncomingMessage.signal` exposed by Node.

The starter MUST NOT create a second socket-scoped AbortController merely to reproduce behavior already provided by the supported runtime.

### CTX-003 — Cancellation claim boundary

`abortSignal` is a cooperative cancellation signal for downstream work that explicitly supports it.

The starter MUST NOT claim that the presence/abortion of this signal automatically cancels an already-dispatched Prisma/PostgreSQL query.

### CTX-004 — Request ID input

Header: `x-request-id`.

An upstream request ID is accepted only if:

- exactly one header field value was supplied;
- length is `1..64` characters;
- all characters belong to the conservative ASCII allowlist `[A-Za-z0-9._:-]`.

Otherwise a cryptographically generated UUID is used.

### CTX-005 — Duplicate request IDs

Duplicate `x-request-id` field lines MUST NOT be silently trusted after Node's normal header joining.

Implementation MUST inspect a duplicate-preserving representation such as `headersDistinct` or `rawHeaders` and replace the upstream value unless exactly one field value exists. **Two or more field lines are treated as duplicate input even when every supplied value is textually identical.** V1 deliberately chooses deterministic replacement over proxy-specific deduplication heuristics.

### CTX-006 — Correlation is not identity

Accepted request IDs are untrusted correlation hints. They MUST NOT be used as authorization, authentication, idempotency, or tenant identifiers.

### CTX-007 — Response propagation

Normal application HTTP responses MUST include the chosen `x-request-id`.

### CTX-008 — Isolation

At least 100 concurrent requests with distinct IDs MUST be deliberately interleaved across timers/promises/service work and database activity.

No response/log context may contain another request's ID.

---

## 13. Logging and redaction (`LOG`)

### LOG-001 — Logger

Use Pino directly as the structured application logger.

Production logs are JSON to stdout/stderr.

No production pretty formatter or vendor transport is part of v1.

### LOG-002 — Request completion allowlist

Normal request-completion events may contain only bounded operational fields such as:

```text
service
event
request_id
method
route
status_code
duration_ms
```

### LOG-003 — Route label/value

Matched requests use a route template such as `/v1/tasks/:id`, not the raw URL.

Unmatched requests MUST use a bounded constant such as `UNMATCHED`.

Raw URLs/query strings MUST NOT become normal log fields.

### LOG-004 — Do not collect sensitive objects

Normal request logging MUST NOT collect:

- request body;
- response body;
- complete request headers;
- complete response headers;
- Authorization;
- Cookie;
- Set-Cookie;
- passwords;
- access/refresh tokens;
- API keys;
- database URLs;
- secret environment variables;
- raw query strings.

Pino redaction is a secondary defense; not collecting these objects is the primary defense.

### LOG-005 — Error logging

Unexpected internal errors may include internally:

- error class/type;
- safe error message;
- stack;
- request ID;
- bounded diagnostic context.

Unknown arbitrary objects SHOULD NOT be serialized wholesale.

### LOG-006 — Probe noise

Successful routine `/health/live`, `/health/ready`, and `/metrics` accesses MUST NOT dominate INFO logs. They MAY be suppressed or logged at DEBUG. Failures remain visible.

### LOG-007 — Canary proof

Tests inject recognizable secrets into:

- Authorization;
- Cookie;
- DTO fields;
- configuration/DB URL;
- nested error metadata.

Captured process logs MUST NOT contain those canaries through supported logging paths.

### LOG-008 — Force-exit event

The forced-shutdown path MUST produce a distinct machine-readable event before forceful process exit. Because forceful `process.exit()` can truncate asynchronous stdout/stderr, this fatal-path emission MUST use a synchronous or otherwise explicitly flushable strategy rather than relying on normal asynchronous request logging.

---

## 14. Health and readiness (`HLTH`)

### HLTH-001 — Liveness

`GET /health/live`

Meaning: the currently running process can execute the liveness handler.

It MUST NOT query PostgreSQL.

PostgreSQL outage MUST NOT independently make liveness fail.

### HLTH-002 — Readiness

`GET /health/ready`

Returns 200 only when:

1. lifecycle state is `READY`; and
2. a real lightweight PostgreSQL probe through the shared application pool succeeds.

Otherwise it returns 503.

### HLTH-003 — DRAINING

`DRAINING` is never ready.

If a readiness request reaches the application after the state transition, it MUST return 503 without requiring a successful DB query.

### HLTH-004 — PostgreSQL outage

After successful startup:

```text
PostgreSQL fails
  -> process stays alive
  -> live remains conceptually healthy
  -> ready becomes 503
  -> DB-backed Task requests fail through stable DB-unavailable semantics
```

### HLTH-005 — Recovery

When PostgreSQL becomes available again, a subsequent readiness probe MUST return 200 without restarting the Nest process.

A real Task request MUST also succeed after recovery.

### HLTH-006 — Readiness query

The readiness probe uses a real lightweight query through the **same explicitly owned `pg.Pool`** used by Prisma.

No separate readiness pool is introduced.

No `Promise.race()` wrapper may be used merely to abandon the wait while leaving a queued acquisition/query behind.

### HLTH-007 — Readiness database wait model

Readiness has no independent `READINESS_DB_TIMEOUT_MS` in v1.

Pool acquisition/connection waiting is bounded by `DB_ACQUIRE_TIMEOUT_MS`; server-side PostgreSQL statement execution is bounded by `DB_STATEMENT_TIMEOUT_MS`. V1 MUST NOT add a JavaScript `Promise.race()` or pg `query_timeout` merely to return early while underlying database work may still exist.

A silent network partition that occurs **after** a statement has been dispatched can outlive the PostgreSQL `statement_timeout` from the application's point of view if the timeout/error response itself cannot traverse the broken transport. V1 therefore does **not** claim a strict application-layer deadline for every possible half-open TCP/network failure. Ordinary outage/recovery remains tested, while this residual transport limitation is documented rather than hidden behind a false timeout guarantee.

### HLTH-008 — No startup endpoint

No `/health/startup` endpoint exists in v1 because the application does not listen before required initialization succeeds.

---

## 15. Database and Prisma (`DB`)

### DB-001 — One explicit pool

The application constructs exactly one application-scoped `pg.Pool` using `DATABASE_URL` plus explicit bounded options.

That pool is passed to `PrismaPg` and therefore shared by Prisma and infrastructure probes.

### DB-002 — Pool configuration

The pool MUST explicitly set at least:

```text
max                     <- DB_POOL_MAX
connectionTimeoutMillis <- DB_ACQUIRE_TIMEOUT_MS
statement_timeout       <- DB_STATEMENT_TIMEOUT_MS
application_name        <- stable service name
```

The implementation MUST NOT rely on `pg`'s default `connectionTimeoutMillis = 0`.

V1 MUST NOT configure pg `query_timeout`. It is a client-side read timer, not a PostgreSQL execution-cancellation primitive. The starter uses server-side `statement_timeout` for bounded statement execution and refuses to claim that returning early from a client-side timer has cancelled database work.

### DB-003 — Acquisition behavior

The implementation treats `connectionTimeoutMillis` as the configured bound for pool acquisition/connection waiting and MUST prove pool-exhaustion behavior using a real `pg.Pool` test.

A pool-exhaustion test MUST demonstrate that a queued acquisition fails within bounded tolerance rather than waiting indefinitely.

### DB-004 — Database wait bounds

Database waits MUST use mechanisms that bound the underlying operation being claimed, not merely the caller's await.

V1 uses:

- `connectionTimeoutMillis` for pool acquisition/new-connection waiting;
- PostgreSQL `statement_timeout` for server-side statement execution.

V1 MUST NOT use a generic JavaScript `Promise.race()` or pg `query_timeout` as evidence that an already-dispatched PostgreSQL statement has been cancelled.

The test suite MUST separately exercise acquisition timeout and PostgreSQL statement timeout, and MUST verify that the shared pool remains usable immediately after a statement timeout. Network-disruption tests MAY characterize transport behavior, but the repository MUST document residual half-open-network limitations rather than claim a deadline the selected stack cannot prove.

### DB-005 — Adapter/client construction

The same externally created pool is provided to `PrismaPg`, and the resulting adapter is provided to one long-lived `PrismaClient`.

No PrismaClient-per-request pattern is permitted.

### DB-006 — Pool error handling

Idle pool/client background errors MUST have an attached error handler so a PostgreSQL outage/network partition does not cause an unhandled EventEmitter `error` solely because an idle client failed.

The error is logged in bounded sanitized form.

### DB-007 — Startup connectivity

Before HTTP listen, the service MUST perform a real query against PostgreSQL using the owned pool.

### DB-008 — Shutdown ownership

The application owns the external `pg.Pool` lifecycle.

The platform database provider owns the external pool and the Prisma client as one lifecycle unit. It MUST participate in Nest shutdown so that `app.close()` attempts, exactly once, this database cleanup sequence:

1. `await prisma.$disconnect()` so Prisma/adapter state is disposed;
2. `await pool.end()` so the externally owned `pg.Pool` is drained and closed.

The provider MUST attempt `pool.end()` even if `prisma.$disconnect()` rejects (for example with `try/finally` semantics), while preserving/logging the cleanup failure without leaking sensitive details.

`pool.end()` is a graceful pool drain: it can wait for checked-out clients/active database work. It is **not** an aggressive query-cancellation primitive. The single global shutdown deadline in `LIFE-003` remains authoritative across this wait; deadline expiry escalates through `LIFE-007`.

Because the pool is externally supplied to `PrismaPg`, v1 MUST use external-pool disposal semantics consistently (the adapter must not independently end the pool and then have the provider end it again). `disposeExternalPool` therefore remains false/default under explicit provider ownership.

Implementation MUST prove that the pool is ended exactly once and that no pool handle keeps the successful process alive after `app.close()` resolves.

### DB-009 — Migrations

Migrations are version-controlled and production application is performed by:

```text
prisma migrate deploy
```

The runtime service does not auto-migrate.

A separate migration URL is OPTIONAL and only required if the deployment uses an external transaction pooler/topology that requires a direct migration connection. V1 does not invent a `DIRECT_URL` requirement without such a topology.

### DB-010 — Repository design

Use one concrete `TaskRepository` with explicit methods.

Do not create generic repository interfaces/base classes.

### DB-011 — Transaction restraint

`POST /v1/tasks` is one atomic insert and MUST NOT create a multi-statement transaction merely to demonstrate transactions.

Interactive transaction machinery is outside the v1 Task requirement.

### DB-012 — DB failure classification

Known transient required-database conditions such as pool acquisition timeout, connectivity loss, and PostgreSQL statement timeout are mapped to a sanitized dependency-unavailable application error and then HTTP 503.

The classifier MUST be narrow and evidence-based: every driver/Prisma error shape treated as dependency-unavailable MUST be observed/verified against the pinned implementation and covered by an integration test. The implementation MUST NOT map arbitrary Prisma/pg errors to 503 merely by matching dynamic error-message text.

Unexpected Prisma/driver/programming/data-shape failures are sanitized as HTTP 500 unless a specific documented mapping exists. No underlying driver message, SQL, host, stack, or Prisma/pg internal is copied into the public Problem Details payload.

---

## 16. Metrics (`MET`)

### MET-001 — Library and endpoint

Use `prom-client` directly.

Expose:

```text
GET /metrics
```

No separate admin HTTP server is introduced in v1.

### MET-002 — Baseline metrics

At minimum:

- `http_server_requests_total`;
- `http_server_request_duration_seconds`;
- `tasks_created_total`;
- `service_dependency_ready`;
- selected standard Node/process metrics.

### MET-003 — Allowed HTTP labels

Allowed HTTP metric labels are bounded values such as:

- method;
- route template / bounded unmatched marker;
- status code or bounded status class.

### MET-004 — Forbidden labels

Metrics MUST NOT use:

- request ID;
- Task ID;
- raw URL;
- query string;
- email/user identifier;
- arbitrary error message;
- User-Agent;
- other attacker-controlled unbounded identifiers.

### MET-005 — Unmatched routes

All unmatched/random 404 paths MUST map to one bounded route label such as `UNMATCHED`.

A cardinality test MUST send many distinct random paths and prove that they do not create one series per path.

### MET-006 — Pull-model independence

The application has no outbound metrics-backend dependency. Prometheus/backend failure therefore MUST NOT affect readiness.

---

## 17. Security baseline (`SEC`)

### SEC-001 — Core controls

V1 security controls include:

- Helmet;
- strict DTO validation;
- unknown-field rejection;
- 100 KiB JSON body bound;
- explicit HTTP receive timeouts;
- CORS disabled by default;
- proxy trust disabled by default;
- no stack traces/internal DB information in clients;
- no raw body/header logging;
- redaction/canary tests;
- PostgreSQL least-privilege operational guidance;
- ignored local `.env` files;
- no secrets copied into the image;
- non-root runtime;
- committed lockfile;
- dependency review;
- CodeQL;
- image vulnerability scanning;
- secret scanning/push protection where available;
- SHA-pinned third-party GitHub Actions;
- automated dependency updates.

### SEC-002 — Authentication is not a baseline control here

Authentication/JWT is deliberately absent because the sample Task API has no principal/authorization requirement. The repository MUST NOT imply that adding JWT mechanically makes the starter more production-ready.

### SEC-003 — Secret injection

Production secrets are supplied by the deployment environment. The repository contains placeholders only.

### SEC-004 — HTTP parser

The insecure Node HTTP parser MUST NOT be enabled.

---

## 18. Container (`CONT`)

### CONT-001 — Base image

Use Node 24 Debian slim, with:

- explicit Node patch tag;
- immutable digest pin;
- no `latest` tag.

M6 records the then-current approved Node 24 patch/digest.

### CONT-002 — Multi-stage build

Build and runtime stages are separate.

Final runtime image excludes:

- TypeScript compiler;
- Nest CLI;
- Jest/test dependencies;
- lint/format tooling;
- test source;
- Git metadata;
- local `.env` files;
- other build-only material.

Source maps are absent unless a later ADR approves a secure release/debugging policy.

### CONT-003 — Non-root

The final application process MUST run as a non-root UID.

### CONT-004 — PID 1 / init

The final image includes a minimal init strategy such as `dumb-init`, and Node is launched using exec-form process invocation so termination signals reach the application predictably.

### CONT-005 — Container signal behavior

The final built image MUST pass a real SIGTERM process test that exercises the same drain protocol as the host-process tests. The evidence MUST prove that SIGTERM reaches the Node application and causes its observable `READY -> DRAINING` lifecycle transition/in-flight drain behavior; merely observing that the outer container eventually exits is insufficient.

### CONT-006 — Docker healthcheck

No Docker `HEALTHCHECK` is embedded because a single Docker health state cannot faithfully represent the project's distinct liveness/readiness semantics.

Deployment documentation explains how an orchestrator should target `/health/live` and `/health/ready` separately.

---

## 19. Verification strategy (`TEST`)

### TEST-001 — Evidence hierarchy

Tests are selected by the layer capable of falsifying the claim:

| Layer | Purpose |
|---|---|
| Unit | pure policy/state/mapping |
| Integration | real PostgreSQL/Prisma/pg behavior |
| E2E | HTTP contract with real PostgreSQL |
| Process | child-process/listener/signal lifecycle |
| Container | final built artifact behavior |

A lower-level test MUST NOT be used as the sole evidence for a property that depends on OS/socket/container behavior.

### TEST-002 — Real PostgreSQL

Integration and e2e tests use PostgreSQL through Testcontainers.

No SQLite substitute and no in-memory repository may be used as evidence for PostgreSQL semantics.

### TEST-003 — Configuration/startup

Tests MUST prove:

- missing/invalid required config exits non-zero;
- HTTP port never becomes available on invalid config;
- PostgreSQL unavailable at startup prevents listen;
- startup failure logs do not leak `DATABASE_URL` credentials;
- supported signal during delayed BOOTING prevents subsequent listen.

### TEST-004 — Health failure/recovery

Process/e2e sequence:

1. boot healthy;
2. live=200, ready=200;
3. stop PostgreSQL;
4. prove process remains alive;
5. prove live does not depend on DB;
6. prove ready=503;
7. restart the same PostgreSQL dependency;
8. prove ready returns 200 without app restart;
9. prove a Task operation succeeds after recovery.

### TEST-005 — Request context concurrency

At least 100 distinct accepted request IDs are sent concurrently.

Test-only controlled asynchronous interleaving MUST include timers/promises and database activity, including at least one deliberately rejected asynchronous branch so isolation is exercised across both success and failure paths.

Assertions:

- response ID never crosses requests;
- captured log context never crosses requests;
- a rejected/failed request does not leak its context into another request;
- no previous request context is observable from a subsequent request.

### TEST-006 — Duplicate request ID

A raw HTTP test sends duplicate `x-request-id` field lines and proves the untrusted duplicates are not propagated as an accepted ID.

### TEST-007 — Native request abort signal

Tests MUST demonstrate at least:

- a client sends a complete request then disconnects before response completion and the request-scoped native signal becomes aborted while work is active;
- a normal completed request is not treated as an application failure merely because its keep-alive socket later closes;
- the test does not claim Prisma query cancellation.

### TEST-008 — Log canaries

Captured full process logs are searched for injected canaries in headers, body fields, DB credentials, and nested error metadata.

Unauthorized appearance fails the suite.

### TEST-009 — Shutdown: idle

Process test:

- send SIGTERM;
- state becomes DRAINING;
- readiness is false if observable on an existing connection;
- listener stops accepting new TCP connections;
- providers/database clean up;
- process exits cleanly within `SHUTDOWN_TIMEOUT_MS + tolerance`.

### TEST-010 — Shutdown: active request

A test-only controllable work gate holds Request A in business work.

Sequence:

1. Request A begins;
2. send SIGTERM;
3. prove no new TCP connection can be established after listener closure;
4. release Request A before deadline;
5. Request A completes successfully;
6. only then does provider teardown occur;
7. process exits cleanly.

### TEST-011 — Shutdown: reused keep-alive connection

This test is mandatory because "new connection" and "new HTTP request" are different properties.

Use a deliberately persistent HTTP/1.1 connection established before SIGTERM.

After DRAINING begins, attempt another business request using that pre-existing transport.

Valid transport observations are:

- application receives the request and returns **RFC 9457 `503` Problem Details plus `Connection: close`** before controller/service/repository work; **or**
- Node closes/resets the transport before the application receives the request.

The invariant assertion is:

> **No post-DRAINING request begins Task/service/repository/database work.**

The test MUST instrument a test-only business-entry counter/gate to prove this invariant rather than relying only on the client's status code.

### TEST-012 — Shutdown: forced deadline

Hold active work/provider cleanup beyond the global deadline.

Assert:

- force path executes;
- remaining HTTP connections are force-closed;
- distinct `forced_shutdown` structured event is emitted;
- process terminates non-zero within tolerance;
- the test does not wait forever for unresolved cleanup.

### TEST-013 — DB pool exhaustion

With a deliberately small pool:

- occupy all pool clients;
- request another acquisition/query;
- prove the wait fails within `DB_ACQUIRE_TIMEOUT_MS + tolerance` rather than hanging indefinitely;
- prove the failure is produced by the configured pg acquisition mechanism, not an application `Promise.race()`;
- after timed-out attempts settle, assert the owned pool's `waitingCount` returns to `0`;
- prove repeated timed-out attempts do not create an ever-growing queued-wait condition after the test workload stops.

### TEST-014 — DB statement timeout and post-timeout pool health

Using real PostgreSQL:

1. induce a statement that exceeds `DB_STATEMENT_TIMEOUT_MS`;
2. prove PostgreSQL/pg/Prisma surfaces the server-side timeout within bounded tolerance;
3. immediately execute a lightweight query such as `SELECT 1` through the **same shared pool**;
4. prove the pool remains usable and no stale timed-out work corrupts the next query.

V1 MUST NOT satisfy this test with pg `query_timeout` or an application `Promise.race()`. A separate network-disruption characterization test MAY be retained, but it MUST NOT be used to claim a strict half-open-network deadline unless the underlying operation is actually terminated.

### TEST-015 — HTTP boundary

E2E tests include:

- POST Task 201;
- GET Task 200;
- missing Task 404;
- invalid UUID 400;
- unknown DTO property 400;
- title empty after trim 400;
- malformed JSON 400;
- unsupported/missing content type 415;
- body >100 KiB 413;
- unexpected internal exception sanitized 500;
- DB unavailable mapped to stable 503.

### TEST-016 — Metrics cardinality

Send at least 100 distinct random unmatched URLs and prove metrics expose only one bounded unmatched route label rather than one time series per raw URL.

### TEST-017 — Migration

From an empty PostgreSQL Testcontainer, migrations MUST apply cleanly and the Task integration tests MUST pass afterward.

### TEST-018 — Coverage

Coverage is hygiene, not the evidence model.

Suggested floor:

- lines: 80%;
- branches: 75%.

No requirement may be weakened or replaced by mock-heavy tests merely to increase coverage.

---

## 20. CI and supply chain (`CI`)

### CI-001 — Reproducible install

CI uses `npm ci` with the committed lockfile.

### CI-002 — Required verification

Required pull-request verification includes:

```text
format check
lint (check only)
typecheck
build
unit tests
integration tests
e2e tests
process tests
container build/verification where applicable
```

Jobs MAY run in parallel where dependency ordering permits.

### CI-003 — Dependency review

Dependency-changing pull requests are subject to GitHub dependency review where supported.

### CI-004 — CodeQL

GitHub CodeQL analyzes JavaScript/TypeScript.

### CI-005 — Container vulnerability gate

The final runtime image is scanned with Trivy.

Merge policy:

- fixable HIGH/CRITICAL runtime findings block;
- unfixed HIGH/CRITICAL findings are reported;
- explicit exceptions require documented rationale plus review/expiry date;
- policy MUST NOT globally suppress a vulnerability class just to obtain green CI.

An implementation MAY use Trivy's `--ignore-unfixed` behavior as part of expressing the "fixable findings block" rule, but the workflow documentation must make the semantics explicit.

### CI-006 — Action pinning

Every third-party GitHub Action reference is pinned to a full commit SHA, with the human-readable release/version recorded in a nearby comment.

### CI-007 — Dependabot

`.github/dependabot.yml` covers:

- npm;
- Docker;
- GitHub Actions.

Updates SHOULD be grouped sensibly to avoid unmaintainable PR noise.

### CI-008 — Secret scanning

GitHub secret scanning and push protection are enabled where the repository/account plan supports them. Repository settings verification is documented because this is not purely a code-level test.

### CI-009 — Published-image provenance

SBOM, artifact attestation, signing, and build provenance remain OPTIONAL while v1 does not publish a supported runtime image artifact.

If a signed/versioned GHCR image becomes an official release artifact, these controls move to release requirements through a later specification update.

### CI-010 — CI command parity

Commands documented for local verification MUST match the commands used in CI.

---

# Part II — Exact v1 runtime behavior

## 21. Startup lifecycle

```text
start
  |
  +-- validate env -------------------------- failure -> cleanup -> nonzero exit
  |
  +-- bootstrap logger
  |
  +-- signal coordinator
  |
  +-- NestFactory.create(...), no listen
  |
  +-- install validation/error/context/log/HTTP policies
  |
  +-- construct pg.Pool
  |
  +-- construct PrismaPg(pool) + PrismaClient
  |
  +-- PostgreSQL SELECT 1 ------------------- failure -> cleanup -> nonzero exit
  |
  +-- configure raw Node HTTP server policy
  |
  +-- listen(PORT)
  |
  `-- lifecycle READY
```

No retry loop is inserted between PostgreSQL failure and process exit.

---

## 22. Normal request lifecycle

```text
HTTP request accepted
  -> request-ID parse/validate/generate
  -> AsyncLocalStorage { requestId, req.signal }
  -> lifecycle/draining gate
  -> safe request metadata
  -> media type / body bound / JSON parsing
  -> DTO validation
  -> controller
  -> service
  -> concrete repository
  -> Prisma -> shared pg.Pool -> PostgreSQL
  -> response or RFC 9457 Problem Details
  -> low-cardinality HTTP metrics
  -> one safe completion log
```

A transport-layer request may be rejected before some later stages. The exact stage must be reflected by the test responsible for that guarantee.

---

## 23. Graceful shutdown lifecycle

```text
SIGTERM / SIGINT
  |
  +-- establish absolute global deadline
  +-- READY/BOOTING -> DRAINING
  +-- readiness false
  +-- business request gate active
  +-- server.close()
  |
  +-- wait for already-running HTTP work while deadline remains
  |
  +-- if drained:
  |      app.close()
  |        -> provider cleanup
  |        -> Prisma disconnect
  |        -> external pg.Pool end exactly once
  |      STOPPED
  |      natural process exit
  |
  `-- if global deadline expires at any phase:
         server.closeAllConnections()
         synchronous/best-effort forced_shutdown event
         forceful nonzero process exit
```

The global deadline covers **both** HTTP draining and provider/database cleanup. A provider hook cannot hang forever and still satisfy the bounded-shutdown contract.

---

## 24. HTTP/keep-alive shutdown interpretation

The starter intentionally distinguishes:

```text
A. new TCP connection after server.close()
B. new HTTP request sent over a TCP connection that existed before DRAINING
```

`server.close()` establishes A.

An early lifecycle gate establishes the application-level invariant for B when such a request is delivered to the application.

Because Node may retire/reset the transport during keep-alive shutdown races, v1 does not promise that every B request receives a 503 response. It promises that B cannot start new business/domain work after DRAINING.

This is the shutdown property the process suite must falsify.

---

## 25. Health state table

| Process/DB condition | Listener | `/health/live` if reachable | `/health/ready` if reachable | Task traffic |
|---|---|---:|---:|---|
| BOOTING | not listening | unavailable | unavailable | unavailable |
| READY + DB healthy | listening | 200 | 200 | normal |
| READY + DB unavailable | listening | 200 | 503 | stable DB-unavailable failure |
| READY + DB recovered | listening | 200 | 200 | normal again |
| DRAINING | closing/closed | may be reachable only on pre-existing transport | 503 | no new domain work |
| STOPPED | closed | unavailable | unavailable | unavailable |

---

## 26. Database timeout model

The repository uses controls that bound the underlying operation being claimed rather than one fake universal request timeout.

```text
pool acquisition / connection waiting
  -> pg connectionTimeoutMillis

server-side statement execution
  -> PostgreSQL statement_timeout via pg client configuration
```

Pg `query_timeout` is deliberately excluded from v1 because its client-side timer is not accepted as evidence that server-side statement work was cancelled. Readiness likewise does not add an independent JavaScript timer around database work.

The implementation must prove the actual combined behavior under:

- saturated pool;
- slow PostgreSQL statement;
- PostgreSQL outage;
- PostgreSQL recovery;
- post-statement-timeout reuse of the shared pool.

A silent half-open network failure after query dispatch remains an explicit residual transport limitation unless implementation evidence demonstrates a safe terminating mechanism.

If an observed driver limitation prevents a claimed bound, the claim is narrowed; policy is never weakened by hiding a detached operation behind `Promise.race()`.

---

## 27. Problem Details catalogue

| Code | Type URN | HTTP | Default title |
|---|---|---:|---|
| `VALIDATION_ERROR` | `urn:nestjs-production-starter:problem:validation` | 400 | Validation failed |
| `MALFORMED_JSON` | `urn:nestjs-production-starter:problem:malformed-json` | 400 | Malformed JSON |
| `TASK_NOT_FOUND` | `urn:nestjs-production-starter:problem:not-found` | 404 | Resource not found |
| `PAYLOAD_TOO_LARGE` | `urn:nestjs-production-starter:problem:payload-too-large` | 413 | Payload too large |
| `UNSUPPORTED_MEDIA_TYPE` | `urn:nestjs-production-starter:problem:unsupported-media-type` | 415 | Unsupported media type |
| `DEPENDENCY_UNAVAILABLE` | `urn:nestjs-production-starter:problem:dependency-unavailable` | 503 | Service temporarily unavailable |
| `INTERNAL_ERROR` | `urn:nestjs-production-starter:problem:internal-error` | 500 | Internal server error |

Validation `errors` are optional and appear only for safe client-correctable field errors.

---

# Part III — Architecture decisions

## 28. ADR-0001 — Lifecycle and health semantics

Must record:

- BOOTING/READY/DRAINING/STOPPED/FAILED_START;
- fail-before-listen PostgreSQL initialization;
- liveness independent of PostgreSQL;
- readiness dependent on lifecycle + real shared-pool query;
- application-owned SIGTERM/SIGINT coordinator;
- explicit prohibition on `enableShutdownHooks()`;
- `server.close()` normal drain;
- application-level DRAINING business gate;
- `closeAllConnections()` force path only;
- one global shutdown deadline across drain + provider cleanup;
- natural successful exit versus forced nonzero exit.

## 29. ADR-0002 — RFC 9457 public error contract

Must record:

- Problem Details standard;
- stable URN type strategy;
- extension members (`code`, `requestId`, `errors`);
- domain/transport boundary;
- sanitization rules;
- health endpoint exception.

## 30. ADR-0003 — Request context, logging, sensitive-data policy

Must record:

- Node >=24.16 native request signal;
- AsyncLocalStorage;
- duplicate-aware request-ID parsing;
- ID allowlist/max length;
- correlation-not-identity rule;
- safe log allowlist;
- route-template/unmatched policy;
- no request/response body/header-map logging;
- canary-secret verification.

## 31. ADR-0004 — PostgreSQL and Prisma lifecycle

Must record:

- one external `pg.Pool`;
- same pool passed to `PrismaPg`;
- current stable Prisma 7 line + committed lockfile;
- explicit pool/statement/query bounds;
- real startup/readiness query;
- external pool lifecycle ownership;
- migration separation;
- concrete Task repository;
- no generic repository abstraction;
- no fake transaction.

---

# Part IV — Implementation milestones

## 32. M0 — Repository foundation

### Deliver

- Node runtime policy (`>=24.16 <25` plus concrete dev/CI patch baseline);
- NestJS 11 baseline;
- Prisma 7 current stable baseline recorded for later M3 use;
- ESM/module strategy decided consistently with Prisma 7/Nest tooling;
- strict TypeScript;
- npm/package-lock;
- format/lint/typecheck/build scripts;
- minimal AppModule;
- repository governance/readme skeleton;
- frozen copy of this contract in `docs/spec/v1-contract.md` once approved.

### Requirements touched

`CFG-005`, runtime portions of scope, `CI-001`.

### Exit gate

```text
npm ci
format:check
lint
typecheck
build
```

No Task API and no PostgreSQL implementation yet.

---

## 33. M1 — Configuration, lifecycle skeleton, health semantics

### Deliver

- `CFG-001..005`;
- lifecycle state machine;
- application-owned signal coordinator;
- explicit prohibition on `enableShutdownHooks()`;
- BOOTING/READY/DRAINING transitions;
- bootstrap failure path;
- DB-independent liveness controller;
- readiness service interface with lifecycle semantics (DB probe may be completed in M3/M4);
- idle SIGTERM process test;
- termination-during-BOOTING process test.

### Requirements

`CFG-*`, `BOOT-001`, `BOOT-003`, `BOOT-005`, `BOOT-006`, `LIFE-001..003`, `LIFE-008..010`, `HLTH-001`, `HLTH-003`.

### Exit gate

No listener-before-validation regression; idle SIGTERM is bounded; no Nest native shutdown-hook ownership.

---

## 34. M2 — HTTP boundary, errors, context, logging

### Deliver

- raw Node HTTP receive/keep-alive policy;
- Helmet;
- body limit;
- media-type enforcement;
- strict validation;
- RFC 9457 Problem Details catalogue;
- DRAINING business-request gate;
- native `req.signal` context;
- duplicate-aware request ID policy;
- Pino structured logger;
- safe request-completion log;
- log canary tests;
- request-context concurrency harness.

### Requirements

`HTTP-*`, `ERR-*`, `CTX-*`, `LOG-*` except DB-specific canaries that land with M3.

### Exit gate

- malformed/oversized/unsupported input contracts pass;
- duplicate request-ID test passes;
- 100+ concurrent context test passes;
- sensitive canaries absent;
- no post-DRAINING test request that reaches the app enters the test domain gate.

---

## 35. M3 — PostgreSQL and tiny Task feature

### Deliver

- PostgreSQL Compose for local development;
- PostgreSQL Testcontainer support;
- Prisma schema/migration;
- explicitly owned `pg.Pool`;
- bounded pool configuration;
- `PrismaPg(pool)` + one PrismaClient;
- real startup query;
- pool error handling;
- deterministic external-pool cleanup;
- `POST /v1/tasks`;
- `GET /v1/tasks/:id`;
- concrete TaskRepository;
- migration-from-empty-DB test;
- pool-exhaustion/acquisition-timeout test.

### Requirements

`BOOT-002`, `BOOT-004`, `DB-*`, Task-related `HTTP/ERR`, `TEST-002`, `TEST-013`, `TEST-017`.

### Exit gate

- empty DB migrates;
- app fails before listen when DB unavailable;
- Task create/read works against real PostgreSQL;
- acquisition waits are demonstrably bounded;
- pool shuts down exactly once.

---

## 36. M4 — Readiness transitions and metrics

### Deliver

- real shared-pool readiness query;
- DB outage/recovery test;
- post-recovery Task operation test;
- Prometheus endpoint and baseline metrics;
- bounded route normalization;
- unmatched-cardinality attack test.

### Requirements

`HLTH-*`, `MET-*`, `TEST-004`, `TEST-016`.

### Exit gate

Stop/restart PostgreSQL without restarting Nest and observe readiness 200 -> 503 -> 200 plus successful post-recovery Task request.

---

## 37. M5 — Shutdown and failure hardening

### Deliver

- active-request drain test;
- persistent keep-alive post-DRAINING no-new-domain-work test;
- force deadline test;
- provider-cleanup hang test;
- client-disconnect/native signal test;
- DB statement-timeout and post-timeout pool-health tests;
- unexpected exception sanitization;
- complete HTTP malformed/oversized/media-type suite;
- lifecycle edge-case review.

### Requirements

Remaining `LIFE-*`, `TEST-007`, `TEST-009..015`, `DB-004`, `ERR-005..007`.

### Exit gate

The strongest production claims are now proven by process/e2e/integration evidence rather than mocks.

---

## 38. M6 — Container and supply chain

### Deliver

- multi-stage Node 24 Debian-slim image;
- explicit Node patch + immutable digest;
- non-root final process;
- minimal init;
- runtime-content inspection;
- final-image SIGTERM test;
- GitHub Actions CI;
- dependency review;
- CodeQL;
- Trivy;
- SHA-pinned actions;
- Dependabot npm/Docker/GitHub Actions;
- repo-setting documentation for secret scanning/push protection.

### Requirements

`CONT-*`, `SEC-*`, `CI-*`.

### Exit gate

Final container reproduces the process contract and passes required security/supply-chain gates.

---

## 39. M7 — Documentation and v1 release review

### Deliver

- README;
- architecture;
- operations;
- testing;
- security;
- four ADRs;
- requirement-to-test matrix updated with actual test names;
- clean checkout acceptance run;
- final scope audit removing mechanisms that do not justify maintenance cost.

### Exit gate

Every normative requirement is either:

- `PASS` with an identified automated/manual repository-setting evidence item; or
- explicitly marked non-applicable by an approved spec revision.

There may be no unexplained `TODO`, skipped required test, or unsupported production claim.

---

# Part V — Acceptance matrix

## 40. Requirement-to-evidence traceability

| Requirement family | Primary evidence |
|---|---|
| `CFG` | unit + child-process startup |
| `BOOT` | child-process + real PostgreSQL |
| `LIFE` | process + final-container signal tests |
| `HTTP` | e2e + raw HTTP process tests |
| `ERR` | e2e contract/schema assertions |
| `CTX` | e2e/process concurrency + raw duplicate-header test |
| `LOG` | captured full-process log canaries |
| `HLTH` | e2e/process + stopped/restarted Testcontainer |
| `DB` | real PostgreSQL integration + pool exhaustion/timeout tests |
| `MET` | e2e metrics parsing/cardinality attack |
| `SEC` | e2e + static/config/repository controls |
| `CONT` | built-image inspection + runtime signal test |
| `TEST` | test suite itself |
| `CI` | required GitHub workflows + repo settings |

The final M7 traceability file MUST map **each individual ID** to its exact implementation file(s), test name(s), and CI job(s).

---

## 41. Release acceptance checklist

V1 is release-ready only when all applicable items below are true.

### Startup

- invalid config never opens the HTTP port;
- DB unavailable at startup never opens the HTTP port;
- startup error output contains no DB credentials;
- signal during delayed BOOTING cannot later lead to listen;
- no startup migration occurs.

### Runtime health

- live=200 when healthy;
- DB outage does not turn liveness into a DB probe;
- ready=200 when READY + DB healthy;
- ready=503 on DB outage;
- recovery returns ready=200 without app restart;
- real Task operation works after recovery;
- DRAINING is never ready.

### Shutdown

- `enableShutdownHooks()` absent;
- first supported signal creates one global deadline;
- no new TCP listener acceptance after `server.close()`;
- already-running request can complete inside deadline;
- a post-DRAINING request delivered over a pre-existing keep-alive transport never starts Task/domain work;
- deadline expiry force-closes remaining HTTP connections;
- provider cleanup is also bounded by the same deadline;
- normal success exits naturally;
- forced path exits non-zero;
- final container reproduces the behavior.

### Request context/logging

- accepted valid request ID propagates;
- invalid/oversized/duplicate request IDs are replaced;
- 100+ interleaved requests show no context crossing;
- native request signal is available on supported Node baseline;
- no claim is made that it cancels Prisma work;
- normal logs are JSON;
- raw URL/body/header maps absent;
- Authorization/Cookie/body/DB-credential/nested-error canaries absent.

### HTTP/errors

- strict Task input behavior passes;
- malformed JSON -> 400;
- invalid UUID -> 400;
- missing Task -> 404;
- body >100 KiB -> 413;
- unsupported media type -> 415;
- known DB unavailability/timeout -> sanitized 503;
- unknown exception -> sanitized 500;
- business errors use `application/problem+json` and stable type URNs.

### Database

- one external pool exists;
- pool max explicit;
- acquisition timeout explicit and proven;
- statement timeout explicit and proven;
- server-side statement timeout explicit and tested;
- pool background errors handled;
- startup query is real I/O;
- readiness uses same pool;
- no independent fake readiness Promise timeout;
- migrations apply from empty DB;
- app startup does not migrate;
- external pool closes exactly once.

### Metrics

- request count and duration exported;
- Task creation metric increments;
- route templates used;
- 100 randomized 404 paths do not create unbounded route labels;
- no request/task IDs/raw query/error-message labels;
- monitoring backend absence cannot affect readiness.

### Container/CI

- explicit Node 24 patch + digest;
- non-root;
- minimal init;
- no local `.env`, Git metadata, tests, or dev toolchain in final image;
- full verification CI green;
- dependency review configured;
- CodeQL configured;
- Trivy policy enforced;
- third-party Actions SHA-pinned;
- Dependabot covers npm/Docker/GitHub Actions;
- supported repo secret-scanning settings documented/enabled.

### Scope

- no Redis;
- no auth/JWT/RBAC;
- no broker/queue;
- no GraphQL;
- no CQRS/event sourcing;
- no Kubernetes/Helm;
- no OTel runtime dependency;
- no unused outbound HTTP abstraction;
- no generic repository/base-service framework;
- no fake transaction;
- no independent readiness pool.

---

# Part VI — Known claim boundaries

## 42. What v1 explicitly does not claim

The repository does **not** claim:

- every client receives a structured 503 during the transport race of graceful shutdown;
- an AbortSignal automatically cancels an already-dispatched Prisma/PostgreSQL query;
- Node's request-receive timeout cancels handler/business work;
- a vulnerability scanner proves an image permanently secure;
- this process-level baseline provides ingress, backups, secret management, HA PostgreSQL, disaster recovery, network policy, or deployment-platform production readiness;
- one set of timeout/pool defaults is universally correct for every deployment;
- metrics/tracing/logging substitute for application-domain monitoring;
- the Task domain demonstrates transaction architecture;
- a Dockerfile alone makes a service production-ready.

These limitations are part of the design, not omissions to hide.

---

# Part VII — Source basis for refinements

The v1.0 candidate retains the original 10 August 2026 research specification as its design rationale and incorporates targeted primary-source verification performed during the 11 August refinement.

Primary sources used for the changes in this candidate:

1. Node.js 24 HTTP API — `http.Server.close`, `closeAllConnections`, `closeIdleConnections`, HTTP receive/keep-alive timeouts, `IncomingMessage.signal`, `headersDistinct` and `rawHeaders`.
   - https://nodejs.org/download/release/latest-v24.x/docs/api/http.html
2. Node.js process API — natural exit, `process.exitCode`, and the caveats of forceful `process.exit()`.
   - https://nodejs.org/api/process.html
3. NestJS lifecycle documentation — `app.close()`, shutdown lifecycle hooks, and `enableShutdownHooks()` behavior.
   - https://docs.nestjs.com/fundamentals/lifecycle-events
4. node-postgres Pool API — `max`, `connectionTimeoutMillis`, FIFO waiting, pool exhaustion timeout behavior, `pool.end`, and background pool errors.
   - https://node-postgres.com/apis/pool
5. node-postgres Client/Pool API and source — `statement_timeout`, acquisition/connection timeout, pool lifecycle and client error behavior.
   - https://node-postgres.com/apis/client
6. Prisma PostgreSQL/driver-adapter documentation — Prisma 7 delegates pooling to the underlying driver and `pg` has different timeout defaults.
   - https://www.prisma.io/docs/orm/core-concepts/supported-databases/postgresql
   - https://www.prisma.io/docs/orm/core-concepts/supported-databases/database-drivers
7. Prisma official examples demonstrating `pg.Pool` supplied to `PrismaPg`.
   - https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding
8. Prisma adapter-pg 7.9.1 source — explicit external-pool support, disposal behavior, `disposeExternalPool`, and pool error handling.
   - https://github.com/prisma/prisma/blob/7.9.1/packages/adapter-pg/src/pg.ts
9. Prisma releases — 7.9.1 current stable patch at refinement time; 7.9.x includes driver-adapter reliability fixes relevant to production use.
   - https://github.com/prisma/prisma/releases
10. RFC 9457 — Problem Details for HTTP APIs.
    - https://www.rfc-editor.org/rfc/rfc9457
11. Prometheus metric/label guidance.
    - https://prometheus.io/docs/practices/naming/
12. Official GitHub security/dependency/Actions documentation and official Docker guidance are the implementation authority for M6.

---

# Part VIII — Architect change log from the 10 August draft

## 43. Accepted refinements

1. **Node minimum tightened** from generic Node 24 LTS to `>=24.16.0 <25` so native `IncomingMessage.signal` is a supported contract.
2. **Nest signal ownership made explicit:** v1 forbids `app.enableShutdownHooks()` and uses one application-owned shutdown coordinator; `app.close()` remains the Nest provider-cleanup mechanism.
3. **Shutdown guarantee corrected:** the service guarantees no new domain work after DRAINING, not that every racing keep-alive request receives a 503.
4. **`closeIdleConnections()` removed as a correctness requirement** because Node >=19 already reaps idle HTTP keep-alive connections as part of `server.close()`.
5. **`closeAllConnections()` explicitly limited to force escalation** after the global deadline.
6. **One global shutdown deadline now covers both HTTP draining and Nest/provider/database cleanup.**
7. **Normal shutdown no longer requires `process.exit(0)`.** Natural exit is the normal path; forced non-zero termination is reserved for deadline failure.
8. **Repeated signals no longer introduce a second-signal policy.** They cannot reset/duplicate the in-progress shutdown.
9. **Independent `READINESS_DB_TIMEOUT_MS` removed.** Readiness is bounded by real shared-pool acquisition/query/statement mechanisms rather than an abandoned Promise timer.
10. **One explicit external `pg.Pool` is now normative** and is passed to PrismaPg.
11. **DB configuration renamed/refined** around actual mechanisms: acquisition and server-side statement bounds; client-side `query_timeout` is explicitly rejected in the frozen v1.
12. **Pool error handling made explicit** because idle client failure emits pool `error` events.
13. **Duplicate request-ID parsing strengthened** using duplicate-preserving Node header access.
14. **Problem Details type strategy finalized** as stable URNs rather than a placeholder URI.
15. **Unmatched metric cardinality test strengthened** with randomized 404 paths.
16. **Keep-alive shutdown process test strengthened** to distinguish new TCP connections from new HTTP requests over an existing connection.
17. **Claim boundaries added** so tests prove exactly what the runtime can guarantee and no more.
18. **Requirement IDs and M0–M7 requirement mapping introduced.**

## 44. Clean-room freeze refinements (11 August 2026)

The final independent review produced four targeted freeze conditions. Architect adjudication resulted in these changes:

1. **Removed `DB_QUERY_TIMEOUT_MS` / pg `query_timeout`.** The frozen contract accepts only mechanisms that bound the operation being claimed; server-side `statement_timeout` remains the execution bound. The review's stronger assertion that every query-timeout path necessarily returns a poisoned connection to the pool is not adopted as a universal runtime fact.
2. **Kept `server.timeout = 0`.** Non-zero `headersTimeout` and `requestTimeout` remain the explicit receive-side Slowloris/DoS controls. A generic inactivity timeout is intentionally not treated as application-operation cancellation.
3. **Made duplicate request-ID policy unambiguous.** Any two or more `x-request-id` field lines are replaced, including identical duplicates.
4. **Strengthened post-timeout evidence.** A real server-side statement-timeout test must prove the same shared pool remains healthy immediately afterward.
5. **Strengthened pool-exhaustion evidence** with `waitingCount == 0` after acquisition timeouts settle.
6. **Hardened database shutdown cleanup** so `pool.end()` is attempted even if `prisma.$disconnect()` rejects, while the one global shutdown deadline remains authoritative.
7. **Clarified parser-vs-shutdown timing:** normal request receive bounds never extend the absolute shutdown deadline.
8. **Strengthened container signal evidence** to prove the Node application actually enters DRAINING rather than merely observing container termination.
9. **Narrowed transient DB error mapping** to implementation-observed/tested error shapes instead of speculative blanket Prisma-code lists.

With these changes, no unresolved architectural blocker remains for M0.

## 45. Rejected refinements

The following proposals are intentionally not adopted:

- mandatory `headersTimeout > keepAliveTimeout + 1000 ms` formula;
- mandatory dependency on `closeIdleConnections()` for Node 24;
- guaranteed 503 for every keep-alive shutdown race;
- custom socket-scoped AbortController on Node >=24.16;
- mandatory second PostgreSQL pool for readiness;
- mandatory `DIRECT_URL` without an external pooling topology;
- generic Promise-race readiness timeout;
- automatic second-signal force exit;
- Pino wildcard-redaction prohibition unsupported by the actual v1 logging design;
- new architecture/features introduced merely to resemble a larger enterprise starter.

---

## 46. Freeze verdict

**Architectural status: FROZEN — APPROVED FOR M0 IMPLEMENTATION.**

The final clean-room review has been adjudicated and the accepted corrections are incorporated in this document. No unresolved architectural blocker remains.

Implementation proceeds strictly **M0 -> M7**, one milestone at a time. A later implementation discovery may amend the specification only through an explicit reviewed specification/ADR change; tests or coding convenience MUST NOT silently weaken the frozen contract.
