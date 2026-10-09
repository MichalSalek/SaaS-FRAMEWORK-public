# Application Layer

> **UWAGA:** Axios adapter i Redux store to LEGACY — migracja DONE (2026-05-10).
> Stack: natywny fetch + Zustand v5 + TanStack Query v5. Patrz: `main/src/UI/UI_ARCHITECTURE.md`

**Warstwa:** Infrastructure / Application Services
**Odpowiedzialność:** Cross-cutting concerns, adaptery, infrastruktura techniczna

---

## 🎯 CEL WARSTWY

Warstwa `application` zawiera:

- **Adaptery** do zewnętrznych bibliotek (localStorage, dayjs; natywny fetch — nie axios)
- **Cross-cutting concerns** (error handling, logging, i18n)
- **Infrastrukturę techniczną** (HTTP client, Zustand stores, event bus)
- **Utilities aplikacyjne** (environment, date formatting, storage)

**NIE zawiera logiki biznesowej** - ta jest w `domain/`

---

## 📁 STRUKTURA MODUŁÓW

### Core Infrastructure:

- **http/** - HTTP client: natywny fetch, unified IO front-door `io.ts` (`defineEndpoint`/`defineQuery`/`definePathEndpoint`), raw escape hatch `callHTTPEndpoint`, interceptory, `queryKeys.factory.ts`, `queryClient.config.ts`
- **stores/** - Zustand v5 stores (devMode, cookieConsent, navigation) + `user-cache.ts` (helpery TQ cache currentUsera)
- **event-bus/** - Event bus dla side effects
- **error-debugger/** - Error handling + logging do backend (`reportIssueFrontend`)
- **environment/** - Environment variables + helpers
- **routing/** - Seamy nawigacyjne NVT (`navigation.possibilities.api.ts`)
- **policies/** - Polityki dostępu/przejść (desktop-access, navigation-transition, route-access)
- **lifecycle/** - `AppLifecycle.tsx` (Capacitor init: splash, back button, keyboard)
- **runtime/** - `runAfterResponse()` (fire-and-forget runtime-aware)
- **security/** - Cloudflare Turnstile config (`turnstile.config.ts`)

### UI Infrastructure:

- **app-snackbar/** - Snackbar/toast notifications (adapter + `appSnackbar.store.ts`)
- **app-dynamic-menu/** - Dynamic menu context

### Domain-adjacent / integracje:

- **auth/** - Auth utilities (exchange-code helpers, social-signin, native-deeplink-listener)
- **analytics/** - PostHog provider + skrypty analityczne
- **platform/** - Detekcja platformy + natywne utility'sy (haptics, share, browser)
- **feature-flags/** - Runtime feature flags (cross-cutting IO)
- **cloudinary/** - Budowa URL-i Cloudinary (`cloudinary-url.utils.ts`)
- **forms/** - Walidatory pól formularzy (`fieldValidators.ts`)
- **blog/** / **api-docs/** - Typy/utils bloga (BLOG_ENABLED=false) / wygenerowany OpenAPI (`openapi.generated.json`)

### Storage & Utilities:

- **client-device-storage/** - localStorage + sessionStorage adaptery
- **date/** - Date formatting (dayjs adapter)
- **i18n/** - Internationalization loader

> Lista = realne katalogi `main/src/application/` (stan 2026-07-17). Nowy moduł → dopisz tu jedną linię.

---

## 🏗️ KONWENCJE NAZEWNICTWA

### Pliki:

```
module-name/
├── moduleName.config.ts          # Konfiguracja (constants, settings)
├── moduleName.types.ts           # TypeScript types/interfaces
├── moduleName.possibilities.api.ts  # Główne API modułu (public functions)
├── moduleName.store.ts           # Zustand store (jeśli moduł ma własny store)
├── moduleName.state.ts           # Local state
├── moduleName.interceptor.ts     # Interceptory (middleware)
├── moduleName.controller.ts      # Controllers (init functions)
└── adapter-name-adapter/         # Adaptery do zewnętrznych bibliotek
    ├── adapter.adapter.ts
    ├── adapter.config.ts
    └── adapter.types.ts
```

### Funkcje:

- **camelCase** dla funkcji i zmiennych
- **PascalCase** dla typów i komponentów
- **UPPER_SNAKE_CASE** dla constów
- Public API eksportowane z `.possibilities.api.ts`
- Internal utilities nie eksportowane lub z prefiksem

---

## 🎨 WZORCE ARCHITEKTONICZNE

### 1. Adapter Pattern

Wszystkie zewnętrzne biblioteki są owinięte w adaptery:

- localStorage/sessionStorage → storage adapters
- dayjs → date adapter (w shared-kernel)
- sonner → snackbar adapter

**Korzyści:** Łatwa wymiana biblioteki, centralna konfiguracja, consistent error handling, testability

### 2. Store Pattern (Zustand v5)

Moduły z własnym stanem używają Zustand: `{module}.store.ts` → `possibilities.api (public API)`. Redux usunięty w ramach Frontend Migration (2026-05-10).

### 3. Error Handling Pattern

Wszystkie błędy przechodzą przez `reportIssueFrontend` z namespace, message, payload, mode

### 4. Promise-first IO (HTTP)

Backendowe calle deklaruje się przez unified front-door `http/io.ts` (`defineEndpoint`/`defineQuery`/`definePathEndpoint`) — każdy zwraca `(req, options?) => Promise<Res>`, gotowy do `queryFn`/`mutationFn`. Callbacki (`successCallback`/`errorCallback`) żyją TYLKO w escape hatch `callHTTPEndpoint` (patrz sekcja EXCEPTIONS w `io.ts`). Deprecated fabryki `createIOFunction`/`createEndpointIO`/`createQueryIOFunction`/`createPathParamIOFunction` USUNIĘTE (FDX W2.5).

---

## 🚫 ANTI-PATTERNS

### ❌ Logika biznesowa w application

Business logic należy do `domain/`, nie `application/`

### ❌ Direct external dependencies

Zawsze używaj adapterów zamiast bezpośrednich importów zewnętrznych bibliotek

### ❌ Hardcoded values

Używaj ENV_VARS z environment.config zamiast hardcoded URLs/values

---

## 🎯 ZASADY

1. **Adapter dla każdej zewnętrznej biblioteki**
2. **Brak logiki biznesowej** - tylko infrastruktura
3. **Spójne nazewnictwo** - `.possibilities.api.ts` dla głównego API
4. **Error handling** - zawsze przez `reportIssueFrontend`
5. **Type safety** - wszystko typowane, zero `any`
6. **Małe pliki** - max 300 linii (ESLint rule)

---

**Ostatnia aktualizacja:** 2026-07-17 (doc-drift audit: lista modułów zsynchronizowana z realnymi katalogami, callback-pattern → promise-first io.ts)
