# Tests

**English** | [Polski](README.pl.md)

This sample includes tests alongside application code and selected cross-application suites. Their presence does not establish that they were executed for this export.

## Reading guide

- [Pair request operation tests](../web-1/src/domain/pairing/operations/pair-request.operations.respond.test.ts) cover acceptance, rejection and limits.
- [Pairing contract tests](../web-1/src/test-utils/integration/pairing-contract.test.ts) exercise selected API responses.
- [Concurrency tests](concurrency/README.md) send parallel requests and inspect database state.
- [Browser tests](e2e/README.md) describe selected Playwright journeys.
- [Structural checks](audit/README.md) explain the included audit sources.

## Limits

Some tests require a configured API, PostgreSQL, external services or browser dependencies. The export omits the complete runtime and operational tooling, so it is a reading sample rather than a ready-to-run test environment. Tests cover specified scenarios, not every possible execution or integration outcome.
