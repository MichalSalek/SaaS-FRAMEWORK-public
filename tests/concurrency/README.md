# Concurrency tests

**English** | [Polski](README.pl.md)

This suite sends parallel requests to the development API and checks the resulting
PostgreSQL state. It covers selected races involving counters, relationship
creation, moderation, plan changes and database error handling.

## Requirements

These tests need a configured API and a dedicated PostgreSQL environment. The export omits parts of the setup and is intended for reading.

## Structure

`run-concurrency.ts` registers the suites and coordinates teardown. `_harness.ts`
runs scenarios sequentially, while each scenario releases its own parallel burst.
`_fixtures.ts` scopes data to a run marker. Shared API and database utilities provide
barriers, readers and cleanup.

## Reading guide and limits

- [Gallery delete and moderation](gallery-delete-moderation.concurrency.ts)
- [Prisma advisory-lock integration](advisory-xact-lock.concurrency.ts)
- [Parallel request helpers](../utils/api-client.ts)

Assertions cover the specified races and database state. They do not prove that
all possible schedules or database conflicts are covered.
