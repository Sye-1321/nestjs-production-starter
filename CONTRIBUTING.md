# Contributing

Implementation follows the frozen v1 specification and proceeds one milestone at a time.

For every change:

- use Node.js `24.19.0` and npm `11.17.0`;
- keep `package-lock.json` synchronized with `package.json`;
- preserve the current milestone boundary and frozen v1 scope;
- keep TypeScript strict and do not weaken lint/typecheck settings to make checks pass;
- run the complete verification gate before review.

Required gate:

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

The same commands run in GitHub Actions. Linux is authoritative for POSIX
signal and final-container behavior.

## Frozen specification

`docs/spec/v1-contract.md` is the frozen v1 architectural and behavioral contract. Do not edit or format it as part of normal implementation work. Any change requires an explicit reviewed specification/architecture decision before implementation.
