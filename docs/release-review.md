# V1 release review

- Review date: 2026-08-14
- Release disposition: **PASS**
- Accepted productization commit: `2e9cb179596a37b9c243bbccba4dc324c8725e62`
- Accepted tree: `c62121db7a120a15e00a876652eccf127015174c`
- Contract: `docs/spec/v1-contract.md` (frozen and byte-guarded)
- Contract Git blob SHA-1: `c40f8382adc998365c52604102a7b595cd5b2cf0`

Pull request [#4](https://github.com/Sye-1321/nestjs-production-starter/pull/4)
merged the six focused productization commits without squashing. Its candidate
commit, `0463a36dbbf25ec5c3dda13c0ee4429bc3bf99b7`, and the accepted merge commit
have the same Git tree. The acceptance-record commit necessarily follows the
tree it reviews and changes only this evidence document; the release tag may be
created only after that record is merged and its required checks pass.

## Clean-checkout acceptance

A detached Git worktree was created from the accepted candidate without copied
dependencies, generated Prisma client, build output, or uncommitted state. All
documented and CI commands ran there. A clean status was confirmed before the
worktree was removed.

| Gate                                  | Result | Evidence                                                            |
| ------------------------------------- | ------ | ------------------------------------------------------------------- |
| `npm ci`                              | PASS   | 513 packages installed; audit reported 0 vulnerabilities            |
| `npm run format:check`                | PASS   | all tracked files matched Prettier                                  |
| `npm run lint`                        | PASS   | ESLint completed with 0 warnings and 0 errors                       |
| `npm run typecheck`                   | PASS   | strict no-emit TypeScript check                                     |
| `npm run build`                       | PASS   | Prisma generation and production compilation                        |
| `npm run test:unit`                   | PASS   | 209 passed; 0 failed, skipped, or todo                              |
| `npm run test:integration`            | PASS   | 4 passed against migrated PostgreSQL                                |
| `npm run test:e2e`                    | PASS   | 7 passed against real HTTP and PostgreSQL                           |
| Windows `npm run test:process`        | PASS   | 10 passed; 6 declared authoritative-Linux skips                     |
| Linux `npm run test:process`          | PASS   | 16 passed; 0 failed or skipped, using the pinned Node 24 image      |
| `npm run test:container`              | PASS   | 2 passed; non-root final image and real PID 1 SIGTERM drain         |
| `npm audit` / `npm audit --omit=dev`  | PASS   | 0 vulnerabilities in both dependency graphs                         |
| explicit final-image build/inspection | PASS   | runtime-only contents and unprivileged `node` user confirmed        |
| README quick start                    | PASS   | migration, build, live/ready probes, and Task create/read succeeded |

Linux is the authoritative POSIX signal evidence. The host skips are limited to
the six cases declared `requires authoritative Linux SIGTERM`; they are neither
unexplained nor substituted by Windows results. The Linux process job migrated
its fresh database externally and passed every process case. The container test
separately exercised real Linux PID 1 and bounded graceful shutdown.

The clean checkout also passed the frozen-spec hash, traceability contract,
package/lockfile version synchronization, Docker Compose validation, local
Markdown-link validation, generated-state check, secret-pattern scan, and
`git diff --check`. The committed README flow was repeated exactly through a
successful Task create/read.

## GitHub acceptance

The productization candidate passed all pull-request gates on 2026-08-14:

- CI run
  [31824801295](https://github.com/Sye-1321/nestjs-production-starter/actions/runs/31824801295):
  quality/unit, PostgreSQL integration, HTTP end-to-end, Linux process, and final
  container contract passed;
- dependency-review run
  [31824801265](https://github.com/Sye-1321/nestjs-production-starter/actions/runs/31824801265)
  passed;
- CodeQL run
  [31824801224](https://github.com/Sye-1321/nestjs-production-starter/actions/runs/31824801224)
  passed;
- final-image security run
  [31824801189](https://github.com/Sye-1321/nestjs-production-starter/actions/runs/31824801189)
  passed.

After merge, the accepted `main` commit passed its push workflows independently:

- CI run
  [31825021712](https://github.com/Sye-1321/nestjs-production-starter/actions/runs/31825021712);
- CodeQL run
  [31825021730](https://github.com/Sye-1321/nestjs-production-starter/actions/runs/31825021730);
- final-image security run
  [31825021720](https://github.com/Sye-1321/nestjs-production-starter/actions/runs/31825021720).

## Requirement disposition

`docs/traceability.md` contains 122 `PASS` rows, exactly one for every normative
ID from `CFG-001` through `CI-010`. The automated traceability contract proves:

- the ID set and order exactly match the frozen specification;
- every status is `PASS`;
- every named implementation path exists;
- every quoted evidence title exists verbatim in the test sources;
- every named Actions job exists in the committed workflows.

The audit rechecked the Prisma/PostgreSQL failure classifier against the pinned
versions and its unit/integration evidence. Recognized failures retain their
bounded public mapping, unknown failures remain sanitized `500` responses, and
no classifier change was required.

## Repository and security disposition

GitHub reported the standard root license as MIT. The repository description and
12 topics are set, Template remains off, and merged branches are deleted
automatically. Private vulnerability reporting, secret scanning, and secret
scanning push protection are enabled.

`main` is protected for administrators and requires an up-to-date pull request,
resolved conversations, and these eight checks:

- Quality and unit tests;
- PostgreSQL integration tests;
- HTTP end-to-end tests;
- Linux process tests;
- Final container contract;
- Dependency review;
- Analyze JavaScript and TypeScript;
- Scan final runtime image.

Force pushes and branch deletion are disabled. The solo-owner repository uses
zero mandatory approvals while retaining pull-request and required-check gates.

The repository has dependency review, CodeQL, reporting/blocking Trivy passes,
full-SHA Action pins, and restrained Dependabot automation. Routine npm
patch/minor updates may be grouped; Prisma/pg, TypeScript, Node typings,
Testcontainers, Docker base images, and Actions remain explicit updates.

## Final scope audit

The audit found no architectural or runtime change was required. In particular,
v1 still has one tiny Task slice, externally applied migrations, fail-before-listen
startup, explicit readiness/draining semantics, one shutdown owner, bounded RFC
9457 errors, low-cardinality metrics, structured redacted logs, and a non-root
runtime-only container.

No authentication, authorization, CORS policy, proxy trust, cache, queue,
generic repository layer, fake transaction abstraction, in-process migration,
Kubernetes manifest, Helm chart, published image, or unsupported production
claim was added. Deployment TLS, network policy, secret management, backups,
silent half-open transport after statement dispatch, and published-artifact
provenance remain documented boundaries rather than hidden promises.

## Conclusion

M0 through M7 and the v1 productization pass are complete. The accepted tree is
green locally, on authoritative Linux, in the final container, and on merged
`main`. All 122 normative requirements remain `PASS`; the frozen contract and
architectural scope are unchanged. No implementation blocker remains for the
`v1.0.0` tag and GitHub Release after this evidence record passes the protected
merge and final `main` workflows.
