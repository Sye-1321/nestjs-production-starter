# Operations

This runbook covers the controls implemented by the v1 starter. The deploying
platform still owns secret delivery, TLS, network policy, PostgreSQL operations,
backups, scheduling, and rollback orchestration.

## Configuration

The process reads environment variables directly; it does not load `.env`
files. Validate and inject all production values through the process supervisor
or orchestrator. Invalid configuration is reported with a field name and safe
rule, never with the rejected value.

| Variable                  | Required | Allowed/default                        |
| ------------------------- | -------- | -------------------------------------- |
| `NODE_ENV`                | yes      | `development`, `test`, or `production` |
| `PORT`                    | yes      | integer `1..65535`                     |
| `LOG_LEVEL`               | no       | Pino level; default `info`             |
| `DATABASE_URL`            | yes      | `postgres:` or `postgresql:` URL       |
| `DB_POOL_MAX`             | no       | integer `1..50`; default `10`          |
| `DB_ACQUIRE_TIMEOUT_MS`   | no       | integer `100..30000`; default `1000`   |
| `DB_STATEMENT_TIMEOUT_MS` | no       | integer `100..60000`; default `3000`   |
| `SHUTDOWN_TIMEOUT_MS`     | no       | integer `1000..60000`; default `10000` |

`.env.example` is a value-shape reference only. Its password is a placeholder,
whereas `compose.yaml` contains fixed local-development credentials. Never copy
either into a production secret store without replacing every credential and
host.

## Local startup

Use Node.js 24.19.0 and npm 11.17.0.

```sh
npm ci
docker compose up -d postgres
```

Export the eight variables in `.env.example`, changing `DATABASE_URL` to the
local Compose credentials:

```text
postgresql://nestjs_production_starter:nestjs_production_starter@127.0.0.1:5432/nestjs_production_starter
```

Then migrate, build, and start:

```sh
npm exec prisma migrate deploy
npm run build
npm run start:prod
```

The listener is not opened until configuration, Nest initialization, and a real
PostgreSQL probe succeed. A failed startup exits nonzero after best-effort
cleanup; fix the dependency/configuration and let the supervisor start a new
process.

## Deployment order

1. Provision PostgreSQL and an application role with the least privileges the
   Task schema needs.
2. Inject configuration and secrets into a dedicated migration job created from
   the same commit. Run `npm ci` and `npm exec prisma migrate deploy` there.
3. Build the runtime image from the repository `Dockerfile`; retain the image
   digest as the release identity.
4. Start application instances with the migrated database and all eight
   configuration values available.
5. Wait for `/health/ready` before admitting traffic.
6. Observe error logs, readiness, request metrics, and a Task smoke request
   before completing the rollout.

Do not run migrations in the application entrypoint. The final runtime image
intentionally excludes npm and the Prisma CLI, preventing an application restart
from silently becoming a schema-changing operation.

## Probes

Configure two separate orchestrator probes:

| Endpoint        | Success | Meaning                                               |
| --------------- | ------- | ----------------------------------------------------- |
| `/health/live`  | `200`   | process can serve; independent of PostgreSQL          |
| `/health/ready` | `200`   | lifecycle is `READY` and a shared-pool query succeeds |

Readiness returns `503` while draining or when PostgreSQL is unavailable.
Liveness remains `200` during a database outage if it is reachable. Do not use
readiness as liveness: restarting a healthy process cannot repair PostgreSQL and
can amplify an outage.

The image has no Docker `HEALTHCHECK` because Docker exposes only one health
state and cannot preserve these distinct semantics.

## Termination

Send `SIGTERM` for normal termination. On the first signal the service:

1. enters `DRAINING` and rejects newly delivered Task work;
2. calls `server.close()` to stop accepting new connections and drain active
   HTTP work;
3. closes Nest providers and the externally owned PostgreSQL pool;
4. exits naturally with status zero when all work completes.

One `SHUTDOWN_TIMEOUT_MS` deadline covers all four phases. At the deadline the
process closes all remaining connections, emits `forced_shutdown`, and exits
nonzero. Set the platform termination grace period comfortably above this
deadline so the application force path can run before the platform sends
`SIGKILL`. A 15-second or larger platform grace period is suitable for the
10-second default; increase the margin when sidecars also consume the grace
window.

Do not add `enableShutdownHooks()` or a second signal handler. A competing
shutdown owner would make deadline and exit semantics ambiguous.

## Metrics and logs

Scrape `/metrics` as Prometheus text. Operationally useful series include:

- `http_server_requests_total` and
  `http_server_request_duration_seconds` by method, bounded route, and status;
- `tasks_created_total`;
- `service_dependency_ready` (`1` ready, `0` unavailable/not ready);
- `process_resident_memory_bytes` and `nodejs_heap_size_used_bytes`.

Application logs are newline-delimited Pino JSON on stdout. Correlate request
completion and safe error events with `requestId`. Route values are registered
templates or the fixed unmatched label, never raw attacker-controlled paths.
Logs deliberately omit bodies, header maps, database URLs, and nested exception
objects. Infrastructure should collect stdout without parsing secrets back into
the event.

## Incident checks

### Readiness is 503 but liveness is 200

Check PostgreSQL reachability, credentials, connection limits, and statement
latency. `service_dependency_ready` should be `0`. The same process should
recover automatically after the database returns; verify readiness becomes 200
and perform a Task create/read operation before considering it recovered.

### Startup repeatedly fails

Read the safe startup event for the invalid field or database failure category.
Confirm the migration completed and the application endpoint can reach
PostgreSQL. The service intentionally never listens in this condition, so do not
bypass the probe or weaken configuration validation.

### Requests return dependency-unavailable errors

Compare acquisition pressure with `DB_POOL_MAX` and
`DB_ACQUIRE_TIMEOUT_MS`; then inspect slow queries relative to the server-side
`DB_STATEMENT_TIMEOUT_MS`. Raising limits without measuring database capacity can
turn a bounded failure into resource exhaustion.

### Shutdown exits nonzero

Search for `forced_shutdown` or `shutdown_failed`. Check active requests,
provider cleanup, and database reachability against the single shutdown
deadline. Preserve the nonzero result as a failed termination signal; do not
treat it as a clean deployment completion.

## Rollback and recovery boundaries

Application rollback means redeploying a previously accepted image digest whose
database expectations remain compatible with the applied migrations. Database
backup, restore, point-in-time recovery, destructive migration reversal, and
credential rotation are platform procedures and are intentionally not
implemented here.

The database timeout model does not claim to terminate a silent half-open network
operation after a query has been dispatched. If the deployment needs that bound,
provide and test a network/driver mechanism that actually terminates the
underlying work before expanding the service claim.
