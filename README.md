# NestJS Production Starter

A compact executable reference for the operational contract of a NestJS HTTP service.

## Milestone status

This repository is currently at **M0 — Repository Foundation**. M0 establishes only the runtime, framework, TypeScript, package-management, and repository-tooling baseline. It does not yet implement the production lifecycle or application feature contract.

## Runtime baseline

- Node.js policy: `>=24.16.0 <25`
- M0 development/CI patch baseline: Node.js `24.19.0`
- npm baseline: `11.17.0`
- NestJS baseline: `11.1.28` using the default Express adapter
- TypeScript: strict mode, ESM package semantics, `NodeNext` module resolution
- Prisma baseline reserved for M3: `7.9.1` (not installed or implemented in M0)

The ESM/`NodeNext` strategy is intentional so the repository foundation is compatible with the frozen Prisma 7 direction without introducing Prisma before M3.

## M0 verification

Use the pinned Node.js baseline and run:

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run build
```

## Scope boundary

M0 intentionally contains no configuration validation, lifecycle state machine, signal coordination, health endpoints, PostgreSQL/Prisma implementation, Task API, request context, structured application logging, Problem Details mapping, metrics, containers, or later-milestone CI/security workflows.

The frozen v1 implementation contract belongs at `docs/spec/v1-contract.md`.
