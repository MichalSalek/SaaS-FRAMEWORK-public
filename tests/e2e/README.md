# E2E Playwright Smoke Suite

> **Nawigacja:** [tests/README.md](../README.md) → Ten dokument
>
> **Plan źródłowy:** PLAN_PRE_LAUNCH_QUALITY_SPRINT.md → Wave 6A (plan wykonany i usunięty z `docs/PLANS_TODO/` po kaskadzie dokumentacji; historia w git log)

---

## Cel

Browser-driven smoke tests dla najkrytyczniejszych user journeys (start: 10 spec'ów Wave 6A, dziś więcej — aktualna lista w sekcji „Pokrycie"). Komplementarne do API-only smoke tests (`tests/smoke/*.smoke.ts`).

**Co testują:**

- czy critical paths nie pękły od ostatniego deployu (auth + paid-tier flows),
- czy frontend + backend rzeczywiście integrują się ze sobą (nie tylko każda strona z osobna),
- czy publiczne marketing pages w ogóle renderują (regresja: i18n, JSON-LD, brak `<title>`).

**Czego NIE testują:**

- pełnych flow z zewnętrznymi providerami (Stripe checkout, Mailgun delivery) — to nie jest realnie skryptowalne w 30 s smoke,
- edge cases / RBAC matrix / quota limits — tym zajmują się `tests/smoke/*.smoke.ts` i skill `/testy-api`,
- vizualnej regresji — to robi sesja `/ui` z Playwright MCP.

---

## Setup (jednorazowo)

```bash
# 1. @playwright/test jest już w devDependencies (root). Jeśli nie ma w node_modules:
npm install

# 2. Pobierz binarki Chromium (Firefox/WebKit pomijamy — WSL2 nie domyka libów).
npm run test:e2e:install
```

## Uruchomienie

**Wymagania runtime (PRZED `test:e2e`):**

1. Backend uruchomiony na `http://localhost:3001` z `NODE_ENV_MANUAL=DEVELOPMENT`
   - Auto-seeduje test users z `.shared-kernel/config/test-users.config.ts`.
   - Otwiera `/api/auth/dev-login` gate.
2. Frontend uruchomiony na `http://localhost:3000` z `NEXT_PUBLIC_NODE_ENV_MANUAL=DEVELOPMENT`
   - Wystawia Quick Login tiles na `/user/login`.
3. Dev DB osiągalna (lokalnie: `npm run dev` z root podnosi oba kontenery).

```bash
# Standardowy headless run
npm run test:e2e

# Lokalnie z widoczną przeglądarką (do debugowania)
npm run test:e2e:headed

# Single spec
npx playwright test tests/e2e/specs/01-stylist-login-and-dashboard.spec.ts --config=tests/e2e/playwright.config.ts
```

**Customowe URL-e** (np. staging):

```bash
E2E_FRONTEND_URL=https://staging.example.com E2E_BACKEND_URL=https://staging.example.com:3101 npm run test:e2e
```

**HTML report po failu:**

```bash
npx playwright show-report tests/e2e/playwright-report
```

---

## Pokrycie (18 spec'ów)

> Specy 1-10 = pierwotny Wave 6A (critical paths z planu). Specy 11-18 dołożone później jako
> regresyjne strażniki konkretnych klas bugów (SPE checkout, auth-transport, AppLayout FAZA 3).
> Licznik testów: policz sam (`npx playwright test --list --config=tests/e2e/playwright.config.ts`) —
> nie hardcodujemy go, bo suita rośnie.

| #   | Plik                                     | Critical path (per PLAN Wave 6A)                            | Co realnie testuje                                                                                                                       |
| --- | ---------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `01-stylist-login-and-dashboard.spec.ts` | Signup → onboarding → first photo                           | Quick-login → `/app` redirect + uwierzytelniona ramka chrome                                                                             |
| 2   | `02-pricing-and-trial-start.spec.ts`     | Trial-start → Stripe checkout → subscription active         | `/pricing` ładuje się dla auth stylisty + pokazuje plany + CTA                                                                           |
| 3   | `03-pairing-issue-and-claim.spec.ts`     | QR pairing → full gallery access                            | Stylist issuuje session → public `/pairing/claim?session=...` renderuje                                                                  |
| 4   | `04-session-share-and-list.spec.ts`      | Session share push → stylist sees session                   | Backend create → `get-my` zwraca + `/app` ładuje się dla stylisty                                                                        |
| 5   | `05-account-recovery-page.spec.ts`       | Forgot password → recovery email → reset → login            | Link „odzyskaj konto" na `/user/login` prowadzi do żywej strony                                                                          |
| 6   | `06-account-delete-page.spec.ts`         | Account delete → confirmation token → hard delete + cascade | 3-step flow stepper advance do gate „USUN" (bez wystrzelenia emaila)                                                                     |
| 7   | `07-support-thread-create.spec.ts`       | Support thread create → admin reply → user notified         | Create thread API → my-threads listing + `/app/user/support` renderuje                                                                   |
| 8   | `08-admin-impersonation.spec.ts`         | Admin impersonation become-user → logout → revert           | Admin → `/admin/become-user` → switch-back round-trip                                                                                    |
| 9   | `09-account-settings-page.spec.ts`       | Email change request → verification token → updated         | `/app/user/account` renderuje + `change-email` waliduje bzdurę                                                                           |
| 10  | `10-public-marketing-pages.spec.ts`      | (cross-cut public smoke)                                    | 6 publicznych route'ów (/, /for-stylists, /for-clients, /pricing, /help-center, /contact) — wszystkie 200 + non-trivial body + `<title>` |
| 11  | `11-trial-checkout.spec.ts`              | Plan selection → embedded checkout surface (SPE)            | `ACCOUNT_CHECKOUT_SESSION` mintuje sesję (union po `mode`) + CTA `/pricing` wpięte w funnel `/pay` + portal Stripe osiągalny (legacy hosted `ACCOUNT_START_TRIAL` usunięty 2026-07-09) |
| 12  | `12-session-share-and-claim.spec.ts`     | Session container: create → share → widoczność u stylistki  | Klientka tworzy kontener → `share` zwraca token → sesja pobieralna po ID → `/app/shared` renderuje bez 5xx + listing `my-sessions`  |
| 13  | `13-account-recovery-soft-delete.spec.ts`| Soft-delete → login → 1-click reaktywacja                   | `check-recovery` + `user/reactivate` zwracają poprawny envelope; `/app/user/recover` renderuje zalogowany i wylogowany               |
| 14  | `14-gallery-upload-and-pin.spec.ts`      | Gallery: create record → pin → unpin                        | create-gallery-record → listing → pin/unpin lifecycle → strony upload-asset i galerii renderują (upload Cloudinary poza scope)      |
| 15  | `15-stylist-role-prefill-funnel.spec.ts` | Funnel „dla stylistek" → register-intent + prefill roli     | CTA `/for-stylists` niesie `intent=register&role=stylist` do `/user/login`; świeże konto bez roli ląduje na onboardingu z preselekcją |
| 16  | `16-auth-session-persistence.spec.ts`    | Regresja transportu sesji (bearer w localStorage)           | 3 role × (token → `/app` authed po reload · brak tokenu → bounce na `/user/login`) — strażnik klasy „half-migration r28"            |
| 17  | `17-auth-guard-post-login.spec.ts`       | Brak bounce'a guardu tuż po logowaniu (UI Quick Login)      | Klik kafelka Quick Login zostawia usera na `/app` (refetchSession przed push) + token przeżywa reload                                |
| 18  | `18-bottom-tab-navigation.spec.ts`       | AppLayout FAZA 3 — wyekstrahowane taby dolne                | Dokładnie jeden `aria-current="page"` na trasie i sub-trasie, klik taba nawiguje (`useAppTabs`), per-rola (stylistka/klientka)      |

---

## Świadome ograniczenia (Known Limitations)

Wave 6A pragmatic limit — wszystkie poniższe są DELIBERATELY SKIPPED, nie buggy.
Specy 11-18 częściowo podniosły trzy z tych ograniczeń (checkout-mint w 11, session
container share/claim w 12, powierzchnia recovery w 13) — kolumna „co testujemy zamiast"
odzwierciedla stan aktualny.

| Pełny scenariusz z planu                                    | Co testujemy zamiast                           | Dlaczego                                                                                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signup → onboarding → **first photo upload**                | Tylko login → dashboard                        | Cloudinary widget = interactive iframe, kasuje quota FREE plan; pełne onboarding cofa się przy każdym run'ie                                            |
| Trial-start → **Stripe checkout** → subscription active     | `/pricing` render (02) + mint sesji checkoutu i wejście w funnel `/pay` (11) | Płatność domyka się w embedded Payment Elemencie Stripe (iframe) — scripted browser go nie przejdzie; webhook back-replay = extra orchestration. Smoke `tests/smoke/pricing.smoke.ts` pokrywa backend |
| QR pairing → **full client gallery access**                 | Tylko issue + claim page render                | „Full gallery access" = już testowane w `tests/smoke/pairing.smoke.ts` (backend RBAC)                                                                   |
| Session share push → stylist sees session                   | Session create + listing API; UI ładuje `/app` (04) + create→share→pobranie po ID + `/app/shared` (12) | Push notification delivery nie istnieje (plan odroczony), out-of-band dla smoke                                                                                |
| Trial expiry → downgrade to free                            | _NOT IMPLEMENTED_                              | Wymaga clock-skip / time-travel w DB (Prisma + cron). Lepiej w `tests/smoke/lifecycle.smoke.ts`                                                         |
| Forgot password → recovery email → reset → login            | Entry surface (05) + probe `check-recovery`/`user/reactivate` i render `/app/user/recover` (13) | Magic-link auth = brak klasycznego forgot password; pełny cykl soft-delete → 403 guard → reaktywacja wymaga deleted-usera w pending-recovery state (zniszczyłoby seedowanego test stylistę) — pokrywa go `tests/smoke/recovery-domain.smoke.ts` na rollbackowanej transakcji |
| Email change → verification token → updated                 | Page render + validation negative              | Realny change-email zniszczyłby test stylist email mid-suite                                                                                            |
| Account delete → confirmation token → hard delete + cascade | Stepper advance do confirmation gate           | Realne wysłanie emaila = test stylista flagowany do deletion (24h grace)                                                                                |
| Admin impersonation become-user → logout → revert           | API round-trip                                 | Banner UI wymaga `localStorage` propagation z custom response header — wymaga browser context z impersonation IO helpers                                |
| Support thread create → admin reply → user notified         | Create + listing                               | Admin reply = drugi browser context + admin inbox load. Należy do skill'a `/testy-api`                                                                  |

---

## Jak dodać nowy test

1. Stwórz `tests/e2e/specs/NN-nazwa.spec.ts` (NN = kolejny numer).
2. Importuj `loginViaDevToken` z `../helpers/auth` (szybciej niż UI login).
3. Użyj `apiCall` z `../helpers/api` dla setup/cleanup po stronie backendu.
4. W `afterEach` / `finally` posprzątaj utworzone zasoby (`cleanupGalleryForToken`, `cleanupPairingsForToken`).
5. Selektory: ZAWSZE `data-testid`, `aria-label`, lub `getByRole({ name })`. NIGDY class names — psują się przy każdym redesign'ie.
6. Timeout 30s per test (default z `playwright.config.ts`). Jeśli potrzebujesz więcej — przemyśl scope.
7. Update sekcji „Pokrycie" w tym README.

---

## Architekturalne decyzje

**Workers: 1 (serial).** Tests dzielą seeded dev DB. Parallel runs ścigałyby się o cleanup. Akceptowalne dla <30 tests; przy większej skali — per-test DB fixtures.

**Chromium only.** Firefox/WebKit wymagają system libs niedostępnych pod WSL2 + claude-sandbox. Produkcja jest Chrome-first (Capacitor WebView = Chromium na Android, Safari/WebKit na iOS — iOS różnic gonimy ręcznie).

**Bearer token via `localStorage` injection** (nie cookies). Project używa Better Auth z `bearer` pluginem (zob. CLAUDE.md → „ZNANE DECYZJE ARCHITEKTONICZNE"). Frontend client czyta token z `localStorage[CUSTOM_HEADERS.authorization]` (literalny klucz `authorization`, BEZ prefixu — `better-auth-client.ts` / `AuthContext.tsx` / `currentUser.query.ts`) przy bootstrap'ie — to nasz hook do „start test pre-authenticated". (`helpers/auth.ts` importuje `CUSTOM_HEADERS` z kernela; klucz `better-auth.session_token` to martwy relikt half-migration r28, naprawiony.)

**Cleanup w `afterEach` / `beforeAll` revoke**, nie w `afterAll` dla każdego testu. Gwarantuje że failure w teście N nie kładzie testu N+1.

**Brak `webServer` w `playwright.config.ts`.** Tests zakładają że dev stack już działa (kontenery podniesione przez `npm run dev`). Auto-start z Playwright byłby flaky — kontenery potrzebują ~15-30s na seeded DB + warm cache, a `webServer.timeout` często by je zabijał za wcześnie.

---

## TODO (post-launch / Wave 6+)

> Numery 11-13 z pierwotnej listy TODO zostały w międzyczasie **zajęte przez inne specy**
> (11 = trial checkout, 12 = session share/claim, 13 = account recovery) — pozycje poniżej
> opisujemy więc po scenariuszu, nie po numerze. Nowy spec bierze kolejny wolny numer.

- [ ] Trial expiry → downgrade (wymaga DB-level time-travel helper)
- [ ] Real Stripe test-mode checkout end-to-end (wymaga Stripe CLI webhook forwarding w CI; spec 11 pokrywa tylko mint sesji + wejście w funnel)
- [ ] Mobile-viewport variants (iPhone 14 Pro preset) dla top-3 paths
- [ ] CI integration via GitHub Actions (smoke + e2e; Vitest unit **już** jest w `pr-check.yml` od 2026-07-16)
- [ ] Visual regression baseline screenshots (osobny skill `/ui`)

---

**Last Updated:** 2026-08-02 (doc-drift: pokrycie 10 → 18 spec'ów, TODO odnumerowane po zajęciu 11/12/13, znane ograniczenia zsynchronizowane ze specami 11-13, notka o Vitest w CI)
