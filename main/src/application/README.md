# Frontend application services

**English** | [Polski](README.pl.md)

This layer provides services used across features: HTTP transport, authentication
state, response events, storage, translations, navigation and platform integration.
Keeping these concerns here lets screens focus on their own data and interactions.

## Main areas

| Directory                 | Responsibility                                                 |
| ------------------------- | -------------------------------------------------------------- |
| `http/`                   | Endpoint factories, query keys, QueryClient and error policies |
| `event-bus/`              | Response event processing and shared feedback                  |
| `auth/`                   | Session state, sign-in and native deep links                   |
| `client-device-storage/`  | Storage adapters, keys and initial theme setup                 |
| `stores/`                 | Shared client state, including navigation transitions          |
| `platform/`, `lifecycle/` | Browser and Capacitor adapters, app lifecycle                  |
| `environment/`            | Declared frontend environment configuration                    |

## Transport and state ownership

`http/io.ts` returns typed Promise functions. Domain declarations configure them;
feature hooks use them with TanStack Query. Cache changes and optimistic rollback
belong to those hooks. Shared response feedback belongs to the event pipeline unless
the screen explicitly owns it.

Registered query keys and storage keys give shared data a consistent identity.
A feature should reuse these definitions when reading or invalidating another
feature's data.

## Boundaries

This layer uses the shared kernel and infrastructure adapters. UI-specific state
and rendering stay in `UI/`. Platform helpers expose a browser fallback or a no-op
where a native capability is unavailable. Environment configuration is centralized
rather than read independently by each feature.

## Reading guide

- [Endpoint factories](http/io.ts)
- [Query keys](http/queryKeys.factory.ts)
- [Response pipeline](event-bus/eventPipeline.orchestrator.ts)
- [Frontend overview](../../README.md)
