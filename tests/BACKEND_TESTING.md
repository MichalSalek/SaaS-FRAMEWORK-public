# Backend testing

Vitest checks policies, domain operations and handler behavior without requiring
a running API. Mocked I/O makes these tests suitable for local checks, while
real database behavior is covered separately.

## Test categories

| Category                     | Location                                | Main assertions                                         |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------- |
| Pure policies                | `web-1/src/test-utils/kernel-policies/` | Limits, state transitions, permissions and validators   |
| Domain and application units | Beside the implementation               | Result variants and relevant collaborator calls         |
| Handler integration          | `web-1/src/test-utils/integration/`     | HTTP status, response event and selected payload fields |

Paths in this table are relative to the repository root. Keep tests outside
`src/pages/`, where Next.js treats TypeScript files as routes.

## Handler harness

`web-1/src/test-utils/setup.ts` replaces database access, session lookup,
permission lookup and deferred runtime work. Other middleware behavior runs through
the real request pipeline. `mockDb` exposes configured model behavior and reports
unexpected access to unstubbed models.

A permission override can force allow or deny; the neutral setting uses the kernel
role matrix. Typed fixtures provide session and account state. Test cleanup resets
holders so scenarios do not share state accidentally.

## What to assert

Check the business boundary, failure variant and response contract fields that
matter to the caller. Include identity and resource-access cases. A request body
must not override the authenticated actor. For regressions, confirm that a relevant
incorrect implementation makes the test fail.

Avoid complete response snapshots and assertions on log formatting. Pure-policy
tests should not need Prisma. Test code uses the same strict TypeScript rules as
the application.

## Mock boundaries

A mocked transaction does not establish rollback, locking or driver semantics.
Use the [concurrency suite](concurrency/README.md) for those properties, including
the actual Prisma adapter where the integration is relevant.

## Export limits

This sample omits parts of the runtime and tooling needed to run the full test suite.

## Reading guide

- [Vitest configuration](../web-1/vitest.config.ts)
- [Setup](../web-1/src/test-utils/setup.ts)
- [Handler helper](../web-1/src/test-utils/mockApiHandler.ts)
- [Gallery operation test](../web-1/src/domain/gallery/operations/gallery-create.operation.test.ts)
