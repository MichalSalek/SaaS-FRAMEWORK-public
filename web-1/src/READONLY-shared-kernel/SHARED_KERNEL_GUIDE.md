# Shared kernel

This directory defines the contract used by the web app and API. It contains
shared types and pure policies, with no database access or UI implementation.
Both applications import synchronized copies through the `@kernel/*` alias.

## Responsibilities

| Directory      | Contents                                                       |
| -------------- | -------------------------------------------------------------- |
| `application/` | Result types, common errors, role grants and shared primitives |
| `domain/`      | Routes, methods, events, configuration and domain error types  |
| `models/`      | Generated model types and request/response DTOs                |
| `policies/`    | Validation, pricing, routing and other pure policies           |
| `config/`      | Shared test-user configuration                                 |

React components, network calls, Prisma operations and service clients remain in
the applications. The kernel's Zod imports are resolved by each application's
dependencies; the kernel is not published as an independent package.

## Why the contract is shared

A request type is used by the handler and by the client declaration. A response
type can be used by the handler's response helpers and by the consuming hooks.
Changing a field therefore exposes affected typed call sites during compilation.
Routes, methods, events and permissions use corresponding registry keys, with
audits checking their relationships.

This reduces separately maintained definitions. It does not validate arbitrary
network data or establish compatibility between independently deployed versions.

## Generated types and validation

`scripts/generate-dto/index.ts` reads `web-1/src/prisma/schema.prisma` and writes
`models/db_models.generated.dto.ts`. Generator configuration controls scalar
mappings, field overrides and enums maintained by the kernel. Hand-written types
remain in `models/db_models.manual.dto.ts` and domain DTO files.

Zod schemas validate request input. `AssertTrue<SchemaMatchesDto<...>>` witness
types compare selected schemas with their request DTOs. The validator adapter
returns field-level translation keys. For a contract-bound command, the middleware
passes the parser's output to the handler, including any normalization declared
in the schema. Development and test handlers also check successful responses
against the contract's schema and events.

## Synchronization

In a configured development checkout, run from the repository root:

```bash
npm run system:generate-dto  # after changing the Prisma schema
npm run system:contracts     # regenerate registries after a contract edit
npm run system:kernel        # copy the kernel to both applications
npm run system:kernel:full   # run both generators, then synchronize the copies
```

Edit the source in `.shared-kernel/`, then propagate it to
`main/src/READONLY-shared-kernel/` and `web-1/src/READONLY-shared-kernel/`.
In this snapshot, `scripts/kernel/cp-kernel` uses rsync to mirror the kernel
into each application directory. `tests/audit/kernel-sync.sh` checks the copies
against the source. Both applications are included as regular directories here.

## Events and permissions

`domain/events/app-events.const.ts` groups commands, queries, informational outcomes
and confirmation events. Corresponding keys connect routes, methods, DTOs and role
grants. System API grants are defined in `application/role-permissions.ts`;
frontend visibility rules are in `domain/permissions/permissions.config.ts`.

An endpoint grant does not replace resource ownership or relationship checks in
the API operation.

## Reading guide

Paths below are relative to the kernel, including when reading a synchronized copy:

- [Result types](application/result.types.ts)
- [Routes](domain/routing/routing.config.ts)
- [HTTP methods](domain/http/http-methods.config.ts)
- [Favorites DTOs](models/favorites/favorite.dto.ts)
- [Favorites validation](policies/validation/favorite.validation.ts)
- [Role grants](application/role-permissions.ts)
