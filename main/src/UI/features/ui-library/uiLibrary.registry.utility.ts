import type { UiLibraryEntryMeta } from './uiLibrary.types';

/**
 * Druga część rejestru biblioteki komponentów (grupa „pomocnicze”), wydzielona
 * z `uiLibrary.registry.ts`, gdy plik danych doszedł do limitu długości (S126).
 * Strażnik `audit:ui-library-coverage` czyta WSZYSTKIE pliki
 * `uiLibrary.registry*.ts`, więc wpis w dowolnym z nich liczy się tak samo.
 */

/* ─── UTILITY / LAYOUT (in-app pomocnicze) ─── */

export const UTILITY_ENTRIES = {
  colorSwatch: {
    id: 'color-swatch',
    name: 'ColorSwatch',
    importPath: 'src/UI/components/ColorSwatch/ColorSwatch.molecule',
    status: 'DRAFT',
    whenToUse:
      'ColorDot + podpisana nazwa koloru, klikalny (button + aria-pressed) gdy podasz onClick, statyczny (span) bez niego; inline = poziomy wiersz do podsumowań. Układaj w ColorSwatchGrid. Hex pochodzi z DB (nie token — legalny literal).',
  },
  imagePlaceholder: {
    id: 'image-placeholder',
    name: 'ImagePlaceholder',
    importPath: 'src/UI/components/ImagePlaceholder/ImagePlaceholder.atom',
    status: 'DRAFT',
    whenToUse:
      'Honest placeholder w miejscu brakującego obrazu (ikona galerii na neutralnym polu) — NIGDY pusty kwadrat. Rozmiary sm/md/lg; używany m.in. przez GalleryPhotoCard gdy asset_url puste.',
  },
  externalLink: {
    id: 'external-link',
    name: 'ExternalLink',
    importPath: 'src/UI/components/ExternalLink/ExternalLink.atom',
    status: 'DRAFT',
    whenToUse:
      'Link do zewnętrznego URL otwierany przez platform/browser.openExternalUrl (Capacitor-safe: in-app browser na natywce, nowa karta na webie) zamiast gołego target="_blank". Zawsze rel="noopener noreferrer"; preventDefault + deleguje do utila.',
  },
  shareButton: {
    id: 'share-button',
    name: 'ShareButton',
    importPath: 'src/UI/components/ShareButton/ShareButton.atom',
    status: 'DRAFT',
    whenToUse:
      'Przycisk udostępniania przez platform/share.shareContent (natywny share sheet, fallback: kopiuj-link z 2s feedbackiem „skopiowano"). Strona podaje url/title/text; label domyślnie z i18n. fullWidth dla CTA na pełną szerokość.',
  },
  errorBoundary: {
    id: 'error-boundary',
    name: 'ErrorBoundary',
    importPath: 'src/UI/components/ErrorBoundary.composition',
    status: 'DRAFT',
    whenToUse:
      'Klasowy React error boundary: łapie render-crash poddrzewa, raportuje do EventLog (reportIssueFrontend) i pokazuje fallback (tytuł + „Spróbuj ponownie", opcjonalnie „Wróć na stronę główną"). Owija ryzykowne poddrzewa; tytuł/akcje przekazujesz przetłumaczone (class component nie czyta hooków).',
    noRenderReason:
      'renderuje dzieci dopóki nie poleci wyjątek — fallback pokazuje się WYŁĄCZNIE po render-crashu, więc nie ma stabilnego inline-demo bez sztucznego rzucania błędu w katalogu. Kanon użycia: owijka w layoutach (PublicLayout/AppLayout).',
  },
  infiniteScrollTrigger: {
    id: 'infinite-scroll-trigger',
    name: 'InfiniteScrollTrigger',
    importPath: 'src/UI/components/InfiniteScrollTrigger.composition',
    status: 'DRAFT',
    whenToUse:
      'Sentinel IntersectionObserver dla nieskończonego scrolla (TanStack Query useInfiniteQuery): wpada w viewport → woła onFetchNextPage gdy hasNextPage i nie trwa fetch; w trakcie pokazuje Progress spinner. Wstawiasz na końcu listy.',
    noRenderReason:
      'renderuje pusty sentinel-div (spinner tylko w trakcie isFetchingNextPage) — czysta mechanika obserwatora bez samodzielnego wizualu. Dowód działania: dowolna lista z useInfiniteQuery (explore / galeria).',
  },
  jsonLd: {
    id: 'json-ld',
    name: 'JsonLd',
    importPath: 'src/UI/components/JsonLd/JsonLd.composition',
    status: 'DRAFT',
    whenToUse:
      'Wstrzykuje structured data schema.org do <Head> jako <script type="application/ld+json"> (pojedynczy obiekt lub tablica → osobne tagi). data: unknown świadomie (patrz DECISION — payloady schema.org mieszają typy). Helpery payloadów: *PageJsonLd.ts per strona.',
    noRenderReason:
      'emituje wyłącznie niewidoczne <script type="ld+json"> do <Head> — zero wizualu na stronie. Weryfikacja: źródło HTML / Rich Results Test, nie podgląd w katalogu.',
  },
  publicSeoHead: {
    id: 'public-seo-head',
    name: 'PublicSeoHead',
    importPath: 'src/UI/components/PublicSeoHead/PublicSeoHead.composition',
    status: 'DRAFT',
    whenToUse:
      'SSOT meta-bloku stron publicznych: <title>, description, canonical, hreflang (pl/en/de + x-default), OG i Twitter Card. Strona podaje title/description (+ opcjonalnie ogType article/profile, noindex, rssFeed); URL-e budowane z SEO_CONFIG + locale (patrz DECISION — trailingSlash + locale-prefix krytyczne dla SEO).',
    noRenderReason:
      'emituje wyłącznie tagi <meta>/<link> do <Head> — zero wizualu. Weryfikacja: źródło HTML / audyt SEO (i18n parity, canonical), nie podgląd w katalogu.',
  },
  pii: {
    id: 'pii',
    name: 'Pii',
    importPath: 'src/UI/components/Pii/PiiText.atom',
    status: 'DRAFT',
    whenToUse:
      'Firma, NIP i adres na froncie idą przez ten atom albo tokeny __PII_*__, żeby crawler i logi nie widziały danych osobowych.',
    noRenderReason:
      'odsłania prawdziwe dane dopiero po interakcji użytkownika; w katalogu zostałby placeholder albo wyciek PII.',
  },
  turnstile: {
    id: 'turnstile',
    name: 'Turnstile',
    importPath: 'src/UI/components/Turnstile/TurnstileWidget.atom',
    status: 'DRAFT',
    whenToUse:
      'Na publicznym formularzu widget Cloudflare ładuje się po zaufanej interakcji i daje jednorazowy token anty-spam.',
    noRenderReason:
      'wymaga klucza Cloudflare i interakcji użytkownika; w katalogu nic nie pokaże albo wciągnie challenge z produkcji.',
  },
  pageColumns: {
    id: 'page-columns',
    name: 'PageColumns',
    importPath: 'src/UI/components/PageColumns/PageColumns.molecule',
    status: 'DRAFT',
    whenToUse:
      'Jedyny szkielet dwóch kolumn ekranów aplikacji: `main` = to, co się ROBI (rzeczy czekające, główna akcja, lista), `aside` = to, co się CZYTA (liczby, link do udostępnienia, notatki). Dzieli się od 720 px WŁASNEJ szerokości (zapytanie kontenerowe), więc w ramce telefonu zostaje jedna kolumna. Bez `aside` trzyma czytelną miarę 720 px. Kolumna boczna nie jest przyklejona.',
    noRenderReason:
      'Szkielet układu bez własnego wyglądu; żywe użycia wchodzą z falą ekranów S126.',
  },
  disclosure: {
    id: 'disclosure',
    name: 'Disclosure',
    importPath: 'src/UI/components/Disclosure/Disclosure.molecule',
    status: 'DRAFT',
    whenToUse:
      'Sekcja drugorzędna zwinięta do JEDNEJ linii: tytuł, opcjonalnie krótki stan (postęp, liczba) i strzałka; treść otwiera się w miejscu (grid-rows 0fr→1fr, 200 ms, `inert` gdy zamknięta, aria-expanded + aria-controls). `surface="box"` (domyślnie) = biała karta na papierze, `surface="plain"` = wewnątrz karty, która już istnieje. Sterowana (`open` + `onOpenChange`) albo niesterowana (`defaultOpen`); `headingAs` dobierz z konspektu strony. Gdy wyzwalaczem jest WŁASNY przycisk („Pokaż pozostałe (N)”, „Dodaj wizytę”), weź samo ciało: `DisclosurePanelAtom` z tego samego katalogu (`id`, `open`) i daj przyciskowi aria-expanded + aria-controls. Nie do FAQ (AccordionItem) i nie zamiast dialogu.',
    noRenderReason:
      'Wpis dodany w fali S126 razem z prymitywem; żywe użycia: lista kroków na pulpicie stylistki, starsze urządzenia w „Bezpieczeństwo”, formularz wizyty na karcie klientki.',
  },
  appMenu: {
    id: 'app-menu',
    name: 'AppMenu',
    importPath: 'src/UI/primitives/AppMenu.atom',
    status: 'DRAFT',
    whenToUse:
      'Menu rozwijane (Base UI): `AppMenuAtom` + `.Content` + `.Item` (+ `.Separator`, `.Submenu`). Menu „więcej” w wierszu listy dostaje gotowy wyzwalacz `AppMenuAtom.MoreTrigger` (przycisk 44 px z trzema kropkami; `label` = dostępna nazwa z podmiotem wiersza, `className` tylko do ustawienia w wierszu): nie styluj własnego. Pozycja ma 44 px wysokości; akcja, która coś usuwa lub rozłącza, to `tone="danger"` (kolor etykiety, bez tła). Wyzwalacz, który nie jest trzema kropkami (chip konta, dzwonek), używa `AppMenuAtom.Trigger`. Wiersz ma JEDNĄ kontrolkę na końcu: albo to menu, albo AffordanceDisc.',
    noRenderReason:
      'Popup żyje w portalu i otwiera się po interakcji; żywe użycia: lista klientek, lista rozmów, zespół salonu, profil stylistki.',
  },
  systemNotice: {
    id: 'system-notice',
    name: 'SystemNotice',
    importPath: 'src/UI/components/SystemNotice/SystemNotice.organism',
    status: 'DRAFT',
    whenToUse:
      'Jedyne intro stron systemowych (404, 500, błąd ogólny, sprawdzanie połączenia): tytuł h1, JEDNO zdanie o tym, co się stało, akcje (jedna wypełniona, najwyżej jedna outlined obok), opcjonalnie rysunek nad tytułem i cicha linia `meta` pod akcjami. Informacja na papierze, bez karty. Kolumnę strony dają klasy z tego samego modułu CSS.',
    noRenderReason:
      'Renderuje nagłówek h1 całej strony; drugi h1 w katalogu psułby konspekt. Żywe użycia: /404, /500, strona błędu, /connection-check.',
  },
  dataTable: {
    id: 'data-table',
    name: 'DataTable',
    importPath: 'src/UI/components/DataTable/DataTable.organism',
    status: 'DRAFT',
    whenToUse:
      'Jedyna tabela list z danymi (admin: logi, konta, zgłoszenia). Od 768 px WŁASNEJ szerokości prawdziwa tabela z wyrównanymi kolumnami, węziej każdy wiersz staje się kartą (kolumny mają priorytet: główna, druga linia, meta). Sama niesie stany: ładowanie, pusto, błąd z ponowieniem. Wiersz może być linkiem albo przyciskiem. Tylko w układzie tabeli: sortowanie nagłówkiem (`sort` + `sortable` kolumny) oraz checkboxy wierszy z paskiem działań zbiorczych (`selection`). Kolumna z menu wiersza dostaje `action: true`: w układzie kart menu stoi w prawym górnym rogu karty. Zaznaczony wiersz (`selectedKey`) to odwrócony atrament, a pigułki i drugi tekst w nim same przechodzą na jasny atrament. Głos `s126-admin` (2026-10-09) wygrał układ DZIŚ: strony admina zostają przy swojej strukturze, a WSZYSTKIE ich listy stoją na tej tabeli.',
    noRenderReason:
      'Potrzebuje danych i stanu listy (sort, zaznaczenie, strona); żywe użycia: każda lista w /app/admin (logi, konta, audyt, wsparcie, ogłoszenia, crawlery, harmonogram e-maili, zdrowie, pulpit).',
  },
  pagination: {
    id: 'pagination',
    name: 'Pagination',
    importPath: 'src/UI/components/Pagination/Pagination.molecule',
    status: 'DRAFT',
    whenToUse:
      'Jedyna paginacja. Tryb `pages`, gdy serwer zna liczbę stron (strona N z M), tryb `cursor` dla list, które wiedzą tylko „jest więcej” (wstecz i dalej). Sama rysuje strzałki, a teksty dostaje od wywołującego. Układa się z WŁASNEJ szerokości: poniżej 520 px „Poprzednia” i „Następna” zostają samymi strzałkami (nazwy niesie `aria-label`), więc numery stron i oba kroki mieszczą się w jednej linii. Jedyna paginacja list admina (głos `s126-admin`, 2026-10-09).',
    noRenderReason:
      'Potrzebuje stanu strony listy; żywe użycia: /app/admin/logs, /app/admin/users, /app/admin/audit, /app/admin/moderation, /app/admin/notes.',
  },
  filterBar: {
    id: 'filter-bar',
    name: 'FilterBar',
    importPath: 'src/UI/components/FilterBar/FilterBar.molecule',
    status: 'DRAFT',
    whenToUse:
      'Jedyny pasek filtrów nad listą: szukajka, kontrolki wymiarów (dzieci), gotowe zakresy, „Wyczyść” tylko gdy coś jest ustawione i jedna linia mówiąca, do czego lista jest zawężona. Poniżej 720 px własnej szerokości zwija się do szukajki i przycisku „Filtry N”, a poniżej 480 px szukajka zajmuje cały wiersz (obok przycisku jej podpowiedź była ucinana). „Wyczyść filtry” jest zawsze widoczne: bez ustawionych filtrów wyłączone i w neutralnym atramencie. Nigdy przyklejony. Jedyny pasek filtrów list admina (głos `s126-admin`, 2026-10-09).',
    noRenderReason:
      'Potrzebuje stanu filtrów listy; żywe użycia: /app/admin/logs, /app/admin/users, /app/admin/audit, /app/admin/support, /app/admin/moderation, /app/admin/permissions, /app/admin/ai-crawlers.',
  },
  softBreakText: {
    id: 'soft-break-text',
    name: 'SoftBreakText',
    importPath: 'src/UI/components/SoftBreakText/SoftBreakText.atom',
    status: 'DRAFT',
    whenToUse:
      'Techniczny ciąg, który wolno złamać TYLKO po jego łącznikach: adres e-mail, klucz zdarzenia albo uprawnienia, ścieżka. Wstawia `<wbr>` po `_ - . @ / :`. Bez tego komórka z `overflow-wrap: anywhere` łamała ciąg tam, gdzie skończyła się linia („ACCOUNT_CHECKO|UT_SESSION”, „@e|xample.com”). Zwykłego tekstu nie owijać.',
    noRenderReason:
      'Efekt widać dopiero w wąskiej komórce z prawdziwymi danymi; żywe użycia: tabele kont i wsparcia, macierz uprawnień, flagi, konfiguracja, logi w adminie.',
  },
  statTile: {
    id: 'stat-tile',
    name: 'StatTile',
    importPath: 'src/UI/components/StatTile/StatTile.molecule',
    status: 'DRAFT',
    whenToUse:
      'Liczba z nazwą. Trzy zachowania: sama informacja (płasko, bez powierzchni klikalnej), link do listy, którą liczba liczy, albo filtr listy poniżej (wybrany kafel = odwrócony atrament). `StatTileBandMolecule` układa kafle w jednym boksie i trzyma wartości jednego rzędu na jednej linii, także gdy etykiety mają różną liczbę linii. Liczba, która coś liczy, ZAWSZE prowadzi do swoich pozycji.',
    noRenderReason:
      'Kafle liczą żywe dane konta; żywe użycia: panel boczny dashboardu stylistki, sekcja zużycia na koncie oraz pulpit, zdrowie, flagi, ogłoszenia, crawlery i harmonogram e-maili w adminie.',
  },
} satisfies Record<string, UiLibraryEntryMeta>;

/* ─── RODZINA ETYKIET: kiedy które (anty-reinwencja S28) ─── */

export const LABEL_FAMILY_ENTRIES = {
  labelEyebrowChip: {
    id: 'label-eyebrow-chip',
    name: "Eyebrow variant='chip'",
    importPath: 'src/UI/components/Eyebrow/Eyebrow.atom',
    status: 'FROZEN',
    whenToUse:
      'KICKER nad nagłówkiem sekcji — zdanie bezszeryfowe (S108, głos 4), NIE boxed pill. NIE filtr, NIE stan, NIE plan, NIE nazwa marki. Jeden na sekcję, zwykle SectionHeader/LpHero. Tautologiczny type-label („STYL" nad nazwą stylu) = kasuj (S88).',
  },
  labelChip: {
    id: 'label-chip',
    name: 'Chip',
    importPath: 'src/UI/components/Chip/Chip.atom',
    status: 'DRAFT',
    whenToUse:
      'TAG / FILTR treści — usuwalny lub klikalny. Galeria, traity, długości. NIE ozdoba, NIE type-label ekranu (S88). Klikalny chip dostaje semantykę przycisku (S33). Stan = StatusPill; plan = PlanBadge; kicker = Eyebrow.',
  },
  heroCountPill: {
    id: 'hero-count-pill',
    name: 'HeroCountPill',
    importPath: 'src/UI/components/HeroCountPill/HeroCountPill.atom',
    status: 'DRAFT',
    whenToUse:
      'LICZNIK w nagłówku ekranu (ile wersji, ile zaznaczonych, ile wątków czeka) — pigułka w slocie meta, obok tytułu strony. Tony: default, emphasized (wyróżniona wartość), alert (+pulse dla czekających). Ton domenowy nadpisuj przez --hero-pill-bg/-fg/-border/-icon, NIGDY przez klasę powtarzającą te same własności: równa specyficzność z modułem komponentu oznacza, że wygrywa kolejność w bundlu. NIE stan obiektu (to StatusPill), NIE filtr (to Chip), NIE kicker sekcji (to Eyebrow).',
  },
  labelStatusPill: {
    id: 'label-status-pill',
    name: 'StatusPill',
    importPath: 'src/UI/components/StatusPill/StatusPill.atom',
    status: 'DRAFT',
    whenToUse:
      'STAN obiektu (open/resolved/pending, live/offline, healthy/degraded/down, severity) — OKLCH-tint po prop color z call-site mapy status→token; kropka (opcjonalnie pulse=live) lub własny icon; etykieta zdaniem, bez kapitalików (S108). NIE plan (→ PlanBadge), NIE usuwalny tag (→ Chip), NIE KATEGORIA: kolor semantyczny należy do JEDNEJ osi znaczenia na powierzchnię — w Audycie kategoria zdarzenia jest celowo neutralna, bo dzieliła paletę z wagą i ADMIN wypadał tym samym czerwonym co HIGH (DECISION przy .typeBadge). emphasis="solid" = jedyny poziom ponad tintem, dla wagi krytycznej; dwa solidy obok siebie na jednej powierzchni znoszą się nawzajem. ariaLabel gdy widoczna etykieta jest skrótem („LIVE 60s"). Jeden kanon na wszystkie statusy: sesje, wsparcie, admin.',
  },
  labelPlanBadge: {
    id: 'label-plan-badge',
    name: 'PlanBadge',
    importPath: 'src/UI/components/PlanBadge/PlanBadge.atom',
    status: 'DRAFT',
    whenToUse:
      'PLAN cenowy użytkownika/zasobu (PRO / PRO+ / STUDIO / SCALE) — kolor per plan z PricingPlan kernela. FREE renderuje null (brak badge = plan domyślny). NIE dowolny tag, NIE stan — wyłącznie tier planu.',
  },
  labelSaveBadge: {
    id: 'label-save-badge',
    name: 'saveBadge (−20% w BillingToggle)',
    importPath: 'src/UI/components/BillingToggle/BillingToggle.molecule',
    status: 'FROZEN',
    whenToUse:
      'Etykieta oszczędności „−20%" PRZYKLEJONA do opcji „Rocznie" w BillingToggle — NIE samodzielny komponent, część toggle. Badge „−20%" jest renderowany jako widoczny tekst (bez aria-label — czytnik ekranu odczytuje sam tekst). Nie reinwentuj jako osobny badge: rabat roczny żyje wyłącznie wewnątrz BillingToggle.',
  },
  labelColChip: {
    id: 'label-col-chip',
    name: '„Polecany" (colChip / popularBadge — pricing)',
    importPath: 'src/UI/features/static/PricingComparisonTable.organism',
    status: 'DRAFT',
    whenToUse:
      'Wyróżnik planu polecanego („Polecany"/popularBadge) na pricing — page-local pattern (colChip w PricingComparisonTable, .tierKickerPro w PricingTierCard.organism), NIE współdzielony komponent. Sterowany tier.isRecommended; copy z i18n tierSection.popularBadge. Po głosie S98/B „polecany plan W ZESTAWIE" mówi PEŁNYM NEGATYWEM w atramencie (--color-ink + --color-on-ink) na pięciu powierzchniach: cennik, for-studios, onboarding, strona płatności, for-stylists. GRANICA: tabela porównania zostaje na ramie (kolumnę w tuszu owner odrzucił w S94), a samotna Card.highlighted mówi „ważny", nie „polecany spośród", więc też zostaje na zamkniętej ramie. Reużywaj te dwa hosty zamiast budować trzeci wariant „polecany".',
    noRenderReason:
      'wzorzec page-local cennika (klasa colChip w PricingComparisonTable + .tierKickerPro w PricingTierCard.organism), nie eksportowany komponent — wpis istnieje, by następna sesja reużyła istniejący host zamiast reinwentować trzeci „polecany" badge.',
  },
} satisfies Record<string, UiLibraryEntryMeta>;
