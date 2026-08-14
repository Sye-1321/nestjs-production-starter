# Security

This repository implements a deliberately small service security baseline. It
does not claim that application controls replace deployment security, database
operations, backups, network policy, or platform hardening.

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
- Dependabot proposes grouped npm, Docker, and GitHub Actions updates.
- Every external workflow action is pinned to a full commit SHA with its release
  version recorded on the same line.
- Trivy scans the final runtime image. One pass reports all HIGH and CRITICAL
  findings. A second pass blocks fixable HIGH and CRITICAL findings by using
  `ignore-unfixed: true` with a failing exit code.

There is no vulnerability ignore file in v1. Any future exception must identify
the exact finding and include a rationale, reviewer, and expiry date. A broad
class-level suppression is not acceptable.

## Deliberate boundaries

The sample Task API has no principal or authorization requirement, so v1 does
not add JWT or imply that authentication alone makes a service production-ready.
CORS and proxy trust remain disabled by default, and the insecure Node HTTP
parser is never enabled.
