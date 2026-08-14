# ADR-0004: PostgreSQL and Prisma lifecycle

- Status: Accepted
- Date: 2026-08-14

## Context

Prisma can hide connection ownership if allowed to construct its own pool, while
health probes and low-level controls need direct PostgreSQL access. Multiple
pools, per-request clients, fake timeout races, and in-process migrations would
make startup, readiness, resource bounds, and shutdown difficult to state.

## Decision

The database module constructs one application-scoped external `pg.Pool`. That
same pool is passed to `PrismaPg`, and the adapter is passed to one long-lived
`PrismaClient`. Infrastructure probes call the pool directly; Task persistence
uses it through Prisma. There is no readiness pool or PrismaClient-per-request.

V1 pins the stable Prisma 7.9.1 line in `package.json` and the committed npm
lockfile. Generated ESM client code is derived during build and is not committed.

Pool configuration explicitly sets:

- `max` from `DB_POOL_MAX`;
- `connectionTimeoutMillis` from `DB_ACQUIRE_TIMEOUT_MS` for acquisition and new
  connection waiting;
- PostgreSQL `statement_timeout` from `DB_STATEMENT_TIMEOUT_MS` for server-side
  statement execution;
- a stable `application_name`.

The application does not configure pg `query_timeout` or wrap queries in
`Promise.race()`: returning early would not prove cancellation of dispatched
PostgreSQL work. Startup and readiness execute a real `SELECT 1` under the shared
pool's acquisition and server-statement bounds. A silent half-open transport can
still outlive the server timeout from the client's point of view if the response
cannot cross the network, so v1 makes no universal network deadline claim.

The pool has a bounded sanitized background error handler. Known dependency
conditions are classified only from error shapes observed against the pinned
pg/Prisma stack; arbitrary dynamic messages are not mapped to 503. Real tests
cover acquisition exhaustion, statement cancellation, post-timeout pool reuse,
outage, and recovery.

The application owns external-pool cleanup. During Nest teardown the provider
attempts `prisma.$disconnect()` and then `pool.end()` exactly once, attempting the
pool close even if Prisma disposal fails. The adapter does not independently
dispose the externally owned pool. The application-wide shutdown deadline bounds
this graceful drain.

Migrations are version controlled and run externally with
`prisma migrate deploy` before application rollout. Startup performs connectivity
validation but never schema mutation. No `DIRECT_URL` is invented because v1 has
no external transaction-pooler topology requiring it.

Persistence uses one concrete `TaskRepository` with explicit `create` and
`findById` methods. A generic repository abstraction would add no substitutable
implementation, and the single atomic Task insert does not justify a fake or
multi-statement transaction.

## Consequences

- Startup, readiness, Prisma operations, and shutdown share one observable
  resource and one set of limits.
- Deployment must run migrations as a separate controlled job.
- Pool exhaustion and server-side statement cancellation can be tested without
  claiming detached client timers cancel work.
- Adding a second database, pooler topology, or transactional workflow requires
  a new decision rather than pre-emptive generic machinery.
- Driver upgrades must revalidate the narrow failure classifier and lifecycle
  behavior, not merely update the lockfile.
