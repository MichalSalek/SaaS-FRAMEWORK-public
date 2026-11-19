# Backend application services

**English** | [Polski](README.pl.md)

This layer implements HTTP handling and shared infrastructure used by domain
operations. It includes authentication, permissions, database helpers, billing,
email, logging, environment validation and maintenance scheduling.

## Main areas

| Directory                   | Responsibility                                                     |
| --------------------------- | ------------------------------------------------------------------ |
| `http/`                     | Handler factories, request middleware, responses and error mapping |
| `auth/`, `permissions/`     | Better Auth integration and role permission lookup                 |
| `db/`                       | Prisma access, transactions, locks and conditional writes          |
| `errors/`                   | Conversion of database and external failures to typed results      |
| `stripe/`                   | Billing adapter, webhook handling and recovery                     |
| `email-handler/`            | Email transport and provider adapters                              |
| `event-log/`, `debugger/`   | Audit events and diagnostic logging                                |
| `interceptors/`, `runtime/` | Maintenance sweeps and tracked deferred work                       |
| `environment/`              | Environment declarations and validation                            |

## Shared primitives

`defineHandler` composes timing and the versioned request pipeline. The handler
still chooses its success response and maps an unsuccessful operation result.
`withPublicHandler` and `withRawSecretHandler` serve routes outside that pipeline.

`withWriteTx` centralizes write-transaction settings and selected retries. Its
callback must avoid external side effects because a retry executes it again.
Row-lock helpers document ordering; `cas.ts` provides conditional updates.
Prisma errors are recognized structurally rather than through `instanceof`, which
can be unreliable across bundled module instances.

## Integrations and background work

External clients are accessed through adapters. Stripe handlers collect effects
for execution after commit. Maintenance uses a sweep factory with throttling and
monitoring; work needing cross-instance exclusion adds database coordination.
`runAfterResponse` tracks deferred tasks for shutdown draining.

Product data and application logs use separate Prisma clients. Diagnostic logging
is best effort. Environment validation classifies required and optional values;
strict environments stop startup for invalid required configuration.

## Boundaries and limits

The layer primarily depends on the kernel and its adapters. Selected orchestration
files import domain code under documented ESLint exceptions. Central helpers reduce
duplication but still need behavioral tests and review at each integration boundary.

## Reading guide

- [Handler factory](http/define-handler.ts)
- [Request middleware](http/request.middleware.ts)
- [Error mapper](http/error-mapper.ts)
- [Write transactions](db/with-write-tx.ts)
- [Row locks](db/lock-rows.ts)
- [API overview](../../README.md)
