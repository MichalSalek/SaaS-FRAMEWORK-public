# ATOMIC_LAYERS.md — Klasyfikacja warstw atomic design `src/UI/components/`

> **PO FQC (2026-06-14): klasyfikacja warstwowa pokrywa CAŁE `src/UI/**` — 326 component-files, nie tylko `components/`.** Maszynowy SSOT klasyfikacji = `tests/_reports/census-master.json` (plik→warstwa→target). Owner-dowód kompletności = `tests/_reports/frontend-coverage.md` (326/326=100%). Egzekucja = `audit:atomic-coverage` (exhaustion na całym src/UI; wchłonęło dawny `audit:atomic-layers`, retired 2026-06-25 jako ścisły podzbiór).
>
> **Ten plik = reguły + klasyfikacja podzbioru `components/` (56, FDX-baseline).** Reguły warstw są te same dla całego src/UI. Sufiks teraz na PLIKU **i** NAZWIE eksportu (`Button.atom.tsx`→`ButtonAtom`).
> **READ-ONLY artefakt klasyfikacyjny.**
>
> ⚠️ **Tabela poniżej to ZAMROŻONY snapshot z FDX, nie żywy spis `components/`.** Katalog od tamtej pory urósł
> (m.in. `BrandMark`=atom, `PiiText`=atom, `TurnstileWidget`=atom, `ErrorState`/`FeatureCard`/`MidPageCta`/`TrustProse`=molecule,
> `NavCard`/`InteractivePhoneDuo`/`InteractivePhoneStage`=organism) — **nie dopisujemy ich tutaj ręcznie.**
> Żywym źródłem klasyfikacji jest **sufiks na pliku** (`ls main/src/UI/components/<X>/`), egzekwowany przez
> `npm run audit:atomic-coverage`; dodatkowo każdy shared component musi mieć wpis w rejestrze
> `main/src/UI/features/ui-library/uiLibrary.registry.ts` (`npm run audit:ui-library-coverage`).
> Ten dokument czytaj dla **reguł warstw i rozstrzygnięć granicznych**, nie dla listy komponentów.

---

## Reguły warstw (zamknięte)

- **ATOM** — zero zależności od INNYCH komponentów `components/*`. Czysty prymityw (Button, Input, Chip, Avatar, Typography, Skeleton…). Może importować ikony Phosphor, util-y (`platform/*`), hooki, i18n — ale **żadnego `components/X`**.
- **MOLECULE** — komponuje atomy (importuje ≥1 atom, NIE organism/composition). Mały, reużywalny klocek złożony (Card, SectionHeader, StickyCtaBar, PhoneMockup, Accordion…).
- **ORGANISM** — sekcja/sterowanie komponująca molekuły+atomy (lub ≥1 inny organism); samodzielny blok treści/nawigacji (LpHero, AppBar, AppDrawer, FinalCtaBand, Gallery* sekcje, HeaderUserMenu, CookieBanner…).
- **COMPOSITION** — layout/orkiestracja, **nie UI-treść** (Section, ErrorBoundary, JsonLd, PublicSeoHead, InfiniteScrollTrigger).

**Graniczne (rozstrzygnięte z góry):** `Section`=composition · `SectionHeader`=molecule · `AppHero`=organism · `StatusPill`/`PlanBadge`=atom · `BillingToggle`=molecule.

---

## Tabela klasyfikacji (56)

| Komponent | Warstwa | Component-deps (`components/*`) | Uzasadnienie graniczne |
|---|---|---|---|
| Accordion (`AccordionItem.tsx`) | molecule | — | Klocek złożony (header+panel, ARIA, animacja); zero deps, ale rola = molecule (anchor promptu). Folder bez `Accordion.tsx` — main = `AccordionItem.tsx`. |
| AppBar | organism | — | Pasek nawigacji app-level (focus-trap, hooki); zero component-deps, ale sekcja-chrome → organism (anchor). |
| AppDrawer | organism | — | Szuflada nawigacji app-level (sekcje admin/user, auth, feature-flags). Zero deps przez sibling — komponuje własne pod-pliki `appDrawerSections*.tsx`. |
| AppHero | organism | Eyebrow | Hero sekcji app (anchor graniczny: organism mimo 1 atomu). |
| Avatar | atom | — | Prymityw. |
| BillingToggle | molecule | — | Anchor graniczny: molecule mimo zero deps (kontrolka rozliczeń). |
| BottomTabBar | organism | — | Nawigacja zakładek app-level; zero deps, ale chrome-sekcja → organism (anchor). |
| Button | atom | — | Prymityw. |
| Card | molecule | — | Anchor: molecule. Strukturalnie 0 deps (container + sub-komponenty Header/Content/Actions), ale rola = compound klocek → molecule. |
| Checkbox | atom | — | Prymityw. |
| Chip | atom | — | Prymityw. |
| ColorDot | atom | — | Prymityw. |
| ColorSwatch | molecule | ColorDot | **Konflikt anchor↔reguła:** prompt wymienia ColorSwatch w liście atomów (lista ilustracyjna, `…`), ale realnie importuje atom ColorDot → reguła wiążąca „atom=0 deps" daje **molecule**. Honoruję regułę wiążącą. |
| CookieBanner | organism | Button, Toggle, Typography | Baner zgody app-level komponujący atomy (anchor organism). |
| CreateSessionModal | organism | Avatar, Button, Typography | Modal-sekcja komponujący atomy (anchor organism). |
| ErrorBoundary (flat) | composition | — | Orkiestracja błędów, nie UI-treść (anchor). Plik flat. |
| ExternalLink | atom | — | Prymityw (link + util `platform/browser`). |
| Eyebrow | atom | — | Prymityw. |
| FaqSection | molecule | Accordion, SectionHeader | **Anchor graniczny:** prompt = molecule, mimo że komponuje dwie molekuły (Accordion+SectionHeader). Honoruję anchor (sekcja FAQ jako reużywalny klocek). |
| FinalCtaBand | organism | — | Band CTA sekcji (anchor organism); zero deps, renderuje własny markup sekcji. |
| GalleryFilterOverlay | organism | Button, ColorSwatch, GalleryQuickFilters, Input | Overlay filtrów galerii (`Gallery*`). |
| GalleryFilterSection | organism | GalleryFilterOverlay | Sekcja filtrów galerii (`Gallery*`). |
| GalleryLayoutToggle | atom | — | **Graniczna:** prefiks `Gallery*` ≠ automatyczny organism. 48-liniowy toggle widoku (2 przyciski ikon, zero deps) = prymityw → atom (struktura rządzi nad prefiksem). |
| GalleryPhotoCard | organism | Chip, ColorDot, ImagePlaceholder | Karta zdjęcia galerii (`Gallery*`, komponuje atomy). |
| GalleryQuickFilters | organism | Chip, ColorSwatch | Szybkie filtry galerii (`Gallery*`). |
| GalleryStrength | organism | Card, Typography | Widżet siły profilu (gamifikacja, `Gallery*`); komponuje molekułę Card + atom Typography. |
| HeaderUserMenu | organism | Avatar, Button | Menu użytkownika w headerze (anchor organism). |
| ImagePlaceholder | atom | — | Prymityw (placeholder + ikona). |
| InfiniteScrollTrigger (flat) | composition | Progress | Orkiestracja paginacji (IntersectionObserver), nie UI-treść (anchor). Plik flat. Importuje atom Progress jako wskaźnik — pozostaje composition (rola = mechanizm scrolla, nie klocek treści). |
| InkPanel | atom | — | Prymityw (panel powierzchni). |
| Input | atom | — | Prymityw. |
| JsonLd | composition | — | Wstrzyknięcie `<script type=ld+json>`, nie UI-treść (anchor). |
| LpHero | organism | Eyebrow | Hero landing page (anchor organism, 1 atom). |
| NumberMarker | atom | — | Prymityw (znacznik liczbowy). |
| PhoneMockup | molecule | — | Anchor: molecule (mockup telefonu jako reużywalny klocek; zero deps). |
| PhoneQuoteStrip | organism | PhoneMockup | Sekcja komponująca molekułę PhoneMockup → organism. |
| PlanBadge | atom | — | Prymityw (anchor graniczny: atom). |
| PriceSlot | atom | — | Prymityw (slot ceny). |
| Progress | atom | — | Prymityw (pasek postępu). |
| PublicSeoHead | composition | — | Orkiestracja `<Head>`/meta, nie UI-treść (anchor). |
| Section | composition | — | Layout-wrapper sekcji (anchor graniczny: composition, NIE organism). |
| SectionHeader | molecule | Eyebrow | Anchor graniczny: molecule (komponuje atom Eyebrow). |
| Select | atom | — | Prymityw. |
| ShareButton | atom | — | Prymityw (1 button + util `platform/share`, zero component-deps). |
| Skeleton | atom | — | Prymityw. |
| StatsBand | molecule | — | Anchor: molecule (band statystyk; zero deps, renderuje listę StatItem). |
| StatusPill | atom | — | Prymityw (anchor graniczny: atom). |
| StepsSection | organism | NumberMarker | Sekcja kroków komponująca atom NumberMarker → organism (anchor). |
| StickyCtaBar | molecule | Button, Typography | Anchor: molecule (sticky baner CTA komponujący atomy). |
| SupportFloatingButton | organism | — | Widżet FAB app-chrome z logiką path-aware visibility; samodzielny blok sterowania → organism (peer CookieBanner). Zero component-deps. |
| Toggle | atom | — | Prymityw. |
| TrialCountdownBanner | molecule | Button | Baner odliczania trialu komponujący atom Button → molecule (peer StickyCtaBar). |
| TrustSignals | molecule | — | Anchor: molecule (zero deps, renderuje listę TrustItem). |
| TrustStatsSection | organism | Section, StatsBand | Sekcja komponująca composition Section + molekułę StatsBand → organism (anchor). |
| Typography | atom | — | Prymityw. |

---

## Decyzja sufiksowa

- **Sufiks na `.tsx`, NIE na `.module.css`.** `X/X.tsx` → `X/X.{layer}.tsx`; `X/X.module.css` zostaje bez zmian.
- **Bez barreli** — projekt używa direct imports (decyzja MIG, `db_models` bez barrel). Nie wprowadzamy nowych `index.ts`.
  **Wyjątki, które ISTNIEJĄ i są żywe** (nie kasuj ich „bo dokument zabrania" — mają realnych konsumentów):
  `components/JsonLd/index.ts` (składa `JsonLdComposition` + `ORGANIZATION_JSONLD` + `WEBSITE_JSONLD`, importowany przez ~20 stron `pages/**`)
  oraz `features/admin/AdminAiCrawlersPage/index.ts`. Reguła dotyczy dokładania KOLEJNYCH barreli, nie tych dwóch.
- **Import-path:** `components/X/X` → `components/X/X.{layer}` (np. `'../Button/Button'` → `'../Button/Button.atom'`).
- **Pliki flat** (`ErrorBoundary.tsx`, `InfiniteScrollTrigger.tsx`) → `ErrorBoundary.composition.tsx`, `InfiniteScrollTrigger.composition.tsx` (import-path `components/ErrorBoundary` → `components/ErrorBoundary.composition`).
- **Pliki pod-komponentów w folderze** (np. `GalleryFilterOverlay/FilterSections.tsx`, `AppDrawer/appDrawerSections.tsx`, `Accordion/AccordionItem.tsx`) — sufiks dotyczy **głównego entry pliku** zgodnego z nazwą folderu. Accordion: główny entry = `AccordionItem.tsx` (folder nie ma `Accordion.tsx`) → `AccordionItem.molecule.tsx`. Pod-pliki bez sufiksu (chyba że orchestrator zdecyduje inaczej) — to nie są publiczne komponenty z listy 54.

### Dynamic imports — bezpieczne dla renumeracji

`grep -rn "import(" src/ | grep "components/"` → 6 trafień: 5 celuje w `features/*/components/*` (feature-local: ReportModal, CropStep, StylistDashboard, ClientDashboard, ExploreStylistsTab), 1 to zewnętrzny `posthog-js` w `ErrorBoundary.composition`. **Żaden nie importuje dynamicznie shared `UI/components/*`**. Dodatkowy grep po `dynamic()` z naszymi nazwami = 0 trafień. **Brak string-importów (których typecheck nie złapie) do shared `UI/components/*` — rename bezpieczny przez tsc.**

---

## Rozkład liczbowy

| Warstwa | Liczba |
|---|---|
| atom | 21 |
| molecule | 11 |
| organism | 19 |
| composition | 5 |
| **RAZEM** | **56** |

---

## Mapping do renumeracji (machine-readable)

```
Accordion molecule
AppBar organism
AppDrawer organism
AppHero organism
Avatar atom
BillingToggle molecule
BottomTabBar organism
Button atom
Card molecule
Checkbox atom
Chip atom
ColorDot atom
ColorSwatch molecule
CookieBanner organism
CreateSessionModal organism
ExternalLink atom
Eyebrow atom
FaqSection molecule
FinalCtaBand organism
GalleryFilterOverlay organism
GalleryFilterSection organism
GalleryLayoutToggle atom
GalleryPhotoCard organism
GalleryQuickFilters organism
GalleryStrength organism
HeaderUserMenu organism
ImagePlaceholder atom
InkPanel atom
Input atom
JsonLd composition
LpHero organism
NumberMarker atom
PhoneMockup molecule
PhoneQuoteStrip organism
PlanBadge atom
PriceSlot atom
Progress atom
PublicSeoHead composition
Section composition
SectionHeader molecule
Select atom
ShareButton atom
Skeleton atom
StatsBand molecule
StatusPill atom
StepsSection organism
StickyCtaBar molecule
SupportFloatingButton organism
Toggle atom
TrialCountdownBanner molecule
TrustSignals molecule
TrustStatsSection organism
Typography atom
```

### Pliki flat (osobno — bez folderu, sufiks na pliku bezpośrednio)

```
ErrorBoundary composition
InfiniteScrollTrigger composition
```

> **Uwaga dla orchestratora:** Accordion main-entry = `AccordionItem.tsx` (nie `Accordion.tsx`). Mapping powyżej liczy folder „Accordion" jako 1 komponent; przy rename sufiks idzie na `AccordionItem.tsx` → `AccordionItem.molecule.tsx`.
