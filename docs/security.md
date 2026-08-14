# Security

This repository implements a deliberately small service security baseline. It
does not claim that application controls replace deployment security, database
operations, backups, network policy, or platform hardening.

Vulnerability reporting instructions are maintained separately in the root
[`SECURITY.md`](../SECURITY.md).

## Application boundary

The HTTP service enables Helmet, rejects unknown DTO fields, enforces a 100 KiB
JSON limit, requires JSON media types for Task writes, and configures explicit
Node receive/keep-alive timeouts. CORS and Express proxy trust remain disabled,
and the insecure Node HTTP parser is never enabled. These defaults reduce the
public parser/transport surface; they do not provide tenant isolation or access
control.

RFC 9457 responses expose only catalogue-controlled fields. Unexpected failures,
PostgreSQL details, stack traces, parser metadata, and rejected values are
sanitized. The process and end-to-end suites inject canary credentials, bodies,
headers, query strings, IDs, and nested errors, then assert that none appear in
public payloads or captured process output.

Request IDs are untrusted correlation values. Duplicate, malformed, or oversized
input is replaced, and an accepted value is never used as a user/principal,
authorization decision, database key, or metric label. Route metrics likewise
use registered templates or one fixed unmatched label instead of raw paths.

## Database controls

The application uses one bounded PostgreSQL pool with explicit acquisition and
server-side statement limits. Database connection strings are accepted only from
the deployment environment and are excluded from structured events and public
errors. Operators should provision an application role with only the privileges
required by the committed Task schema and use a separately controlled migration
job for schema changes.

Timeouts constrain resource use but are not authorization controls. V1 also does
not claim that its driver terminates every silent half-open network operation
after query dispatch.

## Secret handling

Production secrets are injected by the deployment environment. The image does
not copy `.env` files, and local `.env` variants are ignored by both Git and the
Docker build context. `.env.example` contains placeholders only.

Do not commit credentials, access tokens, private keys, production hostnames, or
real customer data. The application also excludes raw request bodies, header
maps, database URLs, and nested error objects from its structured logs.

## Repository security settings

The following settings were verified through the GitHub repository API on
2026-08-14 for `Sye-1321/nestjs-production-starter`:

| Setting                         | Required | Verified state |
| ------------------------------- | -------- | -------------- |
| Repository visibility           | n/a      | Public         |
| GitHub secret scanning          | Yes      | Enabled        |
| Secret scanning push protection | Yes      | Enabled        |

These controls are repository settings rather than source-controlled files.
Releases must recheck them under **Settings -> Code security and analysis**, or
with:

```sh
gh api repos/Sye-1321/nestjs-production-starter --jq .security_and_analysis
```

If the repository moves to an account or plan that does not support a setting,
the release review must record that limitation instead of claiming the control
is enabled.

## Dependency and image controls

- Pull requests run dependency review at HIGH severity.
- CodeQL analyzes JavaScript and TypeScript.
- Dependabot groups only routine npm patch/minor maintenance. Prisma/pg,
  TypeScript, Node typings, and Testcontainers changes remain individual for
  explicit compatibility review, and `@types/node` stays on the Node 24 line.
- Docker base-image and GitHub Actions updates remain individual so digest and
  full-SHA changes are visible in their own pull requests.
- Every external workflow action is pinned to a full commit SHA with its release
  version recorded on the same line.
- Trivy scans the final runtime image. One pass reports all HIGH and CRITICAL
  findings. A second pass blocks fixable HIGH and CRITICAL findings by using
  `ignore-unfixed: true` with a failing exit code.

The final image uses an immutable Node 24 Debian-slim base, installs a minimal
init, and runs as the non-root `node` user. Multi-stage construction keeps
source, tests, development dependencies, package-manager tooling, source maps,
Git metadata, and environment files out of the runtime. The image contract
inspects these properties, while a separate test sends a real SIGTERM through
PID 1 and requires a natural successful drain.

There is no vulnerability ignore file in v1. Any future exception must identify
the exact finding and include a rationale, reviewer, and expiry date. A broad
class-level suppression is not acceptable.

## Deliberate boundaries

The sample Task API has no principal or authorization requirement, so v1 does
not add JWT or imply that authentication alone makes a service production-ready.
CORS and proxy trust remain disabled by default, and the insecure Node HTTP
parser is never enabled.

The starter does not ship TLS termination, a web application firewall, network
policy, database encryption/backups, a secret manager, container signing,
provenance attestation, SBOM publication, runtime intrusion detection, or
incident-response automation. A deployment may require these controls, but
source code must not imply they are present until the platform supplies and
verifies them.

Security findings must be fixed in the smallest owning layer and covered by a
regression check where practical. V1 has no vulnerability ignore file. A future
exception must name the exact finding, affected artifact, rationale, reviewer,
and expiry; a scanner/database download failure is never recorded as a clean
result.
