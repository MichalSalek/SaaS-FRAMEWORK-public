# Backend domain operations

**English** | [Polski](README.pl.md)

Each directory represents a product area such as gallery, pairing, favorites or
messaging. Operations implement its reads and writes, while pure helpers describe
local decisions. Shared transport and service clients live in `application/`.

## Structure

```text
domain/<area>/
  operations/              reads, writes and shared operation steps
  <name>.resolver.ts       pure decision logic
  <name>.guards.ts         predicates and access checks
  <area>.config.ts         local configuration
  <area>.types.ts          local types
```

Small areas may keep files directly in their directory. `_shared/guards/` holds
reused account guards. File roles vary with the needs of each area.

## Operation results

Operations that return `OperationResult` use the `_IO` suffix. Expected failures
are declared in kernel error unions, and the HTTP mapper gives registered variants
a response. `databaseFailure()` classifies thrown database failures. Transaction
rollback signals are caught within the relevant operation.

The handler owns HTTP status and response construction. An operation checks the
business rule and resource access, then returns its result without rendering HTTP.

## Database access

Operations call Prisma directly through `DB_CLIENT`. This keeps transaction scope
visible without a general repository wrapper. Shared helpers provide row locks,
conditional updates and selected retries. Access checks that can race with a write
need an appropriate transaction or database barrier, not only an earlier lookup.

User identity and stylist accounts are separate areas because they have different
lifecycles. The kernel groups part of their API contract under `user-and-account`.

## Reading guide

- [Favorites operations](favorites/operations/favorite-records.operations.ts)
- [Gallery creation](gallery/operations/gallery-create.operation.ts)
- [Pair requests](pairing/operations/pair-request.operations.ts)
- [Account guards](_shared/guards/account-guards.ts)
- [Application services](../application/README.md)
- [API overview](../../README.md)
