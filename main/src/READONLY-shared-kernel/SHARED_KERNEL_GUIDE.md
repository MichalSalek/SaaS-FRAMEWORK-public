# SHARED-KERNEL GUIDE

**Shared-kernel** to **Single Source of Truth (SSOT)** dla całego projektu:

- Typy i modele współdzielone między frontend (`main`) a backend (`web-1`)
- Konfiguracje domenowe (eventy CQRS, routing, uprawnienia)
- Polityki biznesowe (walidacja, pricing)
- Utility functions, tłumaczenia i18n

**WAŻNE**: Kernel **nie ma własnych zależności** (`package.json` = tylko `"type": "module"`, lockfile pusty) — typy zewnętrznych bibliotek pochodzą z modułu-hosta po propagacji do main/web-1. Ewentualne `node_modules/` w kernelu to relikt lokalny, **wykluczony z propagacji** (`cp-kernel` robi `rsync --exclude=node_modules`).

> Historycznie te importy nosiły `@ts-ignore`. **Baseline jest dziś 0** (dayjs przeszedł na devDep hostów, 2026-05-19) i pilnuje go `audit:all` → `typescript-strictness.sh` (baseline 0, skanuje jądro RAZEM z `main/src` i `web-1/src`) — nie dodawaj nowych. Osobny `kernel-ts-ignore.sh` wycofany 2026-09-16: pilnował wycinka tej samej reguły, więc był drugim miejscem do zgnicia.

---

## Struktura Katalogów

```
.shared-kernel/
├── application/           # Funkcje pomocnicze i utilities
│   ├── application.types.ts    # Typy generyczne (IDType, DateAndTime)
│   ├── application.utils.ts    # Funkcje pomocnicze (ValueOf)
│   ├── result.types.ts         # OperationResult<T, E> + success/failure helpers
│   ├── common-errors.types.ts  # Shared error types (AccountNotFound, Unauthorized, etc.)
│   ├── constants.config.ts     # Stałe aplikacyjne
│   ├── environment.ts          # Zmienne środowiskowe
│   ├── error-serialization.ts  # SSOT normalizacji błędów (Error → payload) dla log-store + PostHog, obie strony
│   ├── role-permissions.ts     # SSOT: rola systemowa → dozwolone APP_EVENTS (API) ⭐
│   ├── auth/                   # Utilities auth (auth.config.ts)
│   ├── date/                   # Utilities daty (date.utils.ts)
│   └── http/                   # Utilities/typy HTTP
│
├── config/                # Konfiguracja projektu
│   └── test-users.config.ts    # Dane testowych użytkowników (SSOT)
│
├── domain/                # Konfiguracje domenowe
│   ├── admin/                  # Konfiguracja panelu admin
│   ├── client/                 # Konfiguracja klienta (client-errors.types.ts)
│   ├── commands-and-queries/   # CQRS: grupowanie eventów z APP_EVENTS + typy (cqrs.config.ts, cqrs.types.ts)
│   ├── contact/                # Kontakt/PII-reveal (contact-access.types.ts, errors)
│   ├── email/                  # Konfiguracja emaili + locales/ (email-i18n.{pl,en,de}.json)
│   ├── event-log/              # Konfiguracja event logów
│   ├── events/                 # APP_EVENTS SSOT ⭐ KRYTYCZNE
│   │   ├── app-events.const.ts     # APP_EVENTS nested const — SSOT wszystkich eventów (COMMANDS/QUERIES/INFO/CONFIRMATIONS)
│   │   └── event-pipeline.config.ts # Konfiguracja pipeline eventów
│   ├── favorites/              # Konfiguracja ulubionych
│   ├── feature-flags/          # Feature flags (feature-flags.config.ts)
│   ├── gallery/                # Konfiguracja galerii (typy, nail-length)
│   ├── http/                   # Konfiguracja HTTP
│   ├── i18n/                   # Konfiguracja i18n (SSOT)
│   │   ├── i18n.config.ts      # Konfiguracja locale (pl, en, de)
│   │   └── validation.i18n.ts  # Klucze i18n dla walidacji
│   │   # NOTE: locales/ przeniesione do main/src/locales/ (2026-02-20)
│   ├── messaging/              # Komunikator stylistka↔klientka (messaging-errors.types.ts)
│   ├── moderation/             # Konfiguracja moderacji (moderation-errors.types.ts)
│   ├── newsletter/             # Newsletter (newsletter-errors.types.ts, consent types)
│   ├── pairing/                # Konfiguracja parowania
│   ├── permissions/            # Uprawnienia rola → TRASA FRONT / sekcja UI
│   │                           #   (rola → eventy API żyje w application/role-permissions.ts)
│   ├── platform/               # platform.config.ts + brand.config.ts (BRAND_CONFIG SSOT)
│   ├── pricing/                # Konfiguracja cennika (pricing.config.ts)
│   ├── recovery/               # Odzyskiwanie danych (deleted-user-backup.types.ts)
│   ├── routing/                # Ścieżki front/API (SSOT)
│   ├── salon-staff/            # Konfiguracja personelu salonu
│   ├── seo/                    # Detekcja crawlerów AI (ai-crawler-detection.ts)
│   ├── session-container/      # Session container (config, types, errors)
│   ├── stripe/                 # Konfiguracja Stripe (stripe.config.ts)
│   ├── support/                # Support (contact-topics.config.ts, errors)
│   ├── user-and-account/       # Konfiguracja user/account (+ staff_accounts.config.ts)
│   └── visit/                  # Wizyty (visit.config.ts, errors)
│
├── models/                # Typy modeli danych
│   ├── db_models.generated.dto.ts  # AUTOGEN - typy z Prisma (DO NOT EDIT)
│   ├── db_models.manual.dto.ts     # RĘCZNY - business types
│   ├── type_narrowing.ts           # Type narrowing helpers
│   ├── account/               # DTO account
│   ├── admin/                 # DTO admin
│   ├── client/                # DTO client
│   ├── email/                 # DTO email
│   ├── event-log/             # DTO event log
│   ├── favorites/             # DTO favorites
│   ├── gallery/               # DTO gallery
│   ├── messaging/             # DTO messaging
│   ├── moderation/            # DTO moderation
│   ├── newsletter/            # DTO newsletter
│   ├── pairing/               # DTO pairing
│   ├── pricing/               # DTO pricing
│   ├── public/                # DTO public
│   ├── salon-staff/           # DTO salon-staff
│   ├── session/               # DTO session
│   ├── session-container/     # DTO session-container
│   ├── support/               # DTO support
│   ├── user/                  # DTO user
│   └── visit/                 # DTO visit
│
├── policies/              # Polityki biznesowe
│   ├── event_log.policy.ts    # Polityka event logów
│   ├── events.policy.ts       # Polityka eventów
│   ├── permissions.policy.ts  # Polityka uprawnień
│   ├── pricing.policy.ts      # Polityka cennika
│   ├── routing.policy.ts      # Polityka routingu (pure)
│   ├── seo.policy.ts          # Polityka SEO
│   ├── user.policy.ts         # Polityka użytkownika
│   ├── validation.config.ts   # Konfiguracja walidacji
│   ├── validation.policy.ts   # BARREL — re-export z validation/
│   └── validation/            # Walidatory payloadów REQUEST (zod + i18n)
│       ├── validation.types.ts        # ValidationFlag, GenericValidationResult, ValidationFunction
│       ├── validation.utils.ts        # Shared security-helpery (URL-allowlist, email, cursor)
│       ├── validation.zod.ts          # Adapter zod → error-DTO (`zodValidate`) ⭐ FWE Wave H
│       └── <domena>.validation.ts     # Walidatory per domena (user, account, gallery,
│                                      #   favorite, admin*, pairing, email, moderation,
│                                      #   public, session-container, support, visit,
│                                      #   messaging, misc, …) — lista = `ls policies/validation/`
│
└── tsconfig.json          # Konfiguracja TypeScript (izolowana)
```

---

## Kluczowe Pliki (SSOT)

| Plik                                             | Co zawiera                                                                                                                                                                          | Kiedy aktualizować                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **`models/db_models.generated.dto.ts`**          | Auto-generated z Prisma: typy modeli + enum-mirrory. Liczby celowo NIE hardcodowane — SSOT = `web-1/src/prisma/schema.prisma`, plik odtwarzalny regenem                              | Automatycznie via `npm run system:generate-dto` (nigdy ręcznie)           |
| **`models/db_models.manual.dto.ts`**             | Ręczne business types: DateMetadata, ID/Label pairs, relacje                                                                                                                        | Po zmianach w schema.prisma + dodatkowe business types                    |
| **`application/result.types.ts`**                | OperationResult<T, E> discriminated union, success()/failure() helpers                                                                                                              | Przy dodawaniu nowych operacji zwracających result                        |
| **`application/constants.config.ts`**            | Stałe-bazy SSOT: `TIME` (MS_PER_MINUTE/HOUR/DAY — buduj wielokrotności `7 * TIME.MS_PER_DAY`, ratchet `audit:time-literals`), `RETRY` (backoff base), `PRISMA_TX` (webhook tx tuning), `STRIPE_CONFIG`, `PAGINATION_LIMITS`. Każda nietrywialna stała ma DECISION-komentarz                | Czas/retry/tx/pagination — używaj bazy z kernela, nie literałów           |
| **`application/common-errors.types.ts`**         | Shared error types + union `CommonError`: AccountNotFound, Unauthorized, Validation, Database, **SerializationConflict**, ExternalService, **CaptchaVerificationFailed**, StylistNotFound, AnnouncementNotFound | Przy dodawaniu nowych shared error types (dopisz też do unii `CommonError`) |
| **`domain/*/errors.types.ts`**                   | Domain-specific error types — jeden plik na domenę (admin, client, contact, email, favorites, gallery, messaging, moderation, newsletter, pairing, salon-staff, session-container, support, visit, account, user); lista = `ls domain/*/*errors.types.ts` | Przy dodawaniu błędów dla konkretnej domeny                               |
| **`domain/events/app-events.const.ts`**          | APP_EVENTS — nested const object, SSOT wszystkich eventów (COMMANDS/QUERIES/INFO/CONFIRMATIONS). **ZAWSZE** `APP_EVENTS.INFO.EMAIL.EMAIL_WELCOME_SENT`, NIGDY surowy string                       | Dodając nowy event; nigdy surowy string w kodzie                          |
| **`domain/commands-and-queries/cqrs.config.ts`** | `EVENTS`: ręczne grupowanie eventów z `APP_EVENTS` (COMMANDS, QUERIES, INFO, CONFIRMATIONS) dla typów w `cqrs.types.ts`. Definicje eventów są w `domain/events/app-events.const.ts`    | Dodając nową GRUPĘ eventów (nowy event w istniejącej grupie nic tu nie wymaga) |
| **`domain/routing/routing.config.ts`**           | ROUTES_FRONT_STATIC, ROUTES_FRONT_APP, ROUTES_API                                                                                                                                   | Dodając nową ścieżkę                                                      |
| **`domain/http/http-methods.config.ts`**         | `API_HTTP_METHODS` — metoda HTTP per operacja (SSOT; handler deklaruje `method:`, audyt porównuje)                                                                                  | Dodając/zmieniając endpoint                                               |
| **`application/role-permissions.ts`**            | **RBAC API:** rola systemowa → dozwolone `APP_EVENTS`. Podniesione z backendu do kernela (Wave 1B), żeby seed/cache backendu, smoke-testy, audyty i generator kontekstu czytały jedno źródło | Zmieniając uprawnienia do endpointów                                     |
| **`domain/permissions/permissions.config.ts`**   | **RBAC front:** rola → dozwolone TRASY (`PERMISSIONS_FOR_ROLE_BY_ROUTE`) i sekcje UI (`PERMISSIONS_FOR_ROLE_BY_UI_SECTION`) — nie eventy                                             | Zmieniając dostęp do stron/sekcji                                         |
| **`domain/i18n/`**                               | i18n.config.ts (locale: pl/en/de), validation.i18n.ts (klucze walidacji). **Locales JSON** przeniesione do `main/src/locales/`                                                      | Config/klucze: dodając walidację. Tłumaczenia: edytuj `main/src/locales/` |
| **`policies/validation.policy.ts`**              | BARREL — re-eksportuje walidatory z `validation/` (plik na domenę; liczba rośnie, nie hardcodujemy). Consumer import się nie zmienia. Walidatory to schematy **zod** przepuszczone przez `zodValidate` (`validation.zod.ts`) — binding compile-time `z.infer == REQUEST_DTO` | Dodając walidator: edytuj odpowiedni plik w `validation/`                 |
| **`policies/routing.policy.ts`**                 | Polityka routingu (pure, bez next/router)                                                                                                                                           | Zmieniając logikę redirectów                                              |

---

## Przepływ Pracy

### Dodawanie Nowego Feature

**Szczegóły:** [`docs/ADD_NEW_FEATURE_PLAYBOOK.md`](../docs/ADD_NEW_FEATURE_PLAYBOOK.md)

1. Shared-kernel: DTO → Event → Route → **metoda HTTP** → Permissions → Validator → (opcjonalnie) i18n
2. Backend (`web-1`): endpoint przez `defineHandler` (CQRS) — albo `withPublicHandler`/`withRawSecretHandler` dla tras RAW/webhook. `HTTPRequestHandlerMiddleware` woła się dziś **spod** tych wrapperów, nie wprost z handlera
3. Frontend (`main`): `{action}_IO` (front-door `application/http/io.ts`) + hook TQ + komponent React
4. Propagacja: użyj skryptu z package.json

> **KLUCZ OPERACJI = CZYSTA RÓWNOŚĆ** (standaryzacja 2026-07-15). Ten sam, w pełni kwalifikowany klucz musi wystąpić we WSZYSTKICH rejestrach: `<DOMENA>_DTO_API_V1['<KLUCZ>']` (typ) · `ROUTES_API.<KLUCZ>` (ścieżka) · `API_HTTP_METHODS.<KLUCZ>` (metoda) · nazwa eventu `APP_EVENTS.*.<GRUPA>.<KLUCZ>`. Zero derywacji i prefix-fallbacku — tooling (docs API, codegen) złącza po równości. Wyjątki = **jawne aliasy** w `main/src/application/http/http.endpoints.ts` (`ROUTE_ALIASES`). Strażniki: `audit:dto`, `audit:registry-orphan`.

### Zmiany w Bazie Danych

1. Edytuj `web-1/src/prisma/schema.prisma`
2. Uruchom skrypt generowania Prisma z web-1/package.json
3. Uruchom `npm run system:generate-dto` (auto-generates `db_models.generated.dto.ts`)
4. Propaguj kernel skryptem z package.json

### Dodawanie Tłumaczeń Walidacji

**Wzorce:** Zobacz istniejące w `domain/i18n/validation.i18n.ts` i `locales/*/common.json`

1. Klucz w `validation.i18n.ts` → 2. Tłumaczenia w `main/src/locales/*/common.json` → 3. Walidator w odpowiednim pliku `validation/*.validation.ts` → 4. propagacja skryptem z package.json

---

## Konwencje Nazewnicze

| Wzorzec            | Zastosowanie           |
| ------------------ | ---------------------- |
| `*.config.ts`      | Konfiguracja statyczna |
| `*.policy.ts`      | Polityki z logiką      |
| `*.types.ts`       | Typy TypeScript        |
| `*.i18n.ts`        | Klucze tłumaczeń       |
| `UPPER_SNAKE_CASE` | Eventy CQRS            |
| `PascalCase`       | Typy                   |
| `camelCase`        | Funkcje                |

## Pułapki

| Problem                    | Rozwiązanie                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **@ts-ignore w kernelu**   | **Baseline 0** — nie dodawaj nowych. Kernel nie ma własnych zależności, typy przychodzą z modułu-hosta po propagacji; jeśli TS krzyczy, dodaj lib jako devDep w `main/`+`web-1/`, nie tłum błędu. Strażnik: `typescript-strictness.sh` (ESLint jądra tego NIE złapie — `ban-ts-comment` jest wyłączony we wszystkich trzech configach; zmierzone wstrzyknięciem) |
| **db_models desync**       | Uruchom `npm run system:generate-dto` po `db:gen` — auto-generates `.generated.dto.ts`                                           |
| **Brak propagacji**        | ZAWSZE użyj skryptu z package.json po zmianach w shared-kernel                                                                   |
| **Walidacja nie działa**   | Komunikaty w validation.policy.ts to klucze i18n - frontend musi mapować                                                         |

## Komendy

**Sprawdź:** `package.json` w root, main/, web-1/ dla pełnej listy

```
Sprawdź package.json w root, main/ i web-1/ dla aktualnych skryptów.
```

---

## Frontend UI Architecture

**Pełna dokumentacja:** [`main/src/UI/UI_ARCHITECTURE.md`](../main/src/UI/UI_ARCHITECTURE.md)

- **Lokalizacja:** `main/src/UI/` (NIE w shared-kernel)
- **Import z kernela:** Typy (models/), polityki (validation, permissions), konfiguracje (routing)
- **Ekstrakcja logiki:** `main/src/domain/**` = IO adaptery (`{action}_IO` przez front-door `application/http/io.ts`); hooki React żyją przy widoku, w `main/src/UI/features/<domena>/hooks/`. UI nie tworzy IO samo — importuje gotowe `_IO` (strażnik `audit:io-layer`)
- **Stylowanie:** CSS Modules + CSS Custom Properties + Base UI 1.0-rc.0. MUI i Redux **usunięte** wraz z Frontend Migration (2026-05-10) — nie przywracać

---

## FAQ

| Pytanie                        | Odpowiedź                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Gdzie definicja eventu?        | `domain/events/app-events.const.ts` (`cqrs.config.ts` tylko grupuje je dla typów)                                     |
| Gdzie walidator endpointu?     | `policies/validation/*.validation.ts` (barrel: `validation.policy.ts`)                                                |
| Gdzie typ modelu?              | `models/db_models.generated.dto.ts` (auto), `db_models.manual.dto.ts` (ręczne), lub `models/<domena>/*.dto.ts`        |
| Gdzie tłumaczenia?             | `main/src/locales/<locale>/common.json` lub `events.json` (przeniesione z kernela)                                    |
| Gdzie klucze i18n walidacji?   | `domain/i18n/validation.i18n.ts` (VALIDATION_MESSAGES)                                                                |
| Jak dodać endpoint?            | Route → Event → Permissions → Validator → propagacja skryptem z package.json (szczegóły: ADD_NEW_FEATURE_PLAYBOOK.md) |
| Jak dodać komunikat walidacji? | Klucz w validation.i18n.ts → Tłumaczenia w `main/src/locales/` → Walidator w `validation/*.validation.ts`             |

---

**Powiązane:** [ADD_NEW_FEATURE_PLAYBOOK.md](../docs/ADD_NEW_FEATURE_PLAYBOOK.md) | [UI_ARCHITECTURE.md](../main/src/UI/UI_ARCHITECTURE.md) | [\_MASTER_IMPLEMENTATION_INDEX.md](../docs/PLANS_TODO/_MASTER_IMPLEMENTATION_INDEX.md)

_Ostatnia aktualizacja: 2026-08-02 (doc-drift: drzewo katalogów dosypane o realne domeny/modele — messaging, support, visit, seo, contact, pricing, brand.config; rozdzielone RBAC API (`application/role-permissions.ts`) vs RBAC front (`domain/permissions`); walidatory = zod przez `validation.zod.ts`; usunięte kruche liczniki (modele DTO, error-typy, pliki walidacji); front: MUI/Redux nieaktualne → Base UI + CSS Modules, hooki żyją w `UI/features/**`, nie w `domain/`)_
