# Adapting the starter

This repository is an executable reference, not a one-click application
generator. Adapt it by preserving the operational guarantees that fit your
service, replacing the deliberately small Task domain, and revalidating every
policy value against the real deployment.

## Foundations normally retained

- **Bootstrap ordering and fail-before-listen:** validate configuration,
  initialize owned dependencies, and complete a real PostgreSQL probe before
  accepting traffic.
- **Lifecycle ownership:** keep one explicit lifecycle and one shutdown
  coordinator responsible for signals, draining, provider cleanup, and the
  absolute shutdown deadline.
- **Health semantics:** keep liveness independent of PostgreSQL and make
  readiness depend on both lifecycle state and a real shared-pool probe.
- **Request correlation and context:** retain duplicate-aware request-ID
  selection, `AsyncLocalStorage`, and the native request abort signal without
  treating correlation as identity.
- **Logging policy:** continue collecting a bounded allowlist rather than raw
  bodies, headers, URLs, database details, or arbitrary error objects.
- **Problem Details boundary:** keep transport mapping centralized, catalogue
  public errors, and sanitize every unrecognized failure.
- **Bounded HTTP input:** retain explicit receive timeouts, body limits, media
  type enforcement, strict DTO validation, and the early draining gate.
- **PostgreSQL lifecycle:** preserve one externally owned `pg.Pool`, one
  long-lived Prisma client, real startup/readiness probes, and deterministic
  cleanup.
- **External migrations:** run committed migrations as a separate deployment
  operation, never as part of application startup.
- **Metrics cardinality:** use route templates or bounded constants and never
  label metrics with request IDs, resource IDs, raw paths, queries, or messages.
- **Container/runtime model:** keep the immutable Node base, multi-stage build,
  non-root user, minimal init, and separation of liveness from readiness.
- **Evidence hierarchy:** prove PostgreSQL behavior with PostgreSQL, signal
  behavior with real Linux processes, and image claims against the final image.
- **CI and security controls:** retain exact installs, full verification,
  dependency review, CodeQL, Trivy, SHA-pinned Actions, and deliberate
  dependency automation.

The owning design rationale is in [`architecture.md`](architecture.md), the
evidence model is in [`testing.md`](testing.md), and deployment responsibilities
are in [`operations.md`](operations.md).

## Application-specific pieces to replace

Replace the Task feature as one coherent domain change:

- `TaskModule` and the Task controller, service, and concrete repository;
- Task DTOs and Task-specific errors;
- the Task Prisma model and its migration;
- `POST /v1/tasks` and `GET /v1/tasks/:id`;
- `tasks_created_total`;
- Task-specific Problem Details mappings;
- Task unit, integration, end-to-end, process-fixture, container-fixture, and
  traceability evidence.

Do not retain Task names as placeholders around a different domain. Update the
public error catalogue, metrics, migration ownership, routes, documentation,
and evidence together. Introduce transactions or repository abstractions only
when the replacement domain creates a concrete requirement for them.

## Values to re-evaluate, not copy blindly

These values are policy choices for this reference service, not universal
production constants:

| Policy                                      | Reference value                                 | Re-evaluate against                                       |
| ------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| HTTP receive/keep-alive timeouts            | headers 15 s; request 30 s; keep-alive 5 s      | clients, ingress limits, slow-request threat model        |
| JSON body limit                             | 100 KiB                                         | actual request shapes and abuse controls                  |
| PostgreSQL pool size                        | 10                                              | instance count, DB connection budget, query concurrency   |
| Pool acquisition timeout                    | 1 s                                             | capacity, latency objective, overload behavior            |
| PostgreSQL statement timeout                | 3 s                                             | query plans, workload, cancellation expectations          |
| Application shutdown deadline               | 10 s                                            | longest admitted work and provider cleanup                |
| Node runtime                                | `>=24.16.0 <25`; development/CI `24.19.0`       | supported APIs, LTS policy, base-image evidence           |
| PostgreSQL image                            | `18.4-bookworm`                                 | managed-service/runtime compatibility                     |
| Prisma                                      | `7.9.1`                                         | adapter behavior and observed failure shapes              |
| Prisma/PostgreSQL failure classifiers       | exact pinned shapes                             | every driver/ORM upgrade and real integration evidence    |
| Prometheus request-duration buckets         | 5 ms through 10 s                               | latency objectives and useful histogram resolution        |
| Deployment termination grace recommendation | at least 15 s for the default 10 s app deadline | orchestrator sequencing, sidecars, and forced termination |

Changing a bound requires changing its tests and operational guidance; merely
raising a timeout to make a failure disappear is not adaptation.

## Practical adaptation sequence

1. Rename repository/service identities, log fields, database application name,
   and public problem URNs deliberately.
2. Replace the Task slice, schema, migration, metric, and evidence as one
   reviewable unit.
3. Decide configuration and policy values from measured deployment constraints.
4. Re-run the complete verification hierarchy, including authoritative Linux
   process and final-container tests, before making the new service claim.

Preserve only guarantees you can still explain, operate, and falsify.
