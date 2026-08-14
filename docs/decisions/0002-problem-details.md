# ADR-0002: RFC 9457 public error contract

- Status: Accepted
- Date: 2026-08-14

## Context

Default framework and driver exceptions expose inconsistent shapes and can leak
implementation details. Clients need stable machine-readable errors without
coupling to Nest, Express, Prisma, PostgreSQL, or JavaScript exception messages.

## Decision

Public Task and HTTP-boundary failures use RFC 9457 Problem Details with
`application/problem+json`. Catalogue entries own `type`, `title`, `status`,
`detail`, and stable application `code` values. Types use version-independent
URNs under `urn:nestjs-production-starter:problem:*`; JavaScript class names,
routes, and documentation URLs are not type identities.

The supported extension members are:

- `code`: a stable machine-readable catalogue code;
- `requestId`: the current correlation token;
- `errors`: optional safe field-level validation issues.

`errors` appears only when a client can correct a specific submitted field. It
does not carry rejected values, validator objects, nested exceptions, or stack
traces.

The transport/domain boundary is explicit. The concrete Task service throws
domain failures such as not-found; database infrastructure classifies only
recognized acquisition/statement conditions; HTTP middleware classifies media
type, JSON parsing, size, and draining failures. One exception filter translates
those known failures to catalogue entries. Unknown failures become sanitized
`INTERNAL_ERROR` responses and are logged once through a bounded safe event.

Public payloads never expose exception messages, stack traces, PostgreSQL codes
or SQL, database URLs, body/parser metadata, header values, internal IDs, or
nested error objects. The `instance` member is omitted because raw request URLs
can contain attacker-controlled or sensitive query data.

Health endpoints are the deliberate exception. They return only
`{ "status": "live" }`, `{ "status": "ready" }`, or
`{ "status": "not_ready" }` so orchestrator probes retain their tiny stable
contract instead of receiving Problem Details.

## Consequences

- Clients depend on catalogue codes and URNs rather than framework text.
- Domain code remains independent of HTTP response construction.
- Adding an error requires a catalogue decision and contract evidence.
- Unexpected operational detail remains observable in bounded internal events
  without crossing the public boundary.
- Health probes require an explicit bypass in the global filter and tests that
  prevent accidental conversion.
