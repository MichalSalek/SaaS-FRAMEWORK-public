# Domain Layer (frontend)

**Lokalizacja:** `main/src/domain/`
**Stack:** TanStack Query v5 + Zustand v5 + native fetch (post-migration 2026-05-10).

---

## Co tu jest

`domain/` to **IO adaptery dla frontendu** — typowane wrappery nad endpointami z `.shared-kernel/` plus drobne utility/policy funkcje. NIE jest to czysta logika biznesowa (ta żyje w `.shared-kernel/policies/`).

Każdy moduł (`gallery/`, `pairing/`, `account/`, …) reprezentuje bounded context i eksponuje:

- `{module}IO.possibilities.api.ts` — funkcje `{action}_IO` zbudowane przez unified promise-first front-door `defineEndpoint` / `defineQuery` / `definePathEndpoint` z `application/http/io.ts` (każda zwraca `(req, options?) => Promise<Res>`, gotowa do `queryFn`/`mutationFn` bez `toPromise`). Deprecated fabryki `createIOFunction`/`createEndpointIO`/`createQueryIOFunction`/`createPathParamIOFunction` USUNIĘTE w FDX FAZA 2 (W2.5).
- `{module}IO.operations.api.ts` — operacje wieloetapowe (np. Cloudinary upload + DB save).
- `{module}.utils.api.ts` / `{module}.config.ts` / `{module}.types.ts` — opcjonalne pomocniki.

**Brak Redux. Brak callbacków `successCallback`/`errorCallback` w normalnym kodzie** — żyją wyłącznie
w escape hatchu `callHTTPEndpoint` (kilka jawnych wyjątków, patrz sekcja Importy niżej + EXCEPTIONS
w `io.ts`). Nowy call NIGDY nie zaczyna się od `callHTTPEndpoint`.

---

## Wzorzec użycia

UI woła hook z TQ v5. `{action}_IO` jest już promise-first — używa się go wprost
w `queryFn`/`mutationFn` (bez `toPromise` przy call-site):

```ts
// UI/features/[domain]/hooks/use{Action}.ts
import { queryOptions, useQuery } from '@tanstack/react-query';
import { get{Thing}_IO } from '../../../../domain/{module}/{module}IO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

const {thing}QueryOptions = queryOptions({
  queryKey: queryKeys.{module}.{slot},
  queryFn: ({ signal }) => get{Thing}_IO(input, { signal }),
});

export function use{Thing}() {
  return useQuery({thing}QueryOptions);
}
```

`queryKeys` (SSOT) → `main/src/application/http/queryKeys.factory.ts`.

---

## Importy

| Cel                                              | Ścieżka                                         |
| ------------------------------------------------ | ----------------------------------------------- |
| Shared kernel (DTO, eventy, endpointy, policies) | `@kernel/*` (alias do `READONLY-shared-kernel`) |
| Application (HTTP, stores, http endpoints)       | `../../application/*`                           |
| Cross-domain                                     | `../{other-module}/*`                           |

Cały dostęp do danych deklaruje się przez unified `application/http/io.ts`
front-door, w warstwie `domain/**` (lub `application/**` dla cross-cutting IO jak
feature-flags). UI **nie** tworzy IO ani nie importuje `ENDPOINTS` bezpośrednio —
hook importuje gotową funkcję `{action}_IO`. Strażnik: `tests/audit/io-layer.sh`
(fail na `createX`, na `ENDPOINTS`/`createIOFunction` w `UI/**`, na `toPromise(`
poza allowlistą). Wyjątki raw `callHTTPEndpoint` (becomeUser/switchBackUser,
fire-and-forget beacon) — patrz DECISION-komentarze + sekcja EXCEPTIONS w io.ts.

---

## Pełna architektura

- `main/src/UI/UI_ARCHITECTURE.md` — SSOT bieżącego stacku (state, query keys, responsive)
- `.shared-kernel/SHARED_KERNEL_GUIDE.md` — kernel jako single source of truth
- `docs/ADD_NEW_FEATURE_PLAYBOOK.md` — playbook dodawania nowego endpointa
