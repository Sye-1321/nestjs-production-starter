# Testing

The test strategy follows the production claim being made. Pure policy is
tested in-process; HTTP and persistence behavior uses the real boundary;
shutdown claims use child processes or the final image. Mocks are not accepted
as evidence for PostgreSQL, operating-system signal, or container-runtime
behavior.

## Prerequisites

- Node.js 24.19.0 and npm 11.17.0;
- a running Docker engine using Linux containers;
- enough local capacity to start PostgreSQL 18.4 Testcontainers;
- network access for the initial PostgreSQL/base-image pull and vulnerability
  database download when running supply-chain checks.

Install exactly the committed graph before verification:

```sh
npm ci
```

No long-lived test database is required. The integration, end-to-end, process,
and container harnesses create isolated resources and clean them in `finally`
blocks. A failed harness cleanup makes the suite fail.

## Required gate

Run the commands in this order from the repository root:

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

The test scripts that need compiled output run `npm run build` themselves. The
explicit build remains in the gate because compilation is also a standalone
release requirement.

## Suite responsibilities

| Suite       | Boundary exercised                  | Principal evidence                                                    |
| ----------- | ----------------------------------- | --------------------------------------------------------------------- |
| unit        | functions/classes and static policy | configuration, lifecycle, error mapping, metrics, source/CI contracts |
| integration | service/repository/shared DB stack  | migration, Task persistence, acquisition and statement bounds         |
| end-to-end  | real Nest HTTP + real PostgreSQL    | public contracts, context, readiness recovery, metric cardinality     |
| process     | spawned complete Node process       | startup/listen order, logs, raw HTTP, abort and shutdown semantics    |
| container   | built final Linux image             | runtime contents, non-root/init policy, real PID 1 SIGTERM drain      |

### Unit

`npm run test:unit` compiles and runs every `test/unit/*.test.mjs` file with the
Node test runner. Besides normal class behavior, source-contract tests guard
properties that are easy to accidentally weaken: no Nest shutdown hooks, no
detached timeout race, frozen-spec integrity, route normalization, workflow SHA
pins, image construction, and security policy.

Unit tests do not establish that PostgreSQL, sockets, signals, or Docker behave
as required; the later suites do that.

### PostgreSQL integration

`npm run test:integration` starts `postgres:18.4-bookworm`, deploys migrations to
an empty database, and runs serially. It proves the exact migration schema,
concrete Task repository/service behavior, real pool acquisition timeout and
recovery, server-side statement timeout classification, and reuse of the shared
pool after cancellation.

The harness supplies the database URL. Tests must not silently fall back to a
developer database or replace PostgreSQL with an in-memory implementation.

### HTTP end-to-end

`npm run test:e2e` starts a separate migrated PostgreSQL Testcontainer and real
Nest applications. It covers Task create/read and RFC 9457 errors, strict input
handling, 100-way context isolation, dependency-unavailable classification,
outage/restart readiness transitions, post-recovery Task work, and bounded
Prometheus route labels under 100 random unmatched paths.

The suite is serial because several tests deliberately saturate or restart the
shared dependency. Serial execution is a correctness choice, not a workaround
for hidden shared state.

### Process

`npm run test:process` starts a PostgreSQL Testcontainer and spawns compiled Node
processes with controlled environment and captured stdout/stderr. The harness
applies the committed migration externally before spawning those processes; the
application itself still never migrates. The suite exercises fail-before-listen
startup, raw duplicate request-ID headers, secret canaries, native request abort,
active-request drain, keep-alive races, forced deadlines, and provider-cleanup
hangs.

POSIX signal cases are marked skipped on non-Linux hosts because Windows process
termination is not equivalent evidence. This is an explained platform skip, not
a skipped required test: the `Linux process tests` CI job runs the complete suite
on Ubuntu 24.04. Non-signal process cases still run on Windows and provide useful
local feedback.

### Final container

`npm run test:container` builds the current Dockerfile with `buildx --load`,
assigns a process-specific temporary tag, and runs tests serially. Image
inspection verifies the exact Node/init/user/entrypoint contract and absence of
development/source material and npm tooling. The signal test migrates an
external PostgreSQL container, holds an active Task request, sends a real
`SIGTERM` to the container, observes DRAINING/listener closure, releases the
request, and requires natural exit status zero.

The harness removes its exact temporary image even on failure. It does not prune
unrelated Docker images, containers, networks, or volumes.

## CI mapping

`.github/workflows/ci.yml` repeats the required commands on Ubuntu 24.04:

| Job                | Commands/evidence                           |
| ------------------ | ------------------------------------------- |
| `quality-and-unit` | format, lint, typecheck, build, unit        |
| `integration`      | PostgreSQL integration suite                |
| `e2e`              | HTTP end-to-end suite                       |
| `process`          | authoritative Linux process/signal suite    |
| `container`        | final-image composition and signal contract |

Additional workflows run dependency review, CodeQL, and the reporting/blocking
Trivy image scans. All jobs install with `npm ci`, and every external action is
pinned to a full commit SHA.

## Failure interpretation

- A Testcontainers startup failure is an environment/harness failure and must
  not be reported as an application assertion failure or silently skipped.
- A timeout failure identifies the bounded operation named by the test. Raising
  a product timeout changes policy; raising only a cold-start harness ceiling is
  acceptable when the product deadline remains unchanged and the reason is
  recorded.
- A process killed by the test runner is not evidence of graceful shutdown.
  Graceful cases must observe the application state/event and natural status
  zero; force cases must observe nonzero exit.
- A vulnerability database download failure is not a clean scan and not a
  vulnerability finding. Retry the external fetch, then preserve the scanner's
  actual result.

## Adding evidence

Name tests as complete behavioral claims, keep the production boundary visible,
and add each normative requirement to `docs/traceability.md` with the exact test
name and CI job. If a proposed mechanism cannot be falsified at the boundary it
claims to control, narrow the claim or design a stronger test before merging it.
