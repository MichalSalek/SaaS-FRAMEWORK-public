# HTTP API

**English** | [Polski](README.pl.md)

`web-1/` implements the backend as a Next.js API application. It provides account,
portfolio, pairing, messaging, salon and administration operations. Prisma accesses
PostgreSQL; Better Auth handles authentication; Stripe handles subscriptions.

## Directory guide

| Path                          | Responsibility                                      |
| ----------------------------- | --------------------------------------------------- |
| `src/pages/api/v1/`           | Versioned endpoint handlers                         |
| `src/pages/api/auth/`         | Authentication routes and token exchange            |
| `src/domain/`                 | Business operations grouped by product area         |
| `src/application/`            | Request pipeline, database helpers and integrations |
| `src/prisma/`                 | Product database schema and migrations              |
| `src/prisma-app-logs/`        | Application log database schema                     |
| `src/READONLY-shared-kernel/` | Synchronized shared contract                        |
| `src/test-utils/`             | Test setup, fixtures and handler integration tests  |

## Request flow

`defineEndpoint` binds a contract to the shared request pipeline and its
business operation. Middleware checks transport, authentication, permissions,
account state and input. The operation returns data or a typed failure; the handler
selects the response and event.

Resource ownership is checked in the relevant operation. A route permission alone
does not establish access to an individual record. Webhooks and internal routes
use public or secret-based wrappers with their own transport requirements.

## Data consistency

Operations call Prisma through `DB_CLIENT`. Shared helpers provide transaction
settings, selected conflict retries, row locks and conditional updates. Database
constraints support invariants that must hold across concurrent requests.

Stripe webhook processing claims an event before applying changes. External context
is fetched before the transaction, and collected effects run after commit. Sweeps
handle maintenance and recovery of unfinished work.

## Errors and integrations

`OperationResult<T, E>` describes expected outcomes. The HTTP error mapper covers
registered domain error variants. Unexpected database and external service errors
are classified by application helpers before reaching the response boundary.

Adapters encapsulate external clients. Environment variables are declared and
validated centrally; domain code does not read arbitrary `process.env` values.

## Follow a stylist's decision

A request to accept a client reaches a [contract-bound endpoint](src/pages/api/v1/pairing/respond-request/index.ts). The handler gets the stylist account from the authenticated user and passes it to the [pairing operation](src/domain/pairing/operations/pair-request.operations.ts). The operation checks who owns the pending relationship and whether both accounts have room. Acceptance is a conditional database write. The [operation tests](src/domain/pairing/operations/pair-request.operations.respond.test.ts) exercise decisions at the level where the limits apply.

The [web application guide](../main/README.md) shows what each participant sees, and the [architecture overview](../README.md) connects the two sides of this request.

## Reading guide

- [Application services](src/application/README.md)
- [Domain operations](src/domain/README.md)
- [Contract-bound endpoint factory](src/application/http/define-endpoint.ts)
- [Request middleware](src/application/http/request.middleware.ts)
- [Favorites operations](src/domain/favorites/operations/favorite-records.operations.ts)
- [Backend tests](../tests/BACKEND_TESTING.md)

The export omits parts of the runtime and tooling needed to run the complete system.
