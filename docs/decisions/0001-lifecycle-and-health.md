# ADR-0001: Lifecycle and health semantics

- Status: Accepted
- Date: 2026-08-14

## Context

A production process must distinguish successful startup, traffic readiness,
dependency health, graceful drain, forced termination, and startup failure. If
Nest, an orchestrator, and custom signal handlers all own pieces of shutdown,
the order and deadline cannot be stated or tested reliably.

## Decision

The application owns one explicit state machine:
`BOOTING -> READY -> DRAINING -> STOPPED`, with
`BOOTING -> DRAINING -> STOPPED` for termination during startup and
`BOOTING -> FAILED_START` for startup failure.

Configuration, application initialization, and a real PostgreSQL query must
succeed before the HTTP listener binds. A startup dependency failure therefore
fails before listen and exits nonzero after best-effort cleanup.

Liveness is independent of PostgreSQL and returns 200 when the running process
can answer the probe. Readiness requires both `READY` lifecycle state and a real
query through the application's shared pool. It returns 503 while draining or
when that dependency is unavailable, and can recover without restarting Nest.

`ShutdownCoordinator` is the sole owner of `SIGTERM` and `SIGINT`.
`enableShutdownHooks()` is prohibited. On the first signal the coordinator:

1. enters `DRAINING` and starts one global deadline;
2. applies the early application-level business gate;
3. uses `server.close()` for normal HTTP drain;
4. closes Nest providers and the external database pool;
5. marks `STOPPED` and allows natural status-zero process exit.

The deadline covers both HTTP drain and provider/database cleanup. It cannot be
extended by a second signal. `server.closeAllConnections()` belongs only to the
deadline force path, which emits a best-effort event and exits nonzero.

The application gate promises that a request delivered after DRAINING cannot
start Task work. It does not promise a 503 for every keep-alive race because Node
may reset or retire the transport before the request reaches middleware.

## Consequences

- Startup and termination have one testable owner and deterministic ordering.
- Orchestrators can use liveness and readiness for different decisions.
- Database outages remove instances from traffic without creating restart
  storms and can recover in place.
- The platform termination grace period must exceed the application deadline.
- Provider cleanup that hangs is bounded by the same deadline as active HTTP
  work.
- A forced or failed shutdown is visibly nonzero rather than being reported as a
  successful deployment event.
