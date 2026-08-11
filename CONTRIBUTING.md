# Contributing

Implementation follows the frozen v1 specification and proceeds one milestone at a time.

For M0 changes:

- use Node.js `24.19.0` and npm `11.17.0`;
- keep `package-lock.json` synchronized with `package.json`;
- do not introduce functionality assigned to M1 or later;
- keep TypeScript strict and do not weaken lint/typecheck settings to make checks pass;
- run the complete M0 verification gate before review.

Required gate:

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run build
```

## Frozen specification

`docs/spec/v1-contract.md` is the frozen v1 architectural and behavioral contract. Do not edit or format it as part of normal implementation work. Any change requires an explicit reviewed specification/architecture decision before implementation.
