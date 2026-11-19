# Web application

**English** | [Polski](README.pl.md)

`main/` contains public pages, the signed-in application for stylists and clients,
salon features and the admin panel. It uses Next.js Pages Router, React, TanStack
Query, Zustand, CSS Modules and next-intl. The same web application can run in a
separate Capacitor Android shell.

## Directory guide

| Path                          | Responsibility                                                     |
| ----------------------------- | ------------------------------------------------------------------ |
| `src/pages/`                  | Route entry points and page data loading                           |
| `src/UI/features/`            | Screens, feature hooks and local components                        |
| `src/UI/components/`          | Shared components with declared atomic layers                      |
| `src/UI/layouts/`             | Public, application and administration layouts                     |
| `src/application/`            | HTTP transport, authentication state, events and platform services |
| `src/domain/`                 | Typed API declarations organized by business area                  |
| `src/READONLY-shared-kernel/` | Synchronized copy of the shared contract                           |
| `src/locales/`                | Polish, English and German interface translations                  |

## Data and feedback

A feature declares backend calls in `src/domain/` using the factories in
[`io.ts`](src/application/http/io.ts). Hooks use these functions with TanStack
Query and own cache invalidation and optimistic updates. Query keys come from
`src/application/http/queryKeys.factory.ts`.

The response event pipeline handles common feedback. A screen that provides its
own success or error feedback declares that ownership through the call options
or mutation metadata. This avoids duplicate messages without duplicating transport.

## Layout and access

Page files load data and mount feature compositions. The feature mounts its layout,
so loading, error and empty states share the same navigation frame. Client-side
guards redirect users according to session and role; the backend enforces access
to operations and individual resources.

Capacitor calls are wrapped in `src/application/platform/` and lifecycle helpers.
Components use those adapters rather than depending directly on Android behavior.

## Follow a profile interaction

The client opens a stylist profile and confirms a connection request. The profile hook owns the confirmation and calls a domain mutation. On success, the mutation invalidates access for this particular stylist and refreshes the client's pending list. The stylist reviews the request in a different workspace. The two views share an HTTP contract and keep their own display state. [Profile interaction](src/UI/features/stylist/hooks/useProfilePairRequest.ts) / [Pairing queries and mutations](src/UI/features/shared/pairing/hooks/usePairRequests.ts) / [Stylist screen](src/UI/features/pairing/StylistPairRequests.organism.tsx)

For the other side of this feature, the [API guide](../web-1/README.md) follows the acceptance decision into PostgreSQL. The [architecture overview](../README.md) connects both sessions to the product rule.

## Reading guide

- [UI architecture](src/UI/UI_ARCHITECTURE.md)
- [Application layer](src/application/README.md)
- [Domain declarations](src/domain/README.md)
- [Component layers](src/UI/components/ATOMIC_LAYERS.md)
- [Native integration](src/UI/NATIVE_INTEGRATION_GUIDE.md)
- [Favorites feature](src/UI/features/favorites/)

The export omits parts of the runtime and tooling needed to run the complete system.
