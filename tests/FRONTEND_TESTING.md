# Frontend Testing Doctrine (FDX FAZA 0)

> **SSOT** dla strategii testów frontendu. Stack: **Vitest + @testing-library/react + MSW** (`main/`), obok istniejącego **Playwright E2E** (`tests/e2e/`) i framework-less **backend smoke** (`tests/smoke/`).

## Po co istnieją te testy

Siatka łapiąca regresję **tam, gdzie TypeScript nie sięga**: reguły biznesowe, kontrakt warstwy danych (cache/invalidacja/optimistic), outcome flow. Charakteryzują OBECNE zachowanie — zielone przed refaktorem i zielone po = dowód braku regresji (kluczowe dla FAZY 2 unifikacji data-layer i FAZY 3 dekompozycji AppLayout).

## Co testować

- **STABILNE reguły biznesowe** (pure functions, policies): `resolveDesktopAccess`, formatters, disambiguation, onboarding/auth helpers, pricing/trial/downgrade policy.
- **Kontrakt danych** (MSW): `enabled`-gating (brak nieautoryzowanego requestu), optimistic update + rollback, cross-domain invalidacja, error→event-bus, celowy defer.
- **Outcome flow** (Playwright E2E): logowanie, tab-switching per-rola, recovery-guard redirect.

Ciężar suity leży na hookach/logice (`*.test.ts`). `renderWithProviders` jest dla wąskiej kategorii `*.test.tsx`: render-sanity i kompozycja shellów (`PricingTierSection.render-sanity.test.tsx`, `NavigationContentShell.composition.test.tsx`, `NavigationTransitionController.composition.test.tsx`) — nie do testowania komponentów UI jako takich.

## Czego NIE testować

- **CHURN-owe / tanie-okiem:** copy, layout, spacing, styling, kolejność klas.
- **ZAKAZANE:** snapshoty UI, visual-regression, asercje po strukturze DOM (`container.querySelector`, liczba `<div>`).
- Coverage tylko **raportowo** (`test:unit:coverage`) — NIGDY jako gate. Nie gonimy %.

## Reguły pisania (twarde)

1. **Locatory tylko semantyczne:** `getByRole` / `getByText` / `getByLabelText`. `getByTestId` **wyłącznie** gdy brak ARIA-odpowiednika — z komentarzem-uzasadnieniem.
2. **Fresh QueryClient per test:** zawsze `makeTestQueryClient()` / `renderWithProviders` / `createQueryWrapper`. NIGDY produkcyjny singleton z `queryClient.config.ts` (wyciek cache, false pos/neg). `retry: false` (testy nie czekają na retry-policy).
3. **MSW per-test:** rejestruj handlery przez `mswServer.use(...)` w teście. Domyślny zestaw (`msw/handlers.ts`) jest minimalny — nieobsłużony request **rzuca** (`onUnhandledRequest: 'error'`), co ujawnia query odpalony wbrew `enabled`-gate.
4. **Negatywny test każdej reguły:** zmień regułę → test czerwony → cofnij. Test który nigdy nie pęka nie chroni niczego.
5. **Co-located:** `*.test.ts(x)` obok testowanego pliku. Przenosisz kod → przenosisz test (§0 reguła 6 planu FDX).
6. **Async data-layer:** `await waitFor(...)` / `findBy*`; do mutacji `act()`. NIE asertuj DOM snackbara — spy na `pushNewSnackbar` (assert event-string).

## Komendy (CWD: `main/`)

| Cel | Komenda |
|-----|---------|
| Uruchom unit/contract | `npm run test:unit` |
| Watch | `npm run test:unit:watch` |
| Coverage (raport, nie gate) | `npm run test:unit:coverage` |

E2E (CWD root, wymaga żywego stacku): `npm run test:e2e` (Playwright, spec'y w `tests/e2e/specs/`).

**Gdzie to biegnie automatycznie:** CI (`.github/workflows/pr-check.yml`, job „Unit tests — main (Vitest)" → `cd main && npm run test:unit`) oraz PHASE 0 pre-flight w `scripts/deploy/deploy-frontend` (czerwone testy = brak deployu, exit 3). Vitest **NIE** jest w pre-commit ani w `npm run git:push`. E2E jest manual-only.

## Infra (W0.1)

- `main/vitest.config.ts` — alias `@kernel`, CSS off, coverage report-only, `include: src/**/*.test.{ts,tsx}` + stuby `NEXT_PUBLIC_*` (m.in. `NEXT_PUBLIC_NODE_ENV_MANUAL=DEVELOPMENT`, żeby `validateEnv` był soft). Środowisko to zwykły `environment: 'jsdom'` (DECISION w tym pliku).
- `main/vitest.environment.jsdom-native-abort.ts` — już NIE istnieje (usunięte 2026-09-16). Było to własne środowisko przywracające natywne `AbortController`/`AbortSignal` dla undici pod MSW; na obecnych wersjach jsdom, MSW i Node pakiet przechodzi na zwykłym `jsdom`. Uzasadnienie: DECISION przy `environment` w `main/vitest.config.ts`.
- `main/vitest.setup.ts` — MSW lifecycle (`onUnhandledRequest: 'error'`, `resetHandlers` + RTL `cleanup` w `afterEach`) + jsdom polyfille (`matchMedia`/`IntersectionObserver`/`scrollTo`) + jest-dom matchers.
- `main/src/test-utils/renderWithProviders.tsx` — `renderWithProviders` (render + zwracany `queryClient`), `createQueryWrapper` (hooki przez `renderHook`), `makeTestQueryClient` (`retry: false`, `gcTime: Infinity`, `staleTime: 0`).
- `main/src/test-utils/msw/{server,handlers}.ts` — serwer MSW + domyślne handlery (dziś jeden: `*/api/auth/get-session` → `null`).
- `main/src/test-utils/vitest.d.ts` — ambient jest-dom matchery dla `tsc` (leży pod `src/**`, bo tylko to jest w `include` tsconfiga).
- `main/src/test-utils/smoke.test.tsx` — test infry: dowodzi, że provider-tree żyje i każdy render dostaje FRESH QueryClient.

Provider tree (minimalny): QueryClient (fresh) + Theme + NextIntl. Auth/Snackbar dodaj per-test gdy testowana jednostka ich wymaga.
