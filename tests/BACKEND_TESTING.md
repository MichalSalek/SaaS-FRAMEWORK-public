# Backend Testing Doctrine (BDX FAZA 0)

> **SSOT** dla strategii testów backendu. Stack: **Vitest + node-mocks-http** (`web-1/`), obok istniejącego **Playwright E2E** (`tests/e2e/`) i framework-less **backend smoke** (`tests/smoke/`). Smoke/E2E ZOSTAJĄ — Vitest dokłada warstwę szybkich testów reguł, operacji domenowych i kontraktu handler→HTTP bez żywej bazy/auth. Wyścigi na ŻYWEJ bazie to osobna suita: `tests/concurrency/README.md`.

## Po co istnieją te testy

Siatka łapiąca regresję **tam, gdzie TypeScript nie sięga**: reguły biznesowe (quota/trial/recovery/permissions/dunning) i kontrakt warstwy HTTP (handler → `OperationResult` → status + envelope). TS strict gwarantuje kształty; NIE gwarantuje, że `>=` nie zmieni się w `>`, że limit FREE wciąż blokuje przy N, że 403 nie stanie się 200. To są testy **zachowania**, nie kształtu.

Charakteryzują OBECNE zachowanie — zielone przed refaktorem i po = dowód braku regresji.

## Co testować

- **STABILNE reguły biznesowe** (pure policies, `@kernel/policies/**`): quota (gallery/pinned/pairing/shares — `pricing.policy.ts`), recovery state-machine (`user.policy.ts`), RBAC permission-matrix (`permissions.policy.ts`), walidatory zod (`policies/validation/**`). Test bez mocków — import policy, asercje boundary.
- Reguły, których SSOT NIE leży w `@kernel/policies/**` — trial/downgrade (`@kernel/domain/stripe/stripe.config.ts` → `TRIAL_CONFIG`) i dunning (`@kernel/domain/email/email-schedule.config.ts` → `DUNNING_EMAIL_SCHEDULE`) — testujemy przez ich resolvery/operacje jako co-located unit (typ 2 niżej), nie jako pure-policy.
- **Kontrakt handler → HTTP** (integration-handler): default-export handlera przepuszczony przez prawdziwy `HTTPRequestHandlerMiddleware` pod mockami DB/auth/permission. Asertuj **status + `event` + kluczowe pola `data`** envelope'u `{ event, data }`.
- **Bramki bezpieczeństwa**: 401 (brak sesji), 403 (zła rola / account-state / quota), 400 (walidacja). To granice, na których żyją realne luki.

## Czego NIE testować

- **CHURN / tanie-okiem:** dokładne brzmienie copy błędu, pełny kształt admin-raportów, kolejność pól, formatowanie logów.
- **ZAKAZANE:**
  - testy zależne od **kolejności/stanu DB** w unit (każdy test izolowany; brak współdzielonego stanu między testami);
  - **mock Prismy w teście pure-funkcji** (policy nie dotyka DB — jeśli musisz mockować DB, to nie jest test policy, tylko domain/application unit albo integration-handler);
  - **snapshot kształtu odpowiedzi** poza tym, co już pokrywa dto-generator (`tests/dto-generator.test.ts`) — envelope sprawdzamy asercją pól, nie `toMatchSnapshot`.
- **Coverage tylko raportowo** (`test:unit:coverage`) — NIGDY jako gate. Nie gonimy %.

## Trzy rodzaje testu

### 1. Pure-policy (bez harnessu)

Import kernel-policy, asercje boundary. Mocki z `setup.ts` są inertne (policy ich nie dotyka).

```ts
import { PRICING_POLICY, PRICING_LIMITS_SSOT } from '@kernel/policies/pricing.policy';
const { canCreateGalleryRecord, getPlanConfig } = PRICING_POLICY.utils;
const free = getPlanConfig('FREE');
expect(canCreateGalleryRecord(free, PRICING_LIMITS_SSOT.FREE.max_gallery_records - 1)).toBe(true);
expect(canCreateGalleryRecord(free, PRICING_LIMITS_SSOT.FREE.max_gallery_records)).toBe(false); // boundary `<`
```

Wzorzec: `web-1/src/test-utils/kernel-policies/pricing.policy.test.ts`.

### 2. Domain/application unit (co-located, `mockDb` bez harnessu HTTP)

Import operacji `*_IO` (albo resolvera/state'u) BEZPOŚREDNIO — bez `mockApiHandler`. DB sterujesz tym samym globalnym proxy (`mockDb` z `test-utils/mockApiHandler.ts`), sąsiednie moduły dociągasz `vi.mock`/`vi.hoisted`. Asercje na `OperationResult` (`success`/`error.type`) + na tym, co operacja zawołała, nie na statusie HTTP.

Wzorce: `web-1/src/domain/gallery/operations/gallery-create.operation.test.ts` (quota + TOCTOU recount + cleanup Cloudinary), `web-1/src/application/db/prisma-error.test.ts` (tabela klasyfikacji błędów DB — czysty predykat, zero mocków), `web-1/src/test-utils/email/newsletter-audience.test.ts` (flaga-by-presence + swallow-never-throw).

To dziś NAJLICZNIEJSZA warstwa suity backendu (siatka regresyjna luk pokrycia — commit `b7db941c` „test(domain-unit)" w submodule `web-1`). Liczniki plików/testów celowo nie hardcodowane — SSOT = wynik `npm run test:unit` w `web-1/`.

### 3. Integration-handler (`mockApiHandler` + `mockDb` + fixtures)

Import default-export handlera, ustaw sesję/permission, zmockuj DB, wywołaj, asertuj envelope.

```ts
import handler from '../../pages/api/v1/gallery/create-gallery-record/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';

__setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
__setPermission(true); // lub null → prawdziwa SSOT permission-matrix
mockDb({
  stylistAccount: { findUnique: async () => ({ pricing_plan: 'PRO' }) },
  galleryRecord: { count: async () => 0, create: async () => ({ gallery_record_id: 'gr_x' }) },
});
const { status, event, data } = await mockApiHandler(handler, { method: 'POST', body });
expect(status).toBe(201);
```

Wzorzec: `web-1/src/test-utils/integration/create-gallery-record.test.ts`.

## Harness — co jest mockowane i JAK (kanon)

`web-1/src/test-utils/setup.ts` (globalny `setupFiles`) podmienia DOKŁADNIE chokepointy z import-time side-effectami, resztę middleware (CORS, rate-limit, walidacja, account-state, error-mapper, envelope) puszcza na żywo:

| Co | Specyfikator (mock) | Zachowanie |
|----|---------------------|------------|
| DB | `@app/db/db.client` | `DB_CLIENT.use` = Proxy serwujący `mockDb(...)`; nie-stubowany model → **rzuca** (fail-loud). `$transaction(cb)` woła `cb(tx)` tym samym proxy; `$executeRaw*`/`$queryRaw*` = no-op (0), `$connect`/`$disconnect` = no-op. `DB_CLIENT.useAppLogs` = osobne no-op proxy (audit-writes nigdy nie wywracają testu). |
| Auth | `@domain/user/operations/user-session.operations` | cały moduł zastąpiony (blokuje ładowanie `better-auth.config` → Stripe/Mailgun). `getCurrentUser_IO` zwraca to, co ustawi `__setCurrentUser(...)`. |
| Permissions | `@app/permissions/permissions.cache` | `checkPermission` honoruje `__setPermission(true|false)`; `null` → **prawdziwy** SSOT-lookup (system-role config, bez DB). |
| Fire-and-forget | `@app/runtime/run-after-response` | `runAfterResponse` = no-op (cleanup-interceptory + audit-writes nie odpalają I/O); `drainAfterResponseTasks` = no-op (graceful-shutdown drenaż nie ma czego drenować w teście). |

Aliasy (`vitest.config.ts`) rozwiązują się do TYCH SAMYCH plików, które handler importuje relatywnie → mocki przechwytują.

API per-test (`setup.ts`): `__setCurrentUser(output)` / `__resetCurrentUser()` · `__setPermission(true|false|null)` · `mockDb(models)` (z `mockApiHandler.ts`). `afterEach` resetuje wszystkie holdery (izolacja).

Fixtures (`web-1/src/test-utils/fixtures.ts`): `makeStylistCurrentUser()` · `makeClientCurrentUser()` · `makeStylistAccount()` · `makeClientAccount()` · `makeCurrentUserOutput(currentUser)` · `makeUser()` · `makeSession()` — typowane z kernel-DTO, **zero `any`**, overrides przez parametr.

## Reguły pisania (twarde)

1. **`userId`/account ZAWSZE z sesji** (fixture), NIGDY z body — testuj też, że body nie nadpisuje (security override).
2. **Negatywny test każdej reguły:** zmień regułę → test czerwony → cofnij. Test który nigdy nie pęka nie chroni niczego (patrz komentarz-tripwire w `pricing.policy.test.ts`).
3. **Lokalizacja** (`vitest.config.ts` zbiera `src/**/*.test.ts` — o miejscu decyduje konwencja, nie include):
   - pure-policy (kernel) → `web-1/src/test-utils/kernel-policies/*.test.ts` (walidatory: podkatalog `validation/`);
   - domain/application unit → **co-located** obok testowanego pliku (`src/domain/**/*.test.ts`, `src/application/**/*.test.ts`). Przenosisz kod → przenosisz test. Wyjątek: testy warstwy email siedzą w `src/test-utils/email/*.test.ts`;
   - integration-handler → `web-1/src/test-utils/integration/*.test.ts`. **NIE** kładź `*.test.ts` pod `web-1/src/pages/**` — Next.js zbiera każdy `*.ts` w `pages/` jako route i wyciekłby endpoint `/api/.../index.test` do builda. Handler importuj relatywnie.
4. **Mockuj tylko to, czego wymaga ścieżka.** Nie-stubowany model rzuca z opisem — to feature: ujawnia query odpalony wbrew oczekiwaniu. Dodaj go świadomie.
5. **Zero `any` / `!`.** Test files przechodzą `npm run typecheck:web-1` jak kod produkcyjny.

## Komendy (CWD: `web-1/`)

| Cel | Komenda |
|-----|---------|
| Uruchom całą suitę (policy + domain/app unit + integration) | `npm run test:unit` |
| Watch | `npm run test:unit:watch` |
| Coverage (raport, nie gate) | `npm run test:unit:coverage` |

E2E (CWD root, żywy stack): `npm run test:e2e` (Playwright, spec'y w `tests/e2e/specs/`). Smoke (framework-less, API-level, moduły `tests/smoke/*.smoke.ts` rejestrowane JAWNĄ listą importów w `tests/run-smoke-tests.ts` — nowy plik trzeba tam dopisać, nie ma auto-discovery): `npm run test:smoke` z roota albo `cd tests && npm run test:smoke`. Live-race'y na żywym Postgresie: `tests/concurrency/README.md`.

**Gdzie to biegnie automatycznie:** CI (`.github/workflows/pr-check.yml`, job „Unit tests — web-1 (Vitest)" → `cd web-1 && npm run test:unit`; bez serwera i DB — config wstrzykuje fake-env, `setup.ts` mockuje IO) oraz PHASE 0 pre-flight w `scripts/deploy/deploy-backend` (czerwone testy = brak deployu, exit 10). Vitest **NIE** jest w pre-commit ani w `npm run git:push` (tam typecheck + `audit:all`). Smoke, E2E i concurrency są manual-only — poza CI i poza hookami.

## Infra (W0.1)

- `web-1/vitest.config.ts` — env `node`, aliasy `@kernel`/`@app`/`@domain`, fake-secrets + `NODE_ENV_MANUAL=DEVELOPMENT`, `esbuild.tsconfigRaw='{}'` (omija dangling `extends` w vendored kernel-tsconfig).
- `web-1/src/test-utils/setup.ts` — globalne mocki chokepointów + per-test API.
- `web-1/src/test-utils/mockApiHandler.ts` — `mockApiHandler(handler, opts)` (node-mocks-http → envelope) + `mockDb(models)`.
- `web-1/src/test-utils/fixtures.ts` — typed fixtures z kernel-DTO.
- `eslint.config.mjs` — `vitest.config.ts` w `ignores` (root-level config poza `src/**` include).
