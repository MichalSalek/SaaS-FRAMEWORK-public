# UI Architecture Guide

> **Ostatnia aktualizacja:** 2026-09-07 (doc-drift: tokeny kształtu `--style-*` zamiast wycofanej skali `--radius-*`; fonty przez role = Schibsted Grotesk + Instrument Sans). Wcześniej: 2026-08-02 (nazwy komponentów w przykładach → sufiksowane eksporty `ButtonAtom`/`LinkButtonAtom`; obowiązkowa konwencja sufiksu atomic + strażniki; `shared/smoothScroll.ts`; `PostHogIdentifyBridge` w provider-tree); 2026-07-17 sync provider tree/`assets`/`shared`; Frontend Migration DONE 2026-05-10.

---

## Stack

| Warstwa         | Technologia                                                | Lokalizacja                                                                                                                |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Styling         | CSS Modules + CSS Custom Properties                        | `UI/styles/` (tokens, palettes, global)                                                                                    |
| Components      | Natywne React + Base UI 1.0-rc.0 primitives                | `UI/components/` + `UI/primitives/`                                                                                        |
| Icons           | @phosphor-icons/react                                      | fill=active, regular=UI, duotone=premium                                                                                   |
| State (server)  | TanStack Query v5                                          | `application/http/queryClient.config.ts`                                                                                   |
| State (client)  | Zustand v5 (4 stores: devMode, cookieConsent, navigation, appSnackbar) | `application/stores/devMode.store.ts`, `application/stores/cookieConsent.store.ts`, `application/stores/navigation.store.ts`, `application/app-snackbar/appSnackbar.store.ts` |
| State (context) | React Context                                              | `UI/contexts/AuthContext.composition.tsx`                                                                                  |
| Data fetching   | Natywny fetch (nie axios)                                  | `application/http/http.possibilities.api.ts` + promise-first front-door `application/http/io.ts`                           |
| Routing         | Next.js Pages Router                                       | `pages/*.tsx` = thin shells, logika w `UI/features/`                                                                       |

## Struktura katalogow

```
UI/
├── assets/             # typed LP_ASSETS registry (lpAssets.ts) — patrz assets/README.md
├── components/         # reusable shared components (.tsx + .module.css; liczba = katalogi w components/)
│                       #   SegmentedControl (S122) = JEDYNY przełącznik segmentowy (tor + opcje, wybór =
│                       #   odwrócony atrament, jedno pokrętło wcięcia `--style-segmented-inset`, promień
│                       #   dziecka koncentryczny, tor nigdy się nie zawija w pigułce); lokalne kopie zakazane
├── primitives/         # 5 Base UI headless wrappers: AppDialog, AppSheet, AppMenu, AppModalShell, AppSelect
│                       #   AppSheet (S122) = boczny arkusz „szczegóły jednego rekordu" (admin: użytkownik, log),
│                       #   domyślnie od lewej, szeroki panel na desktopie, pełny ekran na telefonie, swipe zamyka
├── features/           # Domain-grouped page modules (per MIG-B*)
├── layouts/            # AppLayout, PublicLayout, AdminLayout, AdminPageLayout, AccountWebLayout (+ NVT: NavigationContentShell, NavigationTransitionController)
├── contexts/           # AuthContext.composition.tsx
├── hooks/              # shared hooki UI (useScrollLock, useScrollSpy, useShowOnScroll, useFocusTrap, …)
│                       #   + useSwipeDismiss (S122) — JEDYNY gest „przeciągnij, żeby zamknąć" (arkusze,
│                       #     szuflada, dialog pełnoekranowy, filtry galerii); nie pisać własnej matematyki palca
├── shared/             # cross-feature helpers: format/, interaction/, hooks/ (m.in. currentUser.query.ts)
│                       #   + smoothScroll.ts — rAF-owy smooth scroll IGNORUJĄCY prefers-reduced-motion
│                       #     (przeglądarki bramkują natywny smooth na tej preferencji; doktryna = animacje
│                       #     bezwarunkowo — DECISION w pliku, nie „naprawiaj" na scrollTo({behavior:'smooth'}))
├── styles/
│   ├── tokens.css      # Structural tokens (spacing, role --style-*, shadow=none, z-index, typography)
│   ├── global.css      # @layer cascade + reset
│   ├── themes/
│   │   └── palettes.css  # 1 paleta: rouge-papier × light/dark via [data-theme][data-mode] (charcoal-gold wycofany 2026-09-06, głos S105/S106)
│   └── ThemeContext.composition.tsx   # Theme + mode context + localStorage persistence
```

> Client-stores żyją w `application/stores/` (devMode, cookieConsent, navigation) + `application/app-snackbar/` — NIE w `UI/stores/` (katalog nie istnieje).

## Konwencje

**Komponent = plik `.tsx` + plik `.module.css` w tym samym katalogu.** Bez barrel files.

**Sufiks warstwy atomic jest OBOWIĄZKOWY — na pliku I na nazwie eksportu:** `Button.atom.tsx` → `ButtonAtom`,
`MidPageCta.molecule.tsx` → `MidPageCtaMolecule`, `LpHero.organism.tsx`, `Section.composition.tsx`.
Obowiązuje w CAŁYM `src/UI/**` (także `features/`), nie tylko w `components/`. Reguły przypisania warstwy
i rozstrzygnięcia graniczne: [`components/ATOMIC_LAYERS.md`](components/ATOMIC_LAYERS.md).
Strażnicy: `audit:atomic-coverage` (sufiksy) + `audit:ui-library-coverage` (każdy shared component ma wpis
w `UI/features/ui-library/uiLibrary.registry.ts`). Liczniki komponentów per warstwa celowo NIE żyją w docach —
policz z `ls`, bo katalog rośnie.

**Stylowanie:**

- Uzyj CSS Modules (`.module.css`) — SSOT tokenow: `var(--space-12)`, `var(--color-primary)`, `var(--style-radius-control)`
- Zero hardcoded kolorow/spacingow — ZAWSZE tokeny z `tokens.css` lub `palettes.css`
- Dynamiczne klasy: `clsx` (juz zainstalowany)

**State:**

- Server data → TanStack Query (`queryOptions()` pattern, `queryKeys.factory.ts`)
- UI state → `useState` (local), React Context (auth/theme), Zustand (devMode, cookieConsent, navigation, appSnackbar)
- NIE uzywa Redux (usuniety w ramach Frontend Migration, 2026-05-10)

**Pages:**

- `pages/*.tsx` = thin shells (~15 LOC): import feature component, export default
- Logika, hooky, UI zyja w `UI/features/[domain]/`

**DECISION (nie usuwaj tego komentarza):** Frontend `features/*` tną się po **ekranach/widokach**, nie 1:1 po backend bounded-contextach — `auth`/`dashboard`/`explore`/`stylist`/`static` nie mają własnej domeny backend. To celowe: organizacja kodu po widoku użytkownika, nie po DDD slice'ach.

**Dark mode:**

- Dwa atrybuty na `<html>`: `data-theme` (slug palety) + `data-mode` (light/dark)
- CSS: `[data-theme="rouge-papier"][data-mode="dark"]` selektory w `themes/palettes.css` (jedyna paleta)
- Zero-flash script w `_document.tsx` czyta localStorage przed hydration

### Kierunek akcji CTA (forward-arrow konwencja)

`ButtonAtom`/`LinkButtonAtom` (pliki `components/Button/Button.atom.tsx` i `LinkButton.atom.tsx` — sufiks warstwy jest na pliku **i** na nazwie eksportu, patrz [`components/ATOMIC_LAYERS.md`](components/ATOMIC_LAYERS.md)) mają prop `direction='forward'`. Strzałka niesie **semantykę kierunku akcji** — nie jest dekoracją. Decyzja ownera (S28/4=D), a od S126 (2026-10-08) strzałkę rysuje SAM prymityw: zawsze po etykiecie, we własnym rozmiarze i odstępie. `icon` to wyłącznie slot PRZED etykietą; propa strony ikony już nie ma (osiem przycisków „dalej” zapomniało go i pokazywało „→ Zatwierdź”).

**FORWARD-NAVIGATIONAL → `direction='forward'`.** Primary CTA, które **nawiguje, by popchnąć użytkownika dalej w lejku/ścieżce** (kolejny krok, inna trasa).

```tsx
// Funnel-pushing CTA na stronie statycznej / w lejku
<ButtonAtom
  direction='forward'
  variant='primary'
  size='lg'
  onClick={() => void router.push(ROUTES_FRONT.GET_APP)}>
  {t('finalCta.cta')}
</ButtonAtom>
```

Nie podawaj `ArrowRightIcon` / `CaretRightIcon` przez `icon=` ani w środku etykiety przycisku z tekstem: pilnuje tego `audit:forward-arrow-ownership` (skan AST). Przycisk z samą ikoną (bez etykiety, z `aria-label`) może być strzałką.

Przykłady kanonu: StickyCtaBar (site-wide), hero + final CTA stron `for-stylists`/`for-clients`/`for-studios`/`compare`/`get-app`, pricing hero + final, mid/final CTA `contact`/`help-center`/`legal`/`content-moderation`, „Przejdź do panelu" (recovery), „Dalej" (onboarding wizard step).

**IN-PLACE / FORM / TERMINAL → bez strzałki w prawo.** Akcja na **tej samej stronie**: submit formularza, otwarcie/potwierdzenie dialogu, toggle, zapis/usuń/wyślij/zaloguj/ponów. Ikona (jeśli jest) niesie własne znaczenie i zostaje po **lewej** — np. `FloppyDiskIcon` (zapis), `TrashIcon` (usuń), `ArrowsClockwiseIcon` (ponów), `PaperPlaneIcon` (wyślij). NIE dawaj strzałki-w-prawo akcji, która nie nawiguje dalej.

```tsx
// Submit formularza — ikona semantyczna po lewej, BEZ strzałki w prawo
<ButtonAtom variant='primary' type='submit' icon={<FloppyDiskIcon size={16} />}>
  {t('submitCta')}
</ButtonAtom>
```

**Ikona semantyczna ≠ strzałka.** CTA, które nawiguje, ale niesie ikonę o własnym znaczeniu (np. `HouseIcon` → strona główna, `CompassIcon` → eksploruj, `EyeIcon` → podgląd galerii), **zachowuje tę ikonę po lewej** — nie zastępujemy informacji generyczną strzałką. Strzałka-w-prawo jest dla CTA bez własnego znaczeniowego glifu (czysty sygnał kierunku lejka).

> **Klasyfikacja to konwencja, zapis to audyt.** Strażnik pilnuje, JAK strzałka jest zapisana, nie CZY przycisk powinien ją mieć. Klasyfikacja forward vs in-place wynika z **semantyki labela i celu akcji** (href/krok lejka vs mutacja-na-miejscu) — nie da się jej zgrepować jednym wzorcem. Przy nowym primary CTA: zadaj pytanie „czy to popycha użytkownika dalej w ścieżce?" — TAK → strzałka w prawo; NIE → bez. Przypadki niejednoznaczne zostaw konserwatywnie bez strzałki (lepiej brak niż zły kierunek).

## Provider tree (\_app.tsx)

```
QueryClientProvider > AuthProvider > ThemeProvider > NextIntlClientProvider > AppLifecycle > ErrorBoundary > AppDynamicMenu > Component
```

Obok `<Component>` (sibling, nie wrapper) montują się: `ImpersonationBanner`, render-null `NavigationTransitionController` (NVT), `AppSnackbarsController` (snackbary/toasty), `VerboseLogSync`, `CookieBanner`, `PostHogProvider` + `PostHogIdentifyBridge` + `AnalyticsScripts`.

## Query pattern

```typescript
// application/http/queryKeys.factory.ts — SSOT query keys
export const queryKeys = {
  gallery: { all: ['gallery'], byId: (id: string) => ['gallery', id] },
  // ... kolejne domeny (SSOT: queryKeys.factory.ts)
};

// W feature: uzyj queryOptions() z TQ v5
import { queryOptions, useQuery } from '@tanstack/react-query';
const galleryOptions = (id: string) =>
  queryOptions({
    queryKey: queryKeys.gallery.byId(id),
    queryFn: () => fetchGallery(id),
  });
```

## Responsive strategy (3 strefy)

| Strefa | Layout       | Responsive                                   | Breakpointy          |
| ------ | ------------ | -------------------------------------------- | -------------------- |
| Public | PublicLayout | Full responsive (mobile → desktop)           | 480, 768, 1024, 1280 |
| App    | AppLayout    | Mobile-only + desktop phone frame (>=1280px) | 480, 768, 1280       |
| Admin  | AdminLayout  | Desktop + tablet                             | 768, 1024            |

**Breakpointy (SSOT):** `< 480` base, `>= 480` SM, `>= 768` MD, `>= 1024` LG, `>= 1280` XL.

**Desktop phone frame (AppLayout, >=1280px):** Ramka 390x844 (iPhone 12 Pro) wycentrowana z sidebar slotem obok. `resolveDesktopAccess()` w `application/policies/desktop-access.policy.ts` decyduje: frame vs redirect vs normal.

**Bottom CTA (PublicLayout):** Sticky na mobile → inline w hero na desktop. NIE `display: none`.

## Kto niesie layout (JEDEN wzorzec)

**SSOT: feature-component renderuje layout. Page-shell jest cienki.** (FDX FAZA 4 / W4.3 — decyzja zamknięta.)

Każda trasa to para **page-shell** (`pages/**/*.tsx`) + **feature-component** (`UI/features/<domain>/<X>Page.tsx`):

| Warstwa               | Odpowiedzialność                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **page-shell**        | `getStaticProps`/`getServerSideProps` (i18n, dane), `<PublicSeoHead>`, `<JsonLd>` — i renderuje **jeden** feature. NIE importuje layoutu. |
| **feature-component** | Mountuje **swój** layout: `<PublicLayout>` / `<AppLayout>` / `<AdminLayout>` / `<AdminPageLayout>` wokół treści.                          |

```tsx
// pages/about.tsx — cienka skorupa
export default function About({ seoTitle, jsonLd }: Props) {
  return (
    <>
      <PublicSeoHead title={seoTitle} path='/about' />
      <JsonLd data={jsonLd} />
      <AboutPage /> {/* feature niesie PublicLayout w środku */}
    </>
  );
}

// UI/features/static/AboutPage.tsx — feature niesie layout
export function AboutPage() {
  return (
    <PublicLayout>
      <div className={styles.page}>{/* … */}</div>
    </PublicLayout>
  );
}
```

**Feature z wieloma stanami (loading/error/empty/main) → wzorzec wrapper:** wewnętrzny `XInner()` z early-returnami + eksportowany `X()` = `<Layout><XInner …props /></Layout>`. Każdy stan renderuje się w tej samej ramce. Wzór: `DashboardPage`, `GetStartedPage`, `AccountRecoveryPage`, `StatusPage`, `StylistProfilePage`.

**Dlaczego feature-carries, a NIE Next.js `getLayout`:**

- **Jedno źródło kompozycji** — `_app.tsx` trzyma provider-tree (Query/Auth/Theme/Intl/…); `getLayout` rozbiłby własność layoutu między `_app.tsx` a każdą stronę (dwa miejsca decyzji = dryf).
- **Layout dostaje kontekst feature'u** — tytuł AppBara (`useAppBarTitle`), `hideBottomNav`, role-aware warianty żyją w komponencie, nie w skorupie.
- **Zgodność z konwencją „thin shell"** (sekcja Konwencje → Pages): logika i UI w `UI/features/**`, skorupa ~15 LOC.

**Świadome wyjątki (z DECISION-comment przy miejscu):**

- `pages/maintenance.tsx` — celowo BEZ layoutu (pełny viewport podczas downtime).
- `pages/_error.tsx` / `404.tsx` / `500.tsx` — feature (`GenericErrorPage`/`NotFoundPage`/`ServerErrorPage`) niesie `PublicLayout` jak każdy inny; skorupa zostaje cienka.

**Strażnik:** `tests/audit/layout-consistency.sh` — fail gdy (1) jakikolwiek `pages/**` importuje prymityw layoutu, lub (2) pojawi się `getLayout`. Strukturalny, bez liczników.

## Motyw (finalny — voting zakończony)

Voting palet (35 → 5 → 1) ZAKOŃCZONY 2026-05-11; wynik zastąpiony głosem ownera S105/S106 (2026-09-06): jedyna paleta = **rouge-papier** (light+dark), SSOT: `UI/styles/themes/palettes.css`, slug eksportowany jako `DEFAULT_THEME` z ThemeContext (nigdy literał). Prototypowy ThemeSwitcher i `theme-votes.json` nie istnieją.

**Mechanizm:** produkcyjny `ThemeContext.composition.tsx` (CSS selektory `[data-theme][data-mode]`, localStorage persistence, zero-flash script w `_document.tsx`). Przełącznik light/dark/system dla usera = `ThemeSection.organism.tsx` w ustawieniach konta. Fonty: Schibsted Grotesk (nagłówki) + Instrument Sans (treść) przez role `--font-heading` / `--font-body` w `palettes.css` (Marcellus tylko w `BrandLockup`). Na powierzchni atramentowej (`--color-ink`) akcent bierze `--color-accent-on-ink`, nie `--color-primary`.

## Navigation transitions (NVT)

Przejscia stron = JEDEN kanal: FSM w `application/stores/navigation.store.ts` + render-null `NavigationTransitionController` (mount w `_app`, JEDYNY subskrybent `routeChangeStart/Complete/Error` i `beforePopState` — ratchet `audit:navigation-controller-singleton`). Zero View Transitions API (ratchet `audit:no-view-transition-api`).

- **Shell:** kazdy layout (App/Public/Admin/AccountWeb) renderuje `NavigationContentShellComposition` WEWNATRZ `<main id='main-content'>` — animuje sie tylko content, fixed chrome (AppBar/tabbar/drawer) stoi. Ratchet `audit:main-content-parity`.
- **CSS:** keyframes w `navigation-transition.module.css`, sterowane `html[data-nav-phase/policy/direction]` (pisze wylacznie kontroler — ratchet `audit:navigation-transition-ssot`).
- **Policy stref** (`application/policies/navigation-transition.policy.ts`): `/app/**` slide · public fade · login/welcome instant · guardy/pipeline/identity = `runInstant` · shallow/same-path poza FSM.
- **Nawigacja z kodu:** `useNativeRouter()` (push/replace/back) lub alias `useViewTransitionRouter()` — hook-navs maja gwarantowany pelny exit (exit-first-then-navigate, O19). Raw `router.push`/`<Link>` tez sa animowane (best-effort przez router events) — bez migracji call-sites.
- **Seamy module-level** (`application/routing/navigation.possibilities.api.ts`): `runNavigationIntent(intent, performNav)`, `runInstant(reason, performNav, targetUrl?)` (redirecty systemowe), `preserveNextScroll(reason)`.
- **Scroll/focus/a11y:** na complete reset OBU scrollerow (`#main-content` + window) poza `preserve` (Explore restore, locale-switch); po ustaniu przejscia focus na `#main-content`; `aria-busy` na main podczas faz.
- Kontrakt i decyzje (O1-O22): DECISION-comments w plikach rdzenia. Plan wykonawczy został usunięty po wdrożeniu, zgodnie z cyklem życia planów.

## Native app integration

Frontend jest serwowany w Capacitor WebView (Android/iOS). Pełne zasady, utility'sy i ograniczenia:

→ **[`NATIVE_INTEGRATION_GUIDE.md`](NATIVE_INTEGRATION_GUIDE.md)** — MUST DO / MUST NOT DO, platform detection, gotowe utility'sy:

- `application/platform/haptics.ts` — haptic feedback (impact, notification, selection)
- `application/platform/share.ts` — native share sheet z web fallback
- `application/platform/browser.ts` — external URL w in-app browser
- `application/lifecycle/AppLifecycle.tsx` — splash, back button, keyboard (auto)

## Layer Boundaries

```
@kernel/ (SSOT)     ← business rules, types, events, routing
       ↑
   domain/          ← business-aware IO (galleries, sessions, stylists)
       ↑
   application/     ← generic tech capabilities (HTTP, storage, auth, env)
       ↑
   UI/features/     ← React components, hooks, pages
```

**Dependency direction:** `UI → domain → application → @kernel/`. UI moze importowac zarowno z `domain/` jak i bezposrednio z `application/` (np. queryKeys, pushNewSnackbar). UI **nie** tworzy IO ani nie importuje `ENDPOINTS` — hook importuje gotową `{action}_IO` z `domain/**`. Strażnik: `tests/audit/io-layer.sh`.

**Reguła:** `application/` NIGDY nie importuje z `domain/`. Odwrotnie jest OK. Eslint `no-restricted-imports` wymusza to automatycznie.

**Unified IO front-door (FDX FAZA 2, W2.5 DONE):** jeden sposób deklaracji backendowego callu — `application/http/io.ts`. Każdy zwraca `(req, options?) => Promise<Res>` (promise-first, `Res` = rozpakowane `response.data`), gotowy do `queryFn`/`mutationFn` bez `toPromise`. Deprecated fabryki `createIOFunction`/`createEndpointIO`/`createQueryIOFunction`/`createPathParamIOFunction` USUNIĘTE.

| Front-door                                         | Kiedy używać                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `defineEndpoint({ url, mode })`                    | POST/PATCH/DELETE/GET bez query string                                                               |
| `defineQuery({ url, queryFields })`                | GET + query params (deklaratywny field mapper)                                                       |
| `definePathEndpoint(buildUrl, mode)(pathParam)`    | URL z path-param (np. `/staff/[id]`)                                                                 |
| `callHTTPEndpoint({ config, successCallback, … })` | Escape hatch (raw): load-bearing kolejność side-efektów / fire-and-forget — patrz EXCEPTIONS w io.ts |

## Referencje

- **Decyzje migracji (A1-A37):** `docs/DOMAIN/product/MIGRATION_DECISIONS.md`
- **Psychologia N1-N6:** `docs/DOMAIN/product/MIGRATION_DECISIONS.md`
- **Plan MIG-B1 (layouty + responsive + frame):** ✅ DONE (2026-05-10) — plik planu usunięty po wykonaniu
