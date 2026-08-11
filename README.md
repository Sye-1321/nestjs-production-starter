# NestJS Production Starter

A compact executable reference for the operational contract of a NestJS HTTP service.

The project is intentionally built milestone by milestone. Production claims are added only when their failure behavior is defined and there is automated evidence capable of falsifying them.

## Milestone status

| Milestone | Status |
| --- | --- |
| M0 — Repository Foundation | Complete |
| M1 — Configuration, Lifecycle and Health | Complete |
| M2 — HTTP Boundary, Errors, Context and Logging | Next |
| M3 — PostgreSQL and Tiny Task Feature | Planned |
| M4 — Readiness Transitions and Metrics | Planned |
| M5 — Shutdown and Failure Hardening | Planned |
| M6 — Container and Supply Chain | Planned |
| M7 — Documentation and v1 Release Review | Planned |

## Implemented through M1

The repository currently provides:

- strict runtime and package-management baselines;
- strict TypeScript and type-aware linting;
- an explicit eight-variable environment contract;
- validated and sanitized startup configuration failures;
- an explicit lifecycle state machine;
- application-owned `SIGTERM` and `SIGINT` coordination;
- deterministic `BOOTING`, `READY`, `DRAINING`, `STOPPED`, and failed-start behavior;
- explicit graceful shutdown through HTTP drain followed by Nest application cleanup;
- database-independent liveness at `GET /health/live`;
- fail-closed readiness at `GET /health/ready`;
- unit evidence for configuration, lifecycle, readiness, and shutdown invariants;
- child-process evidence for startup failure, health behavior, graceful SIGTERM, and termination during `BOOTING`.

Readiness intentionally remains unavailable in M1 because the real PostgreSQL readiness probe belongs to a later milestone.

## Runtime baseline

- Node.js policy: `>=24.16.0 <25`
- development and verification baseline: Node.js `24.19.0`
- npm: `11.17.0`
- NestJS: `11.1.28`
- default Express adapter
- TypeScript: strict mode
- ESM package semantics
- `NodeNext` module resolution

PostgreSQL and Prisma are deliberately deferred until M3.

## Verification

Using the pinned runtime baseline:

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test:unit
npm run test:process