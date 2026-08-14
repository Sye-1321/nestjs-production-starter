# Contributing

Changes must preserve the frozen v1 contract, its explicit scope, and the
evidence hierarchy described in `docs/testing.md`.

## Runtime and install

Use Node.js 24.19.0 and npm 11.17.0. Install only from the committed graph:

```sh
npm ci
```

Keep `package.json` and `package-lock.json` synchronized. Do not weaken strict
TypeScript, ESLint, formatting, timeout, vulnerability, or test settings to make
a change pass.

## Change discipline

- Keep each commit to one meaningful unit of behavior, evidence, documentation,
  or policy.
- Use an imperative Conventional Commit subject such as `feat(metrics): ...`,
  `test(shutdown): ...`, or `docs(operations): ...`.
- Preserve existing user work and avoid unrelated cleanup in a focused change.
- Add evidence at the lowest layer capable of falsifying the production claim;
  do not substitute mocks for PostgreSQL, socket, signal, or container behavior.
- Update `docs/traceability.md` when implementation, exact test names, or CI job
  ownership changes. Its unit guard must continue to pass.
- Document new operational ownership and failure behavior before adding a new
  mechanism to the starter.

## Required gate

Run the complete gate before review:

```sh
npm ci
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

The same commands run in GitHub Actions. Docker is required for PostgreSQL and
container suites. Linux CI is authoritative for POSIX `SIGTERM`; Windows skips
only those explicitly identified signal cases.

Dependency changes must also pass dependency review, CodeQL, and the container
vulnerability policy. External Actions remain full-SHA pinned with a nearby
human-readable version comment.

Dependabot groups only routine patch/minor npm maintenance. Prisma/pg,
TypeScript, Node typings, and Testcontainers updates remain individual because
they can change observed failure shapes, compiler compatibility, the supported
Node surface, or infrastructure-test behavior. `@types/node` stays on the Node
24 line. Any change to those boundaries must revalidate the owning contract and
real-boundary evidence; Docker and GitHub Actions updates must retain their
digest or full-SHA pins.

## Frozen specification

`docs/spec/v1-contract.md` is byte-guarded as the approved v1 architectural and
behavioral contract. Do not edit, format, or regenerate it during normal work.
A change requires an explicit reviewed specification revision before its
implementation and traceability disposition change.

## Review checklist

- Does the change remain inside the stated v1 scope?
- Is lifecycle/resource ownership unambiguous on success and failure?
- Are public errors, logs, metrics, and configuration output still bounded and
  free of sensitive values?
- Does the test exercise the real boundary behind the claim?
- Are local commands, CI jobs, operations/security docs, and traceability still
  accurate?
- Is the worktree clean and the full gate green from an exact install?
