# FAZA 8 — Accessibility baseline (W8.0, pomiar-first, WCAG 2.1 AA)

> **Pomiar z 2026-06-14** (FDX FAZA 8 GATE) — zakres: static jsx-a11y (cały front) + axe-core runtime na 5 stron LP. Snapshot, NIE aktualny pełny obraz kontrastu: mega-sesja `/ui` S94-S98 (2026-08-19→21) poszła znacznie dalej z osobnym narzędziem — `npm run qa:contrast` (`scripts/qa-contrast-probe.cjs`), pomiar realnych pikseli (nie tylko axe-heurystyka) na **92 ekranach × 2 tryby, 9204 elementy tekstowe + 4636 fokusowalne, zero poniżej AA** (stan S98, `docs/MEMORY_AI/ui.md`) — obejmuje też trasy app/admin za logowaniem, których ten plik (poniżej) świadomie nie objął. Ten plik zostaje jako historia decyzji W8.x; dla aktualnego stanu kontrastu = `docs/MEMORY_AI/ui.md` (wpisy S94-S98) + rerun `qa:contrast`.
>
> Dwie warstwy pomiaru (per doktryna FDX): **static** = `eslint-plugin-jsx-a11y` (deterministyczny, per-commit ratchet); **runtime** = `axe-core` (`tests/a11y/axe-baseline.mjs` na żywym dev:3000 — łapie co static nie może: kontrast, runtime-ARIA, landmark/heading-order). NIGDY snapshot/asercja-po-DOM.

## Warstwa STATIC — eslint-plugin-jsx-a11y (W8.1-8.4)
Włączony (`flatConfigs.recommended`). Census: **29 naruszeń** w 21 plikach → **wszystkie naprawione** (WCAG-correct, 5 udokumentowanych eslint-disable edge-case):

| Reguła | # | Fix |
|---|---|---|
| no-redundant-roles | 4 | usunięty `role='list'` z `<ul>` |
| no-autofocus | 2 | `autoFocus`→useRef+useEffect focus-mgmt (Input.atom dostał forwardRef) |
| role-supports-aria-props | 2 | `aria-pressed` na `role='tab'`→`aria-selected` |
| aria-role (false-pos) | 4 | prop domenowy `role`→`roleValue` (nie ARIA) |
| label-has-associated-control | 3 | htmlFor/id + flatten label-grid |
| interactive-supports-focus | 1 | roving-tabindex onKeyDown na `<button role=tab>` (APG) |
| no-noninteractive-tabindex | 1 | usunięty z dzieci `role='img'` |
| no-interactive-element-to-noninteractive-role | 2 | wrapper `<div role=listitem>` zamiast na `<button>` |
| click/static/noninteractive-interactions | 5 | onKeyDown + scoped eslint-disable (defensive stopPropagation na dialog/landmark) |

**Ratchet:** jsx-a11y w eslint.config.mjs → nowe naruszenie = lint-fail (per-commit). To static-poprzeczka WCAG AA.

## Warstwa RUNTIME — axe-core (WCAG2a+2aa+21a+21aa) na 5 LP (home/for-stylists/pricing/get-app/contact)
Jedyny typ naruszenia: **color-contrast (serious)** — ZERO landmark/heading-order/ARIA-state (static + struktura je pokrywają). Wzorce:
1. Lang-switcher `#a2a2a2`/white 2.55:1 (każda strona).
2. Gold-as-readable-text `#e0b341` na jasnym 1.6-1.96:1 (CookieBanner link, eyebrow, anchor-banner).
3. Jasny tekst na purple-tint `#807cae` 3.1-3.94:1 (ForStylists problemPair).
→ **Naprawiane w W8.3** (kontrast); re-axe = 0 po fixie. Dekoracyjny gold (NumberMarker large-text 3:1 / aria-hidden) per-case.

## Zamknięte decyzje (RESPEKTOWANE)
- `prefers-reduced-motion` USUNIĘTY globalnie (2026-05-28) — NIE reintrodukowany; animacje bezwarunkowe.
- SEO-h1 = `<Eyebrow as='h1'>` (jeden h1/stronę) — nietknięte.
- a11y = jsx-a11y (static) + axe (runtime), NIGDY snapshot.

## Pomiar app-zone (auth-gated)
Gallery/sessions/dashboard wymagają loginu — runtime-axe (`axe-baseline.mjs`) poza LP nadal poza scope per-commit CI (static jsx-a11y pokrywa je deterministycznie). **Kontrast konkretnie** (nie pełny axe-runtime) jest już zmierzony za logowaniem przez osobne narzędzie: `npm run qa:contrast` loguje się i chodzi po trasach app/admin (92 ekrany total S98, w tym wszystkie 18 ekranów admina) — zob. notka na górze pliku. Owner-CI: rozszerzyć `axe-baseline.mjs` o pełny auth-flow (landmark/ARIA/heading-order za logowaniem) gdy potrzeba — to wciąż nie jest zrobione.
