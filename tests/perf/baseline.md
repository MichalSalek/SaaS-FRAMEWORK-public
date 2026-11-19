# Frontend performance checks

This document explains the performance checks represented in the repository.
Historical bundle measurements from 2026-06-14 predate later UI and dependency
changes and are not a current performance baseline.

## Bundle analysis

Run from a configured `main/` checkout:

```bash
npm run analyze
```

The command uses webpack mode for the bundle analyzer. Inspect shared JavaScript,
per-route chunks and the cost of new dependencies. The combined size of all route
chunks does not describe the download required for one page.

## Existing mechanisms

`optimizePackageImports` reduces selected package imports. Dynamic imports defer
selected heavy views. `next/font` configures local font delivery, and image helpers
select suitable runtime assets. Exact configuration lives in `main/next.config.mjs`
and the relevant modules.

`tests/audit/bundle-budget.sh` checks selected static conventions. It does not run
a build or measure transferred bytes, browser execution or user-facing Web Vitals.

## Verification after a change

Compare the affected routes using the same build and measurement conditions.
Measure loading and interaction in a browser when the change affects runtime cost.
Use `npm run qa:font-swap` from the root for the dedicated font-layout probe.
A current report should record the build, route, environment and measurement method.
