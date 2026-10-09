# Application Layer (Backend Infrastructure)

> **Cel:** Infrastruktura, adaptery, middleware, cross-cutting concerns

---

## 📋 Odpowiedzialność

Application layer zawiera **infrastrukturę** wspierającą logikę biznesową:

- Adaptery do external services (DB, email, Stripe, maps)
- HTTP middleware (CORS, rate limiting, timing)
- Error handling i logging
- Session management
- Permission system
- Environment configuration

**Nie należy tutaj:**

- Logika biznesowa → `domain/`
- Prezentacja (UI) → `main/src/`
- Routing → `pages/api/`

---

## 🏗️ Struktura Modułu

Typowy moduł aplikacyjny:

```
application/
└── {module}/
    ├── {module}.client.ts                 # Główny klient/API modułu (np. db.client.ts)
    ├── {module}.utils.ts                  # Helpers (pure, bez efektów)
    ├── {module}.config.ts                 # Konfiguracja / stałe
    ├── {module}.types.ts                  # TypeScript types (opcjonalne)
    ├── {module}.middleware.ts             # Middleware (opcjonalne)
    └── adapters/                          # External service adapters
        └── {service}.adapter.ts
```

**Zasada:** Jeden moduł = jedna odpowiedzialność infrastrukturalna. Pliki kebab-case (ratchet `naming-case.sh`).

---

## 🎯 Konwencje Nazewnictwa

> **Sufiks `.api.ts` zlikwidowany w BDX W3.4** (był sporadyczny/niespójny). NIE wprowadzać nowych `.possibilities.api.ts` / `.utils.api.ts`.

### Pliki główne

- `{module}.client.ts` - główny klient/API modułu (np. `db.client.ts`)
- `{module}.utils.ts` - helpers (pure, bez efektów)
- `{module}.config.ts` - konfiguracja, constants
- `{module}.types.ts` - TypeScript types
- `{module}.middleware.ts` - middleware functions

### Adaptery

- `adapters/{service}.adapter.ts` - adapter do external service
- Przykłady: `prisma.adapter.ts`, `mailgun.adapter.ts`, `stripe.adapter.ts`

---

## 🔄 Wzorce Architektoniczne

### 1. Adapter Pattern

Izolacja external dependencies:

```typescript
// db/adapters/prisma.adapter.ts
export const DB_CLIENT_PRISMA = {
  use: dbClient, // główna baza (schema.prisma)
  useAppLogs: dbClientAppLogs, // event-log store (prisma-app-logs)
} as const;

// db/db.client.ts
export const DB_CLIENT = DB_CLIENT_PRISMA;
```

**Dlaczego:** Łatwa podmiana implementacji, testowanie, izolacja

### 2. Middleware Pattern

Kompozycja funkcjonalności:

```typescript
export const withTimingMiddleware = (
  handler: NextApiHandler
): NextApiHandler => {
  return async (req, res) => {
    const start = Date.now();
    await handler(req, res);
    const duration = Date.now() - start;
    // ... logging
  };
};
```

**Dlaczego:** Separation of concerns, reusability

### 3. Configuration Pattern

Centralizacja konfiguracji: `environment.config.ts` (`RAW_VARS`) + walidacja przez `ENV_SCHEMA` na starcie (`validateEnvSchema`, `@app/environment/env-schema`). Nowy env-var dodaje się do `ENV_SCHEMA` z `required`/`format` — szczegóły niżej (§Prymitywy BDX → env-schema).

**Dlaczego:** Single source of truth, walidacja na boot (fail-fast w prod, soft-warn w dev), feature-flag-by-presence dla opcjonalnych integracji

### 4. Error Handling Pattern

Ujednolicone raportowanie błędów:

```typescript
reportIssueBackend({
  namespace: 'module_name',
  message: 'Error description',
  payload: error,
  mode: 'error', // 'error' | 'warn' | 'info'
});
```

**Dlaczego:** Centralne logowanie, monitoring, debugging

---

## ⚠️ Częste Błędy

### ❌ Bezpośredni dostęp do process.env

```typescript
// ZŁE
const apiKey = process.env.STRIPE_KEY;
```

```typescript
// DOBRE
import { ENV_VARS } from '@app/environment/environment.config';
const apiKey = ENV_VARS.STRIPE_SECRET_KEY;
```

### ❌ Adapter w głównym pliku zamiast w podfolderze

```typescript
// ZŁA STRUKTURA
application / stripe / stripeClient.ts;

// DOBRA STRUKTURA
application / stripe / adapters / stripe.adapter.ts;
```

### ❌ Brak error handling

```typescript
// ZŁE
const result = await externalAPI.call();
return result;
```

```typescript
// DOBRE
try {
  const result = await externalAPI.call();
  return result;
} catch (error) {
  reportIssueBackend({
    namespace: 'module',
    message: 'External API failed',
    payload: error,
    mode: 'error',
  });
  throw error;
}
```

### ❌ Logika biznesowa w application layer

```typescript
// ZŁE - to jest logika biznesowa!
export const canUserAccessGallery = (user: User) => {
  return user.pricing_plan === 'PRO';
};
```

```typescript
// DOBRE - to należy do domain/
// application layer tylko dostarcza infrastrukturę
```

---

## 🛡️ Zasady Bezpieczeństwa

1. **Waliduj environment variables** przy starcie aplikacji
2. **Używaj rate limiting** dla public endpoints
3. **CORS validation** - tylko allowed origins
4. **Nigdy nie loguj secrets** - sanitize przed reportIssueBackend
5. **Timeout dla external calls** - unikaj hanging requests

---

## 🔗 Zależności

### Dozwolone importy:

- ✅ Inne moduły w `application/` - cross-cutting concerns
- ✅ `READONLY-shared-kernel/` - typy, constants
- ✅ External libraries - ale przez adaptery!

### Zabronione importy:

- ❌ `domain/` - application nie zna domain logic
- ❌ `pages/` - warstwa prezentacji
- ❌ `main/src/` - frontend

**Wyjątek:** `domain/` może importować z `application/` (dependency flow: domain → application)

---

## 📚 Przykłady Użycia

### Typowy adapter:

Realny przykład: transport e-maili. Każdy dostawca ma własny adapter
(`email-handler/adapters/{resend,mailgun,smtp}.ts`), a **domena nigdy nie woła ich wprost** —
idzie przez fasadę `email-handler/email-transport.ts` (Resend primary → Mailgun fallback →
SMTP fallback). Enkapsulację adapterów pilnuje `audit:imports` (§adapter-encapsulation).

```typescript
// email-handler/adapters/<provider>.ts — kształt adaptera
import { ENV_VARS } from '@app/environment/environment.config';

export const sendEmail = async (params: EmailParams) => {
  try {
    return await providerClient.send(params);
  } catch (error) {
    reportIssueBackend({
      namespace: 'email_adapter',
      message: 'Failed to send email',
      payload: error,
      mode: 'error',
    });
    throw error; // fasada zdecyduje o fallbacku
  }
};
```

### Typowy middleware:

```typescript
// rate-limit.middleware.ts
export const withRateLimitCheck = (handler: NextApiHandler): NextApiHandler => {
  return async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (isRateLimited(ip)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    await handler(req, res);
  };
};
```

---

## 🔍 Debugging

### Typowe problemy:

**Problem:** "Environment variable undefined"  
**Rozwiązanie:** Sprawdź `.env` file i `environment.config.ts`

**Problem:** "External service timeout"  
**Rozwiązanie:** Dodaj timeout do adapter call, sprawdź network

**Problem:** "CORS error"  
**Rozwiązanie:** Sprawdź `CORS_ALLOWED_ORIGINS` w `cors.config.ts`

**Problem:** "Rate limit false positives"  
**Rozwiązanie:** Sprawdź IP extraction logic w middleware

---

## 🎨 Różnice vs Domain Layer

| Aspekt               | Application             | Domain                    |
| -------------------- | ----------------------- | ------------------------- |
| **Odpowiedzialność** | Infrastruktura          | Logika biznesowa          |
| **Funkcje I/O**      | brak `_IO` (infra)      | sufiks `_IO` (operacje)   |
| **Główny plik**      | `.client.ts` / `.middleware.ts` | `.operation(s).ts` w `operations/` |
| **Adaptery**         | `adapters/` subfolder   | Nie używa adapterów       |
| **Dependency flow**  | ← domain importuje      | → nie importuje domain    |
| **External libs**    | Tak, przez adaptery     | Nie, używa application    |

---

## 📖 Dodatkowe Zasoby

- **Domain Layer:** `domain/README.md`
- **HTTP Middleware:** `application/http/request.middleware.ts`
- **Environment Config:** `application/environment/environment.config.ts`
- **Playbook:** `docs/ADD_NEW_FEATURE_PLAYBOOK.md`

---

## 🧩 Prymitywy BDX (deklaratywne wzorce HTTP / env / interceptory)

> Pełne recepty end-to-end (z kodem) → [`docs/BACKEND_DX_GUIDE.md`](../../../docs/BACKEND_DX_GUIDE.md). Tu — mapa, co gdzie żyje.

### Aliasy importów

Backend importuje **wyłącznie aliasem** (ratchet `import-aliases.sh`):

| Alias | → katalog | Zawartość |
|-------|-----------|-----------|
| `@kernel/*` | `src/READONLY-shared-kernel/*` | typy, eventy, routing, policies, errors, DTO, stałe (SSOT read-only) |
| `@app/*` | `src/application/*` | **ta warstwa** — HTTP, DB, env, interceptory, event-log, adaptery |
| `@domain/*` | `src/domain/*` | logika biznesowa: operacje `_IO`, guards, resolvery |

### `defineHandler` — unified CQRS handler (`@app/http/define-handler`)

Po BDX W2.x endpoint CQRS = jedno wywołanie `defineHandler<DTO>({ eventName, method, validate?, authCheck?, handle })`. Composer owija timing + `HTTPRequestHandlerMiddleware` (auth + permission + validation + envelope) — zjada 15-liniowy boilerplate. `handle: (body, ctx, meta, res, req?)` **self-responds** (woła `respondSuccess`/`respondCreated`/`mapErrorToResponse`); `defineHandler` celowo NIE auto-mapuje `OperationResult` (kształty sukcesu niejednolite). Skrót single-branch: `respondOnError(res, result)`. RAW endpointy (webhook/S2S/health/token-bridge) → `withPublicHandler`/`withRawSecretHandler` z `@app/http/define-raw-handler` (poza CQRS middleware). Kształt egzekwuje `handler-shape.sh`.

### env-schema — walidacja na starcie (`@app/environment/env-schema`)

`validateEnvSchema(RAW_VARS)` (wołane w `environment.config.ts`) to **jedyny gatekeeper env web-1** — zastąpił kernel `validateEnv` (który traktował każdy wpis jako bezwarunkowo wymagany → wywalał prod-boot na opcjonalnych integracjach Apple/Cloudinary/Stripe). `ENV_SCHEMA` deklaruje per-var `required` (`'always'`/`'prod'`/`'optional'`, + `requiredWhen`) i `format` (`url`/`int`/`enum`/`string`/`bool`/`secret`, walidowany tylko gdy wartość obecna). Tryby: DEV/STAGING = SOFT (warn raz, nigdy throw) · PRODUCTION = fail-fast (`process.exit(1)`). Kernel `validateEnv` zostaje gatekeeperem tylko dla `main/`. Ratchet: `env-governance.sh` (W1.2).

### `createSweepInterceptor` — lazy-cron sweep (`@app/interceptors/create-sweep-interceptor`)

`createSweepInterceptor({ name, throttleMs, run })` → `() => Promise<void>` do wpięcia przez `runAfterResponse(...)` w middleware. Daje throttle (per-instance, in-memory `let lastRunAt`), timing (`recordSweepRun`), **never-throw catch→report**. `run` ma pełną wolność raportowania success/warn; cross-instance dedup (advisory lock / optimistic claim) zostaje w `run`. `throttleMs` z `TIME.*` (`@kernel/application/constants.config`), nigdy raw-ms. Ratchet: `sweep-interceptor.sh` (W4.1).

### Prymitywy współbieżności DB (`@app/db/*`) — epik DB-hardening

Kod domenowy **nie pisze własnych** wzorców lockowania ani własnej detekcji błędów Prismy:

| Prymityw | Plik | Po co |
|---|---|---|
| `withWriteTx` | `db/with-write-tx.ts` | Transakcja zapisu z jednolitym tuningiem (`PRISMA_TX`) i retry serializacji |
| `lockStylistAccount` / `lockUserRow` / … | `db/lock-rows.ts` | Jedyny sanktcjonowany `FOR UPDATE`. **Globalny porządek** User → StylistAccount → SessionContainer → SupportThread czyni deadlock ABBA niemożliwym konstrukcyjnie. Ratchet `audit:lock-discipline` (escape: `lock-discipline-allow: <powód>`) |
| `casUpdate` / `deleteIfExists` | `db/cas.ts` | Compare-and-swap zamiast read-modify-write (lost update) |
| `isP2002` / `isP2025` / `isDeadlock` / `isPrismaErrorCode` | `db/prisma-error.ts` | **Strukturalna** klasyfikacja błędów. `instanceof Prisma.*Error` jest ZAKAZANE (ratchet `audit:prisma-error-narrowing`) — Turbopack duplikuje tożsamość klas między realizacjami bundle'a, narrowing wychodzi FALSE dla realnego błędu i leci niezmapowane 500 |
| `isSerializationConflict` | `db/serialization-conflict.ts` | Rozpoznanie konfliktu serializacji pod retry |
| `dbAvailability` (globalThis) | `db/db-availability.state.ts` | **Pasywny** monitor dostępności (Neon scale-to-zero — zero aktywnego `SELECT 1`). Szczegóły + DECISION → [`web-1/README.md`](../../README.md) §Architecture |

Wyścigi tych ścieżek pokrywa żywa suita `tests/concurrency/` (`npm run test:concurrency`) — asercje idą wprost na Postgresa, nie na „brak 500".

### Konwencje plików

Kebab-case (ratchet `naming-case.sh`). `application/` używa `.utils.ts` (helpers bez efektów), `.middleware.ts`, `.config.ts`, `.adapter.ts` (w `adapters/`). Funkcje I/O zwracające `OperationResult` → sufiks `_IO`. Pełna tabela sufiksów domenowych → [`../domain/README.md`](../domain/README.md).

---

**Ostatnia aktualizacja:** 2026-08-02 (doc-drift: adapter Prismy = `use`/`useAppLogs` — nie `useDBClientEventLogStore`; przykład adaptera e-mail przepisany na realną fasadę `email-transport`; dopisane prymitywy współbieżności DB z epiku DB-hardening. Treść BDX W7.1 zachowana)
