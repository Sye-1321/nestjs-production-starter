# Security policy

## Supported versions

The current `1.x` release line receives security fixes. Pre-release history and
older unsupported versions do not receive separate fixes.

## Reporting a vulnerability

Do not report exploitable vulnerabilities, proof-of-concept details,
credentials, or sensitive environment information in a public issue or pull
request.

Use [GitHub private vulnerability reporting](https://github.com/Sye-1321/nestjs-production-starter/security/advisories/new)
to submit the affected version, impact, reproduction conditions, and a minimal
safe proof of concept. If that private form is unavailable, contact the
repository owner through a private channel listed on their GitHub profile
before sharing vulnerability details.

Reports are evaluated on a best-effort basis. This project does not promise a
response or remediation SLA.

## Scope

Reports should concern code, dependencies, workflows, or the runtime image in
this repository. Deployment-owned controls such as TLS termination, secret
delivery, network policy, PostgreSQL operations, backups, and orchestration are
outside the repository's implemented security boundary unless the issue is
caused by repository guidance or code.

For the implemented security controls, evidence, and explicit claim boundaries,
see [`docs/security.md`](docs/security.md).
