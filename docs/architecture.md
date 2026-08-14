# Architecture

This repository is an executable reference for a small NestJS HTTP service. Its
scope is intentionally narrow: one Task resource, one PostgreSQL database, one
process, and the operational controls required by the frozen v1 contract. It is
not a framework generator or a collection of optional infrastructure.

## Runtime shape

```text
client
  -> Node HTTP server
  -> request context -> metrics -> completion logging -> draining gate
  -> Task media/body/validation boundary
  -> controller -> service -> concrete TaskRepository
  -> one PrismaClient -> PrismaPg -> one externally owned pg.Pool
  -> PostgreSQL

platform endpoints
  /health/live   -> lifecycle only
  /health/ready  -> lifecycle + real query on the shared pool
  /metrics       -> bounded Prometheus registry
```

`AppModule` composes configuration, context, logging, database, errors,
metrics, health, and Task modules. Platform modules own cross-cutting runtime
behavior; the Task module owns the only business feature. Dependencies point
from the feature toward explicit platform services, never from platform code
into the feature.

## Bootstrap and lifecycle

`src/main.ts` validates the environment before starting Nest. `bootstrap()`
then creates a `Lifecycle` in `BOOTING`, installs application-owned `SIGTERM`
and `SIGINT` handlers, constructs the application, configures the raw Node HTTP
server and middleware, initializes providers, and executes a real database
probe. Only after all of those steps succeed does it bind the listener and move
to `READY`.

The state machine is:

```text
BOOTING -> READY -> DRAINING -> STOPPED
   |         |
   +---------+----> DRAINING -> STOPPED
   |
   +--------------> FAILED_START
```

No code calls Nest's `enableShutdownHooks()`. `ShutdownCoordinator` owns signal
handling so one deadline covers HTTP draining and provider cleanup. On the first
signal it moves the process to `DRAINING`, starts the deadline, emits the
shutdown event, closes the HTTP server, and then closes Nest providers. Normal
completion leaves Node to exit naturally with status zero. At the deadline, the
force path calls `server.closeAllConnections()`, emits a best-effort synchronous
event, and exits nonzero. Repeated signals share the same shutdown sequence and
cannot extend the deadline.

The early draining middleware prevents newly delivered business requests from
starting domain work. `server.close()` rejects new connections and retires
keep-alive transports, but transport races mean v1 claims only that a delivered
post-DRAINING request cannot enter Task work—not that every such request receives
a 503 response.

## HTTP boundary

The raw HTTP server has explicit receive, header, request, keep-alive, and
connection policies in `src/bootstrap/http-server.ts`. The application disables
Nest's default body parser and installs middleware in this order:

1. request ID parsing and `AsyncLocalStorage` context;
2. bounded route metrics;
3. safe completion logging;
4. the lifecycle draining gate;
5. Task media-type enforcement;
6. bounded JSON parsing and body-parser error translation.

A strict global validation pipe rejects unknown or invalid fields. A global
exception filter translates recognized transport/domain failures to RFC 9457
Problem Details and sanitizes unexpected failures. Health responses retain their
small probe-specific schema by contract.

Request IDs are correlation tokens, not identities or authorization inputs.
The middleware accepts one valid allowlisted value within the length limit;
duplicate, malformed, or oversized input is replaced. Native Node request
abort signals and `AsyncLocalStorage` carry request-scoped cancellation and
correlation without request-scoped providers.

## Persistence

`DatabaseService` creates exactly one external `pg.Pool`. The same pool is
passed to `PrismaPg`, which backs exactly one `PrismaClient`. Startup and
readiness probes execute real queries on that pool; Task operations use the
same pool through Prisma.

The pool owns acquisition and connection waiting bounds. PostgreSQL's
`statement_timeout` bounds statement execution on the server. There is no
detached `Promise.race()` timeout and no claim that a client timer cancels
server work. A silent half-open network failure after query dispatch remains a
documented transport limitation.

The application owns the external pool lifecycle and closes it once during
provider teardown. Prisma migrations run as an external deployment step; the
application never migrates during startup. `TaskRepository` is concrete because
v1 has one data source and no second persistence model that would justify a
generic repository abstraction or fake transaction API.

## Observability

Pino emits structured application events to stdout. Request-completion logs use
a safe allowlist: event, level, request ID, method, normalized route,
status code, and duration. Raw URLs for unmatched requests, header maps,
request/response bodies, database URLs, and nested errors are excluded.

Prometheus metrics are exposed at `/metrics`. Route labels use registered route
templates and a fixed unmatched label, so attacker-controlled paths cannot
create unbounded time-series cardinality. The baseline covers request count and
duration plus process/runtime metrics supplied by `prom-client`.

## Deployment boundary

The final image is a reproducible multi-stage Node 24 Debian-slim image pinned
to a patch version and digest. It contains compiled output, production
dependencies, Node, and `dumb-init`; it excludes source, tests, package-manager
tooling, development dependencies, source maps, Git data, and environment files.
It runs as the image's non-root `node` user.

The image deliberately has no Docker `HEALTHCHECK`. An orchestrator should
probe `/health/live` and `/health/ready` independently and set its termination
grace period above `SHUTDOWN_TIMEOUT_MS`. PostgreSQL, migrations, secrets,
network policy, TLS termination, backups, and scheduling remain deployment
responsibilities.

## Deliberate exclusions

v1 does not include authentication, authorization, CORS, proxy trust, Redis,
queues, generic repositories, distributed tracing exporters, Kubernetes/Helm
manifests, or an in-process migration runner. Adding one of these mechanisms
requires a concrete requirement and falsifiable operational evidence; none is
needed to satisfy the current contract.
