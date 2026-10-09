# Domain Layer (Backend Business Logic)

> **Cel:** Operacje biznesowe na bazie danych, walidacja domenowa, event logging

---

## Odpowiedzialność

Domain layer zawiera **logikę biznesową** aplikacji:

- Operacje CRUD na encjach domenowych
- Walidacja reguł biznesowych
- Sprawdzanie uprawnień (ownership, permissions)
- Event logging dla audytu

**Nie należy tutaj:**

- Infrastruktura (adaptery, middleware) → `application/`
- Prezentacja (UI, komponenty) → `main/src/`
- Konfiguracja środowiska → `application/environment/`

---

## Struktura Modułu

```
domain/
└── {module}/
    ├── operations/
    │   └── {concern}.operations.ts   # Operacje IO (DB access)
    ├── {module}.types.ts             # TypeScript types lokalne do domeny
    ├── {module}.guard.ts             # Guards, ownership checks (opcjonalne)
    └── {module}.resolver.ts         # Pure logic helpers (opcjonalne)
```

**Zasada:** Jeden moduł = jedna encja domenowa lub bounded context. Wszystkie pliki z logiką IO idą do `operations/`.

---

## Konwencje Nazewnictwa

**Wszystkie nazwy plików = kebab-case** (egzekwowane ratchetem `naming-case.sh`; application/ i domain/ 100% kebab po BDX W3.4). **Funkcje IO** (zwracające `OperationResult`/robiące I/O): suffix `_IO` — egzekwowane `operation-io-suffix.sh` (allowlist pusty, konwencja 100%).

Sufiksy plików (każdy ma jedno znaczenie — następny agent nie zgaduje):

| Sufiks | Znaczenie |
|--------|-----------|
| `.operations.ts` / `.operation.ts` | Operacje I/O zwracające `OperationResult` (funkcje z suffixem `_IO`); żyją w `operations/` |
| `.query.ts` | Operacje wyłącznie odczytowe (listy, szczegóły, podglądy — bez mutacji); funkcje `_IO`, żyją w `operations/` — np. `gallery-list.query.ts` |
| `.resolver.ts` | Pure decision-mapping (bez I/O) — np. `dunning-email.resolver.ts` (attempt→rule) |
| `.utils.ts` | Pure, stateless helpers |
| `.helper.ts` / `.helpers.ts` | Intra-domain shared logic (może dotykać I/O, nie jest pełną operacją) |
| `.service.ts` | Side-effecting serwis (np. email-sender `moderation-email.service.ts`, `support-email.service.ts`) |
| `.state.ts` | In-memory throttle/sweep state (module-level `let`, throttle gettery) |
| `.guard.ts` / `.guards.ts` | Account/permission guards (czyste predykaty + wczesne błędy) |
| `.interceptor.ts` | Lazy sweep/cleanup odpalany na ruchu requestów (NIE external cron) — np. `event-log-cleanup.interceptor.ts`, `recovery-expiry.interceptor.ts` |
| `.types.ts` | Typy domenowe |
| `.config.ts` | Konfiguracja/stałe domenowe |

> **Sufiks `.api.ts`** był sporadyczny/niespójny. W3.4 usunęło go z części plików (`event-log-io.wrapper.ts` zamiast `eventLogIO.wrapper.api.ts`), ale pliki `*.utils.api.ts` nadal istnieją (np. `gallery/gallery.utils.api.ts`; lista: `find web-1/src -name '*.api.ts'`). Nie wprowadzać nowych `.api.ts`.

> **DECISION (`permissions` domain — flat, bez `operations/`):** domena `permissions` jest jedyną domeną (poza czysto-pomocniczym `_shared/`) bez podkatalogu `operations/` — wszystkie pozostałe nestują operacje w `operations/`. To **celowe** — to 1-plikowa domena (route→permission mapping), nie potrzebuje `operations/` (dodanie byłoby over-engineeringiem). Następny agent/review NIE „naprawia" tej struktury.

---

## OperationResult Pattern

Wszystkie operacje mutujące (i większość queries) zwracają `OperationResult<T, E>` z shared-kernel:

```typescript
import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type { SomeDomainError } from '@kernel/domain/some/some-errors.types';

export const createRecord_IO = async (
  userId: string,
  data: CreateInput
): Promise<OperationResult<{ id: string }, SomeDomainError>> => {
  const account = await DB_CLIENT.use.someTable.findFirst({
    where: { created_by_user_id: userId },
  });

  if (!account) {
    return failure({ type: 'SOME_NOT_FOUND', userId });
  }

  const record = await DB_CLIENT.use.record.create({ data });

  void recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.SOME.RECORD_CREATED,
    user: { id: userId },
    responseBody: { id: record.id },
  });

  return success({ id: record.id });
};
```

**Error types:** Definiowane w `.shared-kernel/domain/[domain]/[domain]-errors.types.ts`. Użyj istniejącego typu zamiast `string`.

---

## Event Logging

Każda operacja mutująca MUSI logować event. Użyj `recordAuditEvent_IO` z `application/event-log/`:

```typescript
void recordAuditEvent_IO({
  eventName: APP_EVENTS.INFO.DOMAIN.SOMETHING_HAPPENED,
  user: { id: userId }, // lub { email: '...' }
  responseBody: {
    /* data */
  },
});
```

Fire-and-forget (`void`) jest OK dla logów audytowych — nie blokuje response.

---

## Account Guards

Przed operacją sprawdź typ konta:

```typescript
import {
  requireStylistAccount,
  requireClientAccount,
} from '@domain/_shared/guards/account-guards';

const guardResult = requireStylistAccount(currentUser);
if (!guardResult.success) return guardResult;
```

---

## Database Error Handling

W catch blokach używaj helpera `databaseFailure()`:

```typescript
import { databaseFailure } from '@app/errors/error-result.helpers';

try {
  await DB_CLIENT.use.someTable.update({ ... });
} catch (error) {
  return databaseFailure('operationName', error);
}
```

---

## Zależności

### Dozwolone importy:

- `application/` — infrastruktura (DB, event-log, debugger)
- `@kernel/` — typy, eventy, policies, errors
- Inne moduły w `domain/` — cross-domain operations
- `import type { Prisma }` z `prisma/js-client` — wyłącznie dla typów Prisma
  namespace (np. `Prisma.TransactionClient`, `Prisma.PrismaClientKnownRequestError`);
  nie jest to import runtime klienta — dozwolony wyjątek od reguły `@app/db/db.client`

### Zabronione importy:

- `pages/` — warstwa prezentacji
- `main/src/` — frontend
- External libraries bezpośrednio (używaj adapterów z `application/`)
- `new PrismaClient(...)` — tworzenie klienta poza `prisma.adapter.ts` (ratchet: `prisma-access.sh`)
- `web-1/src/infrastructure/` — katalog celowo nieistniejący (patrz DECISION direct-Prisma poniżej)

---

## DECISION: Direct-Prisma (DB_CLIENT) — brak warstwy repository

`DB_CLIENT.use.<model>` i `DB_CLIENT.useAppLogs.<model>` to świadomy, spójny
wzorzec dostępu. NIE wprowadzać `web-1/src/infrastructure/` ani warstwy
repository — over-engineering nad poprawnym tx-aware kodem domenowym.
Mockowalność świadomie nieużywana (projekt celuje w czyste policy-testy).
Pełny DECISION-comment: `web-1/src/application/db/db.client.ts`.
Ratchet pilnujący: `tests/audit/prisma-access.sh` (D1 zamknięta, BDX FAZA 1, 2026-06-14).

### Aliasy importów (BDX W1.1)

Domain importuje wyłącznie aliasem (ratchet `import-aliases.sh`):

- `@kernel/*` → typy, eventy, policies, errors, `result.types`, stałe (`TIME`/`RETRY`/`PRISMA_TX` z `@kernel/application/constants.config`)
- `@app/*` → infrastruktura: `@app/db/db.client` (DB_CLIENT), `@app/errors/error-result.helpers` (`databaseFailure`), `@app/event-log/event-log-io.wrapper` (`recordAuditEvent_IO`)
- `@domain/*` → inne moduły domenowe (cross-domain operations, guards z `@domain/_shared/guards/account-guards`)

Ścieżka relatywna `../../application/...` = drift (ratchet blokuje).

### Granica handler ↔ operacja (BDX W2.x)

Operacje domenowe **nie znają HTTP**. Wołane są z handlera CQRS (`defineHandler`, `@app/http/define-handler`) — który zostaje cienki: guard → `myOperation_IO()` → `mapErrorToResponse`/`respondSuccess`. Operacja zwraca `OperationResult<T,E>`, handler tłumaczy na HTTP. Pełny flow + recepty → [`docs/BACKEND_DX_GUIDE.md`](../../../docs/BACKEND_DX_GUIDE.md), [`docs/ADD_NEW_FEATURE_PLAYBOOK.md`](../../../docs/ADD_NEW_FEATURE_PLAYBOOK.md).

---

---

## DECISION: user vs account (nie merge)

`user/` = identity aggregate (auth, lifecycle, onboarding, GDPR, soft-delete, recovery).
`account/` = business aggregate (stylist subscription, dashboard, profile, Stripe, settings).

Split CELOWY — różne agregaty, różne cykle życia. NIE merge mimo że kernel grupuje config-level w `user-and-account`. Backend domain celowo trzyma je rozdzielnie dla czystości bounded-contextów.

---

**Ostatnia aktualizacja:** 2026-07-17 (doc-drift: usunięto kruchy licznik domen w DECISION `permissions`; treść od 2026-05-17)
