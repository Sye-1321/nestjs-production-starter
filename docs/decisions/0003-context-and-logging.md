# ADR-0003: Request context, logging, and sensitive data

- Status: Accepted
- Date: 2026-08-14

## Context

Concurrent requests need correlation and client-disconnect cancellation without
request-scoped dependency injection. At the same time, untrusted headers, URLs,
and bodies must not become identities, unbounded metric labels, or accidental
log records.

## Decision

The runtime baseline is Node.js >=24.16 so every incoming request has Node's
native `request.signal`. The application carries that signal and a request ID in
`AsyncLocalStorage`, installed by the earliest application middleware. Services
can read the current context without mutable globals or request-scoped provider
graphs.

Request-ID parsing uses Node's duplicate-aware `headersDistinct` view. An
incoming `x-request-id` is accepted only when exactly one field value exists and
it matches `[A-Za-z0-9._:-]{1,64}`. Missing, duplicate, empty, oversized, or
otherwise invalid input is replaced with a generated UUID. The selected value is
returned in the response.

A request ID is correlation data only. It must never become authentication,
principal identity, authorization input, a persistence key, or a metric label.
Tests send duplicate raw header field lines because a comma-joined convenience
view cannot prove the duplicate policy.

Pino emits newline-delimited structured JSON to stdout. Request completion uses
an explicit allowlist: event, level, request ID, normalized method, registered
route template/fixed `UNMATCHED` label, HTTP status, and bounded duration. Safe
error events likewise expose catalogue-controlled classifications rather than
arbitrary exception objects.

The application never logs request or response bodies, raw URLs/query strings,
header maps/authorization values, database URLs, stack traces, rejected
configuration values, or nested errors. Unmatched requests use `UNMATCHED`; they
do not log or label the attacker-controlled path.

Canary tests inject distinct secrets into headers, bodies, query strings,
database URLs, validation values, parser metadata, IDs, and nested exceptions.
They capture complete child-process output and public responses and require
every canary to be absent. A normal 100-request concurrency harness also proves
response and completion-log IDs remain isolated across interleaved PostgreSQL
success and rejection paths.

## Consequences

- Context remains available across asynchronous boundaries without request
  scope overhead.
- Client disconnect cancellation uses the signal owned by Node's HTTP request
  lifecycle rather than a socket-close approximation.
- Duplicate-aware parsing and a 64-character allowlist bound untrusted
  correlation input.
- Logging and metrics sacrifice raw-path detail to preserve confidentiality and
  cardinality bounds.
- New log fields require an explicit safety decision and canary evidence; logging
  arbitrary request/response/error objects is prohibited.
