# LP Asset Library

Typowany rejestr statycznych assetów landing page'a (LP). Jedno miejsce na ścieżki, jeden sposób referowania, jeden guard.

## Biblioteka źródeł do przeglądu

Wszystkie odzyskane źródła i materiały używane przez UI są w [`assets-library`](../../../../assets-library/README.md). Podział: ilustracje, zdjęcia paznokci, zdjęcia kontekstowe, screeny, ozdobniki, marka i archiwum. Materiały do oceny leżą luźno w kategorii, obok folderów `zaakceptowane` i `odrzucone`. Zaakceptowanych plików generator nie zastępuje; ręczne poprawki właściciela można eksportować do pochodnych.

Manifest utrzymuje stabilne adresy po przeniesieniu źródła. `assets:check` sprawdza spójność, `assets:sync` tworzy optymalizowane pochodne bez sztucznego powiększania, `assets:open` otwiera Explorer Windows. `qualityLimited` oznacza brak większego odzyskanego źródła. Źródła rastrowe generatora mają różne wymiary, a limit szerokości ilustracji dobiera się do ich rzeczywistej rozdzielczości.

`ProcessIllustrationMolecule` zapewnia ramę i odstępy; ekrany i wzorniki pozostają częścią rysowanej ilustracji, bez nakładanych zdjęć (decyzja właściciela 2026-10-08). Źródło ilustracji nie jest zrzutem pełnego UI aplikacji.

## 1. Co to jest

`main/src/UI/assets/lpAssets.ts` to **SSOT ścieżek** statycznych assetów LP — obiekt `as const` (typowany, immutable). Grupuje ścieżki wg kategorii: `hero`, `portfolio`, `editorial`, `mockups`, `app`, `decor`, `steps`, `empty`, `cta`, `process`, `contextual`, `seo` (żywa lista = klucze pierwszego poziomu w `lpAssets.ts`). Zdjęcia i ilustracje są serwowane z `main/public/img/lp/`; grupa `seo` wskazuje pochodne marki z `main/public/`.

> Grupa **`app`** to zrzuty realnych ekranów produktu wstawiane w ramkę telefonu — **jedyna grupa z wymiarem JĘZYKA**: wpis to mapa `{ pl, en, de }`, bo na ekranie aplikacji jest tekst i polski telefon na niemieckiej stronie od razu zdradza atrapę (wybór ownera 2026-09-17). Ścieżkę wybiera hak `useAppScreenshots` (`useAppScreenshots.ts`) — **nie sklejaj jej z języka w komponencie**, bo audyt `asset-paths` weryfikuje istnienie plików tylko dla literałów z `lpAssets.ts`.
>
> **Tryb screenów:** wszystkie 60 zrzutów aplikacji w PL/EN/DE pokazuje rzeczywisty tryb ciemny. Te same ciemne screeny są używane w jasnym i ciemnym motywie LP; nie wybieraj wariantu obrazu na podstawie trybu strony.
>
> Re-capture: `npm run assets:screens` odtwarza niezamrożone źródła i synchronizuje pochodne. Konfiguracja: `docs/_TRACKERS/s111-app-screens/capture.cjs` + `shots-lp.json` (persona, trasa, przewinięcie i język per ekran; `locale` dokleja prefiks trasy), potem konwersja do webp 780 px. Zachowaj viewport 390×845 (ratio ramki 9:19.5), inaczej zrzut rozjedzie się w ramce.

Grupa **`process`** zawiera trzy ilustracje przebiegu pracy: `clientBeforeVisit`, `stylistPortfolio`, `clientConnection`. Każda ma rozmiar 1774 × 887 px; tłumaczone alty są w `visitMoments.processAlt`, `howItWorks.processAlt` i `playbook.connectionProcessAlt` odpowiednich stron.

Grupa **`contextual`** zawiera sześć osobnych ilustracji kontekstu: `home`, `clients`, `stylists`, `pricing`, `contact`, `getApp`. Podstawowe użycie odpowiada tematowi strony; ponowne użycie na innej stronie wymaga tego samego kontekstu funkcjonalnego. Ścieżki to `/img/lp/contextual/{home,for-clients,for-stylists,pricing,contact,get-app}.webp`; alty pochodzą z `pageIllustrationAlt` w przestrzeni tłumaczeń danej strony. Wymiary są jawne w komponencie, zgodne z proporcjami konkretnego obrazu.

Cel: zero raw stringów `"/img/lp/..."` rozsianych po komponentach. Literówka w ścieżce = błąd TS lub fail audytu, nie cichy 404 w produkcji.

## 2. Jak używać

Import **ścieżką względną** — `src/UI` nie ma aliasu `@/`:

```ts
import { LP_ASSETS } from "../../assets/lpAssets";

// bezpośrednio w JSX
<img src={LP_ASSETS.hero.heroNail01Nude} alt="..." />

// w strukturach danych
const slide = { img: LP_ASSETS.portfolio.nail01, label: "..." };
```

Klucze grup = `camelCase` stem nazwy pliku (np. `hero-nail-01-nude.webp` → `heroNail01Nude`).

Odświeżone zdjęcia, screeny i ilustracje SVG zachowują ścieżki plików, ale rejestr dodaje wersję zapytania przez `refreshedAsset` z `brandAssets.ts`. Jest to konieczne: produkcyjny optymalizator obrazów przechowuje warianty przez rok i pomiędzy wdrożeniami. `npm run assets:sync` automatycznie zmienia wersję w `src/UI/assets/lp-assets.config.json`. Optymalizator dopuszcza wersjonowane adresy własnych plików.

## 3. Jak dodać nowy asset

1. **Wrzuć plik** do `main/public/img/lp/<kategoria>/` (preferuj `.webp`).
2. **Dodaj wpis** (z metadanymi `altPl`/`altEn`, `style`, `length` itd.) do `main/public/img/lp/nail-bank-manifest.json`.
3. **Dodaj ścieżkę** do właściwej grupy w `lpAssets.ts` (klucz = `camelCase` stem pliku).
4. **Referuj** przez `LP_ASSETS.*` — **NIGDY** raw stringiem.

> **Alt żyje w DWÓCH miejscach — aktualizuj OBA.** Manifest (`altPl`/`altEn`) to katalog opisowy banku; realny `alt` renderowany na stronie idzie z kluczy i18n (`common.json` ×3 języki). Podmieniasz zdjęcie pod istniejącym slotem → wymień treść altu w manifeście **i** w kluczach i18n konsumenta (np. `static.forClients.portfolio.alt1`), inaczej alt opisuje poprzednie zdjęcie (drift z S39).

## 4. Guard

`tests/audit/asset-paths.sh` pilnuje dwóch reguł:

- **brak raw** `"/img/lp/"` poza rejestrem (wszystko musi iść przez `LP_ASSETS`),
- **każda ścieżka z rejestru istnieje** na dysku (brak martwych referencji).

Uruchom:

```bash
npm run audit:asset-paths
```

## 5. Powiązane

- `main/public/img/lp/nail-bank-manifest.json` — opisowy indeks banku: `altPl`/`altEn`, `style`, skin tone, aspect ratio, tagi. Źródło metadanych do `alt` i doboru zdjęć.
- `docs/DOMAIN/marketing/LP_IMAGE_PROMPTS.md` — prompty generacyjne, z których powstają assety.

## 6. Poza scope

- **Cloudinary / user-uploads** — osobny runtime (treści użytkowników), nie ten rejestr.
- **Inline CSS data-uri SVG ornaments** — zostają inline w stylach, nie trafiają tu.

SEO i pochodne marki należą do rejestru: `brandAssets.ts` definiuje `BRAND_ASSETS`, wspólny helper wersji `refreshedAsset` oraz wybór lokalizowanej karty `resolveDefaultOgAsset`; `LP_ASSETS.seo` odwołuje się do tego samego obiektu. BrandMark, Organization JSON-LD, PublicSeoHead, domyślne obrazy JSON-LD stron LP, fallbacki profili i endpointu OG oraz ikony dokumentu korzystają z tych źródeł. Absolutny URL powstaje dopiero przez dołączenie `SEO_CONFIG.domain`.

> `/logo.png` **istnieje** (512×512, sygnet nf z brand-sheeta, 2026-07-16) — konsumowany przez Organization JSON-LD (`buildOrganization.ts`). Dawny gap „JSON-LD odwołuje się do nieistniejącego pliku" zamknięty (MR360 #4).

## 7. Pochodne marki

Korekta właściciela z 2026-10-07: główny CTA w jasnym trybie ma kolor `#a6074f`, a sygnet i pochodne marki stonowany malinowy odcień. Geometria, alfa, białe litery, neutralny tekst i tła pozostały bez zmian. Poprzednie źródła są zachowane w bibliotece w `odrzucone`. Nie nakładaj dodatkowego filtra barwy w CSS. Favicon w czterech rozmiarach tworzy `node scripts/assets/favicon.mjs`, z blokadą podmiany zaakceptowanego źródła.

Adresy marki i kart OG korzystają z aktualnej wersji zapisanej w `lp-assets.config.json`. Zapytania ikon w statycznym `site.webmanifest` muszą odpowiadać tej wersji. `docs/DOMAIN/marketing/brand-sheet-nailfolio.png` jest historycznym, różowym materiałem źródłowym; aktualne kolory pochodzą z plików runtime. W repozytorium nie ma edytowalnego wektora sygnetu.

## 8. Lokalizowane karty społecznościowe

`brandAssets.ts` definiuje adresy domyślnych kart PL/EN/DE i `resolveDefaultOgAsset`. PublicSeoHead oraz domyślne obrazy JSON-LD wybierają język strony; własne zdjęcia i awatary zachowują swoje adresy. Karty EN/DE generuje `node main/scripts/generate-localized-og.mjs` uruchomione z katalogu głównego po buildzie frontendu. Renderer osadza aktualny `public/logo.png`, fonty Marcellus i Instrument Sans z buildu, kontroluje przepełnienie tekstu i zapisuje deterministyczne PNG 1200 × 630. Nie przerysowuje ani nie filtruje logo. Po zmianie źródłowego sygnetu wygeneruj ponownie karty EN/DE. Polska `og-default.png` zachowuje dotychczasowy układ karty marki.

## 9. Dobór źródeł po przeglądzie właściciela

Zaakceptowane oryginały są zamrożone w `assets-library`. Odrzucone źródła nie mają aktywnych celów publikacji; ich historyczne adresy mogą być aliasami pochodnych zaakceptowanego źródła. Powiązania i powody odrzucenia pozostają w `assets-library/manifest.json`. Nie regeneruj zaakceptowanych plików.

`assets:sync` tworzy także `static-asset-dimensions.json`: rozmiary faktycznych pochodnych przed optymalizatorem. `staticAssetWidth` i `staticAssetDimensions` pozwalają ograniczyć szerokie ilustracje i zdjęcia blogowe do gęstości Retina bez sztucznego powiększania źródła. Ilustracje zachowują bazowe WebP i otrzymują eksport SVG ze zdjęciem źródłowym w jakości 97 oraz wbudowanym logo Nailfolio. SVG omija ponowną kompresję AVIF optymalizatora. Duże zdjęcia LP używają jakości 95, a kadrowanie uwzględnia natywną rozdzielczość.

Nowe zdjęcia zespołu i kobaltowego manicure oraz poprawiona ilustracja kontaktu pozostają luźno do oceny. Ozdobniki są kontekstowe: wybór wzoru, konfiguracja portfolio i otwieranie aplikacji na telefonie. Nie dodawaj ich do dokumentów prawnych ani stron technicznych.

Screeny są aktualnym odczytem aplikacji w DEV, nie materiałem do głosowania. Ich źródłem jest `assets:screens`; używają zdjęć demonstracyjnych z odświeżonego banku DEV, opisanego w `scripts/assets/dev-demo-refresh-map.json`. Nie odtwarzaj starego banku zdjęć ani nie modyfikuj mediów produkcyjnych klientów.
