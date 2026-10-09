# FAZA 7 — Performance baseline (W7.0, pomiar-first)

> **Pomiar z 2026-06-14** (commit `4196724`, FDX FAZA 7 GATE) — snapshot, NIE aktualny stan. Bundle chunk sizes (sekcja niżej) nie były przemierzone od tej daty; produkt urósł znacząco od tego czasu (motyw „Jeden krem", nowe ekrany sesji/galerii/admina). Odśwież `npm run analyze` (ANALYZE=true, webpack) przed powoływaniem się na te MB w decyzji. Dynamic-import i next/image liczniki niżej zostały zweryfikowane 2026-08-31 i skorygowane; chunk-size tabela jest wciąż z 06-14.
>
> Mierzone PO FAZIE 6 (finalny stan strukturalny). `next build --webpack` (Turbopack default w Next 16 konfliktuje z webpack-config bundle-analyzera; webpack-mode = ścieżka pomiarowa). Build = **exit 0** — produkcyjna kompilacja całego refaktoru (FAZA 0-6, w tym atomic rename 56 komp) PRZESZŁA.

## Bundle (uncompressed `.next/static/chunks`, ~÷3 dla gzip)

| Chunk | Rozmiar | Rola |
|---|---|---|
| 1051 / 9630 / 8419 | 300K / 288K / 264K | vendor/shared (React-DOM, TanStack Query, better-auth, next-intl) |
| `pages/_app` | 236K | app-shell (providery: Query, intl, theme, snackbar) |
| `framework` | 188K | React core |
| `main` | 148K | Next runtime |
| `polyfills` | 112K | legacy-browser polyfills (WebView-target) |
| `pages/ui` | 84K | żywa biblioteka `/ui` — **internal, POZA funnelem** (importuje 55 komp do renderu; nie wpływa na LP/app-load) |
| **Σ static/chunks** | **6.0M** | wszystkie route'y łącznie (uncompressed) |

Shared-baseline (każda strona): ~684K uncompressed (_app+framework+main+polyfills) ≈ **~210-230K gzip** — rozsądne dla stacku (React 19 + TQ v5 + next-intl + better-auth + next/image + next/font self-hosted).

## Status optymalizacji (evidence-first — W7.1/7.2/7.3)

| Obszar | Stan | Dowód |
|---|---|---|
| **W7.1 ikony** (tree-shake) | ✅ JUŻ | `next.config.mjs` `optimizePackageImports: [@phosphor-icons/react, @tanstack/react-query, better-auth, clsx, dayjs, next-intl, sonner]` — barrel-importy w 242 plikach auto-modularizowane przez Next. |
| **W7.1 dynamic import** (ciężkie below-fold) | ✅ JUŻ (zaktualizowano 2026-08-31) | 27 call-site'ów `dynamic(` łącznie (`grep -rn "= dynamic(" main/src --include=*.tsx \| wc -l`), z czego 19 w `pages/app/admin` (lazy admin-panel) i **8 poza adminem**: ImpersonationBanner (`_app.tsx`, świadomy `{ssr:false}`), StylistDashboard, ClientDashboard, AdminDashboard, ExploreStylistsTab, CropStep, ReportModal, MDXRemote. `QrScannerOverlay` usunięty razem z flow generowanych kodów QR (2026-07-12, stały QR pairing). Ciężkie modale/widoki lazy. |
| **W7.2 obrazy** | ✅ ŚWIADOMY MIKS (zaktualizowano 2026-08-31) | `next/image` w 17 plikach (LP/statyczne assety; `grep -rn "next/image" main/src --include=*.tsx --include=*.ts \| grep import \| cut -d: -f1 \| sort -u \| wc -l`). **13 raw `<img>`** w 10 plikach (gallery/sessions/admin/pairing) — WSZYSTKIE z `eslint-disable @next/next/no-img-element` + powodem w komentarzu: większość Cloudinary user-content (nieznany rozmiar/transformacje build-time), plus 2 wyjątki poza CDN (`BrandMark` — statyczny 14KB PNG, srcset = czysty narzut; `StylistPermanentCode` — client-generated data-URL QR). To NIE regres W7.2 — kategoria niepokryta pierwotnym pomiarem, który liczył tylko LP-assety. |
| **W7.3 fonty** | ✅ JUŻ | `next/font/google` (Inter/Marcellus/Caveat) — self-hosted WOFF2, CSS inline, `font-display: swap` + preload automatyczne (zero runtime-fetch do Google, potwierdzone w `_document.tsx`). |
| **W7.3 hydratacja** | ✅ STABILNA | Po FAZIE 3 (dekompozycja AppLayout) + mount-gate'y hydration (useCanGoBack, AccountPay). |

## Werdykt
Codebase jest **już rozsądnie zoptymalizowany** (wzorzec spójny z W4.5/W5.5/W6.4 — optymalizacje pre-addressed). FAZA 7 = **pomiar (ten plik) + ratchet hygieny (bundle-budget.sh) + DECISION-dokumentacja**, NIE sprint optymalizacji (evidence go nie uzasadnia — plan §FAZA 7: „zero zgadywania co optymalizować").

## Budżety / kontrakt nowego ekranu
- Shared-baseline gzip ≤ ~250K (obecnie ~210-230K). Wzrost = świadoma decyzja (nowa ciężka dep → optimizePackageImports + uzasadnienie).
- Nowy ekran: zero raw `<img>` (next/image), ciężki modal/widok poniżej folda → `next/dynamic`.
- Pełny per-route First Load JS: `npm run analyze` (ANALYZE=true, webpack) — manualnie/CI, NIE w per-commit audit (build za wolny). Per-commit guard = `bundle-budget.sh` (statyczna hygiena).
