/**
 * Rejestr biblioteki komponentów (/ui, dev-only) — SSOT metadanych wpisów.
 * Spis treści (TOC) i sekcje renderują się z TEGO obiektu, więc anchor-id,
 * nazwa i status nie mogą się rozjechać między TOC a wpisem.
 *
 * Typy (UiLibraryStatus / UiLibraryEntryMeta / UiLibraryGroup) → uiLibrary.types.
 */

import type { UiLibraryEntryMeta, UiLibraryGroup } from './uiLibrary.types';
import {
  LABEL_FAMILY_ENTRIES,
  UTILITY_ENTRIES,
} from './uiLibrary.registry.utility';

// Re-eksport tylko tego, co realnie brane STĄD: UiLibraryEntry.composition
// importuje `UiLibraryEntryMeta` z rejestru. `UiLibraryGroup` nie miał ani
// jednego konsumenta tą drogą — poza definicją w uiLibrary.types używa go
// wyłącznie ten plik, jako typ UI_LIBRARY_GROUPS niżej.
export type { UiLibraryEntryMeta } from './uiLibrary.types';

/* ─── ATOMY ─── */

export const ATOM_ENTRIES = {
  dialog: {
    id: 'app-dialog',
    name: 'AppDialog',
    importPath: 'src/UI/primitives/AppDialog.atom',
    status: 'DRAFT',
    whenToUse:
      'Potwierdzenia i krótkie formularze: Content niesie tytuł i widoczne anulowanie, Body wspólny odstęp treści, Actions stopkę. Na telefonie pełny ekran z safe-area, na desktopie karta. Body nie otacza Actions ani treści, która już ma własny odstęp. Dłuższe szczegóły rekordu używają AppSheet.',
  },
  button: {
    id: 'button',
    name: 'Button',
    importPath: 'src/UI/components/Button/Button.atom',
    status: 'DRAFT',
    whenToUse:
      'Jedyny przycisk akcji w projekcie: primary do głównego CTA, outlined/text/ghost do akcji drugorzędnych, danger (S53) do potwierdzeń akcji nieodwracalnych (usuń wpis/konto — outlined error-surface: error text + error hairline, tło TRANSPARENTNE = AA-safe 4.83:1 light, bo #dc2626 na tincie spada <4.5:1; tint tylko na hover/active; NIE solidny red-bg bo --color-error w dark to jasny token tekstu). Wariant nawigacyjny: LinkButton z tego samego katalogu. Disabled (S26): primary = filter dim (scope-safe, działa też w inverted-ink stopce), outlined/text = opacity .65 bez saturate (label ma zostać odczytywalny). Wciśnięcie (:active) bierze --color-surface-pressed (S98) i ten token obowiązuje KAŻDĄ kontrolkę: wcześniej wciśnięcie brało krem, czyli powierzchnię JAŚNIEJSZĄ niż hover, więc hierarchia stanów była odwrócona. Akcja w toku (S126): `loading` zamiast spinnera w `icon` — kółko zastępuje ikonę wiodącą albo strzałkę `direction`, a bez glifu leży na etykiecie; szerokość się nie zmienia, kliknięcia (i wysłanie formularza) są ignorowane, przycisk dostaje aria-busy i NIE jest `disabled`. LinkButton nie ma tego stanu.',
  },
  brandMark: {
    id: 'brand-mark',
    name: 'BrandMark',
    importPath: 'src/UI/components/BrandMark/BrandMark.atom',
    status: 'FROZEN',
    whenToUse:
      'SSOT samego SYGNETU (znak nf, /logo.png). Gdy obok ma stać nazwa marki — użyj BrandLockupMolecule (S88), nie układaj sygnetu + Nailfolio ręcznie i NIGDY nie wsadzaj nazwy w chip. Sygnet sam: stopka, /dev/ui demo. Domyślnie dekoracyjny (pusty alt); podaj label, gdy jest jedynym nośnikiem marki. Rozmiar = className konsumenta.',
  },
  eyebrow: {
    id: 'eyebrow',
    name: 'Eyebrow',
    importPath: 'src/UI/components/Eyebrow/Eyebrow.atom',
    status: 'FROZEN',
    whenToUse:
      'Nadtytuł sekcji (kicker), NIE ozdoba: od S108 (głos 4) zdanie bezszeryfowe przez role --style-kicker-*, bez kapitalików i bez kreski; variant chip = kolor akcentu, plain = text-secondary, NIE boxed pill. LP/SectionHeader = tak. Tautologiczny type-label nad h1 („STYL", „Portfolio", „Nailfolio") = zakaz (S88) — kasuj, zostaw headline. Prop `dot` = no-op.',
  },
  chip: {
    id: 'chip',
    name: 'Chip',
    importPath: 'src/UI/components/Chip/Chip.atom',
    status: 'DRAFT',
    whenToUse:
      'TYLKO filtr/tag/cecha z interakcją lub usuwaniem (galeria, traity). NIE dekoracja, NIE nazwa marki, NIE type-label ekranu. Stan = StatusPill; plan = PlanBadge; kicker sekcji = Eyebrow.',
  },
  numberMarker: {
    id: 'number-marker',
    name: 'NumberMarker',
    importPath: 'src/UI/components/NumberMarker/NumberMarker.atom',
    status: 'FROZEN',
    whenToUse:
      'Dekoracyjny numerał kroku, benefitu lub rankingu (zero-padded, aria-hidden); WYŁĄCZNIE dla realnych sekwencji (Style Policy §6).',
  },
  skeleton: {
    id: 'skeleton',
    name: 'Skeleton',
    importPath: 'src/UI/components/Skeleton/Skeleton.atom',
    status: 'DRAFT',
    whenToUse:
      'Placeholder ładowania treści: rect dla kart i obrazów, text dla linii tekstu, circle dla awatarów.',
  },
  progress: {
    id: 'progress',
    name: 'Progress',
    importPath: 'src/UI/components/Progress/Progress.atom',
    status: 'DRAFT',
    whenToUse:
      'Wskaźnik postępu: linear z wartością (determinate) lub bez (indeterminate), spinner do ładowania w miejscu.',
  },
  toggle: {
    id: 'toggle',
    name: 'Toggle',
    importPath: 'src/UI/components/Toggle/Toggle.atom',
    status: 'DRAFT',
    whenToUse:
      'Przełącznik on/off ustawień (input z rolą switch), z opcjonalną etykietą po prawej.',
  },
  input: {
    id: 'input',
    name: 'Input',
    importPath: 'src/UI/components/Input/Input.atom',
    status: 'DRAFT',
    whenToUse:
      'Pole formularza: label + error wbudowane, type search dostaje ikonę lupy, multiline renderuje textarea.',
  },
  select: {
    id: 'select',
    name: 'Select',
    importPath: 'src/UI/components/Select/Select.atom',
    status: 'DRAFT',
    whenToUse:
      'Natywny <select> ze stylowanym chevronem (opcje przez prop options, opcjonalny placeholder jako disabled option) + wbudowany label/htmlFor. Domyślny wybór dla formularzy: lekki, zero JS na otwieranie, natywny picker na mobile. Gdy potrzebujesz w pełni ostylowanego popupu z ItemIndicator (checkmark) i klawiaturową nawigacją po liście — sięgnij po AppSelect.',
  },
  appSelect: {
    id: 'app-select',
    name: 'AppSelect',
    importPath: 'src/UI/primitives/AppSelect.atom',
    status: 'DRAFT',
    whenToUse:
      'W pełni ostylowany select na Base UI (portalowany popup, ItemIndicator-checkmark, scroll-arrows, klawiaturowa nawigacja) — gdy natywny <select> nie wystarcza wizualnie lub potrzebujesz spójnego wyglądu listy na desktopie. Kontrolowany generykiem value/onValueChange (typowane wartości V). Dla zwykłych formularzy preferuj natywny Select (lżejszy, natywny picker na mobile, wbudowany label).',
  },
  checkbox: {
    id: 'checkbox',
    name: 'Checkbox',
    importPath: 'src/UI/components/Checkbox/Checkbox.atom',
    status: 'DRAFT',
    whenToUse:
      'Pole wyboru w formularzu (zgody, opcje wielokrotne); stan kontrolowany (checked + onChange), opcjonalna etykieta po prawej. Dla pojedynczego przełącznika ustawień on/off wybierz Toggle (rola switch), nie Checkbox.',
  },
  typography: {
    id: 'typography',
    name: 'Typography',
    importPath: 'src/UI/components/Typography/Typography.atom',
    status: 'DRAFT',
    whenToUse:
      'Semantyczny tekst app-side: variant h1-h4 (display serif) / body1-body2 / subtitle / caption mapuje się na właściwy tag i skalę --text-*. Prop `as` (S51) nadpisuje TAG niezależnie od wizualu (np. variant="h4" as="h2", gdy hierarchia nagłówków strony wymaga h2 pod h1 AppHero, a skala wizualna h4). UWAGA: liczby DANYCH (liczniki, daty, X/3) nie wchodzą w warianty serif — Marcellus renderuje 0 jak literę O (lekcja S25); dane zawsze w sans + tabular-nums.',
  },
  affordanceDisc: {
    id: 'affordance-disc',
    name: 'AffordanceDisc',
    importPath: 'src/UI/components/AffordanceDisc/AffordanceDisc.atom',
    status: 'FROZEN',
    whenToUse:
      'Znak klikalności z głosu S116 „A3: Biel na papierze”: czerwona strzałka w kółku na końcu klikalnego wiersza lub karty (lista rozmów, sesje, połączone stylistki, bento panelu, NavCard). Zawsze w parze z białą powierzchnią `--color-surface-interactive`; informacja nie dostaje ani znaku, ani bieli. Nie dla menu nawigacji, paginacji, akordeonu ani linku w tekście. Rozmiary sm (28 px) i md (32 px).',
  },
  avatar: {
    id: 'avatar',
    name: 'Avatar',
    importPath: 'src/UI/components/Avatar/Avatar.atom',
    status: 'DRAFT',
    whenToUse:
      'Awatar użytkownika: zdjęcie (`src`) albo inicjały rysowane lokalnie w czterech tonach z ról palety (ton wynika z imienia, więc osoba ma wszędzie ten sam kolor; tokeny są mode-aware, więc inicjały widać także w trybie ciemnym). Od S126 nic nie leci do zewnętrznego serwisu. Rozmiary sm 32 / md 40 / lg 56 / xl 96 px. `decorative`, gdy nazwa stoi obok jako tekst.',
  },
  colorDot: {
    id: 'color-dot',
    name: 'ColorDot',
    importPath: 'src/UI/components/ColorDot/ColorDot.atom',
    status: 'DRAFT',
    whenToUse:
      'Kropka koloru lakieru (dane z DB, nie design-token — hex literal legalny). Flat + wewnętrzny hairline ring (de-slop S25, bez glossu); rozmiary sm/md/quick/lg, białe kolory dostają ramę.',
  },
  emptyState: {
    id: 'empty-state',
    name: 'EmptyState',
    importPath: 'src/UI/components/EmptyState/EmptyState.atom',
    status: 'DRAFT',
    whenToUse:
      'Kanoniczna powierzchnia „nic tu jeszcze nie ma" — medalion + nagłówek + opis + opcjonalne dodatki (chipy, kroki) + CTA. Siostra ErrorState: tamta jest dla zapytania, które PADŁO, ta dla zapytania, które wróciło puste (wyjątek: gdy ta sama karta niesie awarię z kilkoma wyjściami, np. ponów + wróć — wtedy EmptyState z role="alert", bo ErrorState mieści jedno działanie). size="page" = pusty jest cały widok (medalion 96px, nagłówek płynny), size="panel" = pusta sekcja/tabela/dialog wewnątrz zapełnionego widoku (medalion 64px). titleAs dobierz z outline\'u strony (h1 gdy pusty stan jest JEDYNĄ treścią strony, h2 dla widoku, h3 w sekcji z własnym nagłówkiem, p w dialogu, który ma tytuł). Ikona przez prop `icon` dostaje medalion; własna, nietypowa ilustracja idzie slotem `illustration` (bez medalionu). animate="float"|"pulse" = jedyne dwa ruchy medalionu. Nadpisania per strona WYŁĄCZNIE przez custom property --empty-* w className: komponent czyta je jako var(--empty-x, var(--_x)), gdzie --_x niesie wartość wariantu — dzięki temu klasa strony (0-1-0) wygrywa z selektorem wariantu (0-2-0), co przy jednej warstwie zmiennych było niemożliwe (S102). Gołe padding/gap/background z modułu strony = zakaz: równa specyficzność, o wyniku decyduje kolejność w bundlu.',
  },
  stepIndicator: {
    id: 'step-indicator',
    name: 'StepIndicator',
    importPath: 'src/UI/components/StepIndicator/StepIndicator.atom',
    status: 'DRAFT',
    whenToUse:
      'Wskaźnik kroku procesu liniowego (dodawanie pracy, onboarding, usuwanie konta). Pokazuje, gdzie jesteś; nigdy nie jest przyciskiem ani zakładką, nie ma hovera ani stanu wciśnięcia. Jeden krok = nic nie renderuje (aktywacja roli). Jedyny wygląd to „Pasek i jedna linia”: cienki pasek z odcinkiem na krok (ukończone i bieżący wypełnione), pod nim nazwa bieżącego kroku i licznik „Krok 1 z 3” (zwycięzca głosu `s126-proces`, owner 2026-10-09). Zwykle przez ProcessHeader, nie osobno. Nie dodawaj numerowanych kropek, nazw pozostałych kroków ani karty wokół.',
    noRenderReason:
      'Żywe użycia: kreator dodawania pracy, kroki onboardingu po powitaniu, usuwanie konta.',
  },
  illustration: {
    id: 'illustration',
    name: 'Illustration',
    importPath: 'src/UI/components/Illustration/Illustration.atom',
    status: 'DRAFT',
    whenToUse:
      'Rysunek z biblioteki grafik wewnątrz aplikacji: puste stany (slot `illustration` w EmptyState), ekrany sukcesu, onboarding. Ścieżka wyłącznie z `LP_ASSETS`. Zawsze dekoracyjny (znaczenie niosą słowa obok). W trybie ciemnym odwraca jasność tą samą recepturą co ozdobniki LP. Nie dla galerii, formularzy ani wiadomości: tam potrzebna jest przestrzeń.',
    noRenderReason:
      'Żywe użycia: pusta galeria, puste ulubione, brak połączonych klientek, brak zgłoszeń.',
  },
} satisfies Record<string, UiLibraryEntryMeta>;

/* ─── MOLECULES (klepnięte głosami ownera S19-S21) ─── */

export const MOLECULE_ENTRIES = {
  brandLockup: {
    id: 'brand-lockup',
    name: 'BrandLockup',
    importPath: 'src/UI/components/BrandLockup/BrandLockup.molecule',
    status: 'FROZEN',
    whenToUse:
      'JEDYNA para sygnet + wordmark „Nailfolio" (navbar, rail konta/admina, login, welcome, maintenance). Heading-font obok nf, NIGDY pastylka. Sygnet bez nazwy = BrandMarkAtom. font-size dziedziczy z rodzica (compact-bar).',
  },
  card: {
    id: 'card',
    name: 'Card',
    importPath: 'src/UI/components/Card/Card.molecule',
    status: 'DRAFT',
    whenToUse:
      'Pojemnik na samodzielny kawałek treści wewnątrz strony (zestawiany z CardHeader/CardContent/CardActions): outlined gdy karta siedzi na białym tle, elevated (neutralny stopień --color-surface-input + hairline, NIGDY cień) gdy potrzebuje odróżnienia od tła — stopień jest NEUTRALNY z powodu R2 motywu „Jeden krem" i głosu S98/A: krem ekranu należy do karty-intro AppHero i jednego pasa sekcji, nie do karty montowanej wielokrotnie, highlighted dla wyróżnionego wariantu. Na pełny band sekcji użyj Section, na zamknięty ciemny prostokąt na jasnym tle InkPanel.',
  },
  sectionHeader: {
    id: 'section-header',
    name: 'SectionHeader',
    importPath: 'src/UI/components/SectionHeader/SectionHeader.molecule',
    status: 'FROZEN',
    whenToUse:
      'Kanoniczny nagłówek sekcji: Eyebrow + h2 + opcjonalne lede w spójnym stacku (align start lub center), zamiast par .sectionEyebrow/.sectionHeadline. Per-strona dostrojenie przez var-hooki na className: skala (--section-headline-size/-leading/-tracking/-measure), kolor (--section-headline-color, --section-lede-color), hyphenacja (--section-headline-hyphens), kolor kickera (--eyebrow-color). Recolor on-ink / accent / hyphens PL → przez te hooki, NIE hand-roll (S37).',
  },
  featureCard: {
    id: 'feature-card',
    name: 'FeatureCard',
    importPath: 'src/UI/components/FeatureCard/FeatureCard.molecule',
    status: 'DRAFT',
    whenToUse:
      'Statyczna karta cechy/wartości: gold icon-chip (lub numerał) + opcjonalny kicker + h3 + body + opcjonalna meta-stopka. ZERO hover (floor §4 — karta nie jest linkiem). Układaj w FeatureCardGrid. Do karty będącej linkiem (strzałka + hover) użyj NavCard. Dostrojenie per-strona przez var-hooki na className (--feature-card-pad/-bg/-gap/-title-size).',
  },
  navCard: {
    id: 'nav-card',
    name: 'NavCard',
    importPath: 'src/UI/components/NavCard/NavCard.organism',
    status: 'DRAFT',
    whenToUse:
      'Klikalna karta nawigacyjna (cała karta = link): gold icon-chip + kicker + tytuł + body/meta + strzałka w prawym-górnym. Interaktywna → hover/focus dozwolony (lift + border tint, floor §4). Renderuje next/link, ExternalLinkAtom (Capacitor-safe) albo goły <a> (mailto/onClick) wg linkType. Do statycznej karty cechy (bez href) użyj FeatureCard.',
  },
  featureCardGrid: {
    id: 'feature-card-grid',
    name: 'FeatureCardGrid',
    importPath: 'src/UI/components/FeatureCard/FeatureCardGrid.molecule',
    status: 'DRAFT',
    whenToUse:
      'Równa responsywna siatka FeatureCard/NavCard (mobile 1 → tablet 2 → desktop columns 2/3/4). Do asymetrycznych/bento układów (ForClients visitMoments) NIE używać — tam layout jest sekcyjną mechaniką.',
  },
  finalCtaBand: {
    id: 'final-cta-band',
    name: 'FinalCtaBand',
    importPath: 'src/UI/components/FinalCtaBand/FinalCtaBand.organism',
    status: 'FROZEN',
    whenToUse:
      'Jedyny wzorzec finalnego CTA na pełnym bandzie BEZ kadru (pozostałe strony LP); strona dostarcza tylko treść i logikę akcji przez slot actions (linia 1 biała, akcent italic, kanon S21). Living CTA (data-cta-shimmer) na wrapperze akcji — gałki w global.css. Konwencja F3 (głos S22/5): tone="gold" na stronach KONWERSYJNYCH (pricing, compare, get-app), tone="ink" na INFORMACYJNYCH (about, contact, for-stylists, for-studios). Home i for-clients biorą PhotoFinaleCta (siatka foto, nie decor slot).',
  },
  phoneMockup: {
    id: 'phone-mockup',
    name: 'PhoneMockup',
    importPath: 'src/UI/components/PhoneMockup/PhoneMockup.molecule',
    status: 'FROZEN',
    whenToUse:
      'Ramka telefonu ze screenem aplikacji (prop screenshot); bez screena renderuje uczciwy schematyczny placeholder, nigdy pusty ekran. Bez widocznych podpisów — figcaption usunięty na stałe (głos ownera S24), opis ekranu żyje wyłącznie w aria-label.',
  },
  interactivePhoneStage: {
    id: 'interactive-phone-stage',
    name: 'InteractivePhoneStage',
    importPath:
      'src/UI/components/InteractivePhoneStage/InteractivePhoneStage.organism',
    status: 'FROZEN',
    whenToUse:
      'Tryptyk 3 screenów na pełnoszerokościowym ink-stage (przełamanie „nudnej kolumny", głos ownera S35 = B+C): 1 duży + 2 małe, hover/tap/focus przenosi powiększenie (focal-swap, transition width 420ms, a11y <button>+aria-pressed). Opcjonalny kicker-kotwica nad rzędem. Kanon produkcyjny na Home/For-stylists/Pricing.',
    noRenderReason:
      'renderuje pełnoszerokościowy ink-stage (100vw breakout) — demo rozbiłoby layout biblioteki; interakcja focal-swap wymaga żywej strony. Podgląd na żywo: Home/For-stylists/Pricing.',
  },
  interactivePhoneDuo: {
    id: 'interactive-phone-duo',
    name: 'InteractivePhoneDuo',
    importPath:
      'src/UI/components/InteractivePhoneDuo/InteractivePhoneDuo.organism',
    status: 'FROZEN',
    whenToUse:
      'In-hero interaktywny duet 2 screenów (głos ownera Q3 = C-in-hero focal-duo): 1 fokal + 1 bok, hover/tap/focus przenosi powiększenie (focal-swap, transition width, a11y <button>+aria-pressed, cursor:default = zoom nie nawigacja). Młodsze rodzeństwo InteractivePhoneStage BEZ full-bleed ink-bandu — siedzi w prawej kolumnie hero (dowód aplikacji zamiast statycznego single-mockupa). Kanon na for-studios/for-clients hero.',
    noRenderReason:
      'interakcja focal-swap + wysoka ramka telefonu wymagają żywej strony/kontekstu hero; demo statyczne nie oddałoby swapu. Podgląd na żywo: for-studios/for-clients hero.',
  },
  appLink: {
    id: 'app-link',
    name: 'AppLinkAtom',
    importPath: 'src/UI/components/AppLink/AppLink.atom',
    status: 'FROZEN',
    whenToUse:
      'Jedyny link wewnętrzny w main/src (zamiast next/link, strażnik audit:app-link-only): te same propsy i ref co next/link, dopisuje końcowy ukośnik do hrefów stron, więc boty idą prosto na kanoniczny adres zamiast przez 301. Wewnętrzny LinkButtonAtom też renderuje przez niego (prefiks języka).',
    noRenderReason:
      'brak warstwy wizualnej: to next/link ze zmienionym hrefem; wygląd należy do komponentu, który go używa.',
  },
  accordionItem: {
    id: 'accordion-item',
    name: 'AccordionItem',
    importPath: 'src/UI/components/Accordion/AccordionItem.molecule',
    status: 'FROZEN',
    whenToUse:
      'A11y-poprawny prymityw akordeonu (aria-expanded, animacja grid-rows 0fr do 1fr); na LP używaj przez FaqSection, bezpośrednio tylko z własnym słownikiem klas.',
  },
  stickyCtaBar: {
    id: 'sticky-cta-bar',
    name: 'StickyCtaBar',
    importPath: 'src/UI/components/StickyCtaBar/StickyCtaBar.molecule',
    status: 'FROZEN',
    whenToUse:
      'Przyklejony pasek CTA na dole viewportu, sterowany prop visible; scroll-logika (kiedy pokazać) zostaje po stronie strony. Living CTA na wrapperze primary (data-cta-shimmer) — gałki w global.css.',
  },
  midPageCta: {
    id: 'mid-page-cta',
    name: 'MidPageCta',
    importPath: 'src/UI/components/MidPageCta/MidPageCta.molecule',
    status: 'FROZEN',
    whenToUse:
      'Reużywalna śródstronowa sekcja CTA („mina konwersji" co drugą sekcję, S81): wyśrodkowany headline + akcent gold-italic + slot actions (button) + linia reassurance. Strona dostarcza copy i akcję; efekt „living CTA" (data-cta-shimmer) siedzi na wrapperze akcji — amplituda/tempo TYLKO w global.css (--cta-*). Wariant home = HomeMidCtaOrganism.',
    noRenderReason:
      'renderuje pełną wyśrodkowaną sekcję CTA z efektem shimmer + slotem akcji dostarczanym przez stronę — demo w gridzie biblioteki nie oddałoby kontekstu śródstronowego. Podgląd na żywo: Home (po sekcjach kroki/showcase/dopasowanie).',
  },
  priceSlot: {
    id: 'price-slot',
    name: 'PriceSlot',
    importPath: 'src/UI/components/PriceSlot/PriceSlot.atom',
    status: 'FROZEN',
    whenToUse:
      'Animowany slot ceny na pricing: cyfry rolują po załadowaniu ze Stripe, podczas ładowania skeleton-roll, NIGDY tekst zastępczy (DECISION w pliku).',
    noRenderReason:
      'wymaga realnej ceny ze Stripe (TanStack Query) i stanu isLoading z pricing.policy; render z wymyśloną kwotą fałszowałby kanon "cena tylko z API".',
  },
  errorState: {
    id: 'error-state',
    name: 'ErrorState',
    importPath: 'src/UI/components/ErrorState/ErrorState.molecule',
    status: 'DRAFT',
    whenToUse:
      'Kanoniczna inline-powierzchnia błędu, gdy zapytanie widoku padnie: ikona + komunikat + opcjonalny przycisk retry (onRetry = query.refetch, retryLabel z buttons.retry). Floor-flat (surface-card + 4-bok hairline, zero cienia/gradientu). Używa jej admin (logs/notes/policies/audit/announcements) + komunikator + zespół salonu + karta klientki. Dla powierzchni user-facing landing wyższego polishu użyj brandowanej karty błędu funkcji (np. ExploreEditorialError) zamiast tej molekuły. `size="inline"` (S126) = błąd WEWNĄTRZ karty, dialogu albo arkusza: bez własnego tła, ramy i dużego odstępu (pudełko w pudełku jest zakazane); domyślne `card` stoi ZAMIAST karty. `isRetrying` pokazuje przycisk w stanie `loading`.',
  },
  segmentedControl: {
    id: 'segmented-control',
    name: 'SegmentedControl',
    importPath: 'src/UI/components/SegmentedControl/SegmentedControl.molecule',
    status: 'DRAFT',
    whenToUse:
      'Wybór jednej opcji z kilku (filtr, okres, zakładki). Tor się nie zawija, nadmiar jedzie w poziomie. Aktywna opcja to odwrócony atrament. Kształt pill albo control, rozmiar md (44 px) albo sm dla gęstych pasków admina. Przełącznik ze ślizgającą się pigułką zostaje przy BillingToggle i RoleSwitcher.',
  },
  navRow: {
    id: 'nav-row',
    name: 'NavRow',
    importPath: 'src/UI/components/NavRow/NavRow.molecule',
    status: 'DRAFT',
    whenToUse:
      'Jedyny klikalny wiersz nawigacji i ustawień: szuflada, lista sekcji konta, szyna konta na komputerze, menu admina, wiersze „co dalej”, centrum pomocy. Wygląd jest jeden (głos ownera `s126-wiersze`, 2026-10-09, wygrał kandydat A „Komórki w grupach”): `NavRowListMolecule` to jeden biały boks, wiersze 52 px rozdzielone linią, pozycja bieżąca (`active`) w odwróconym atramencie. Link (`href`) albo przycisk (`onClick`); ikona, opis w jednej linii, licznik (`badge`), `trailing` chevron albo disc, `tone` danger (osobna grupa), `density` compact (40 px, bez linii), `surface` nav dla szyny. Slot `leading` przyjmuje awatar 40 px (`AvatarAtom`) zamiast ikony 22 px, wyśrodkowany w wierszu tak samo. Wiersz bez `href` i bez `onClick` jest statyczny: zwykły `<div>` o tej samej budowie, bez hovera, stanu wciśnięcia i strzałki (ukończony krok listy, nieaktywne konto). Wiersz o osobie albo o sesji też jest tym wierszem (2026-10-09): `note` to trzecia linia (zdanie podpowiedzi albo linia statusu z pigułką i datą; na wierszu statycznym może nieść akcję), `end` to JEDNA druga kontrolka komórki (menu wiersza, przycisk-ikona), renderowana obok linku wiersza, nigdy w nim. `href` z `tel:`, `mailto:` albo `#` jest zwykłą kotwicą, `external` otwiera przez `ExternalLinkAtom` (nigdy `target=_blank`: w skorupie natywnej gubi sesję), `onClick` dostaje zdarzenie.',
    noRenderReason:
      'Wiersz żyje w grupie na tle ekranu, więc podgląd jest na żywych ekranach: szuflada /app, lista /app/user/account, szyna konta od 1280 px, /app/home, /app/support.',
  },
  processHeader: {
    id: 'process-header',
    name: 'ProcessHeader',
    importPath: 'src/UI/components/ProcessHeader/ProcessHeader.molecule',
    status: 'DRAFT',
    whenToUse:
      'Nagłówek procesu krok po kroku zamiast karty-intro (AppHero): rysuje `<h1>` tylko tam, gdzie nie ma górnej belki (układ konta na komputerze); pod belką nagłówkiem ekranu jest tytuł belki, więc `<h1>` jest zawsze jeden. Do tego `StepIndicator` w wyglądzie „Pasek i jedna linia” (zwycięzca głosu `s126-proces`, owner 2026-10-09). Tytuł procesu żyje tylko w górnej belce, a treść kroku zaczyna się zaraz pod wskaźnikiem. Kartę zachowuje wyłącznie krok powitalny onboardingu. Odstępy pod belką strona ustawia zmiennymi `--process-header-margin-top` i `--process-header-margin-bottom` na swojej klasie głównej.',
    noRenderReason:
      'Żywe użycia: kreator dodawania pracy, kroki onboardingu po powitaniu, usuwanie konta.',
  },
} satisfies Record<string, UiLibraryEntryMeta>;

/* ─── MOLECULES LP (S22) ─── */

export const LP_ENTRIES = {
  paragraphLink: {
    id: 'app-paragraph-link',
    name: 'AppParagraphLink',
    importPath: 'src/UI/components/AppParagraphLink/AppParagraphLink.atom',
    status: 'DRAFT',
    whenToUse:
      'Link tekstowy z podkreśleniem i animowaną strzałką wyrównaną do pierwszej linii. Przyciski i nawigacja mają własne komponenty.',
  },
  sectionOrnament: {
    id: 'section-ornament',
    name: 'SectionOrnament',
    importPath: 'src/UI/components/SectionOrnament/SectionOrnament.molecule',
    status: 'DRAFT',
    whenToUse:
      'Mała ilustracja przy nagłówku marketingowym, dopasowana do tematu sekcji. Zachowuje szerokość tekstu; nie używaj na stronach prawnych ani technicznych.',
  },
  processIllustration: {
    id: 'process-illustration',
    name: 'ProcessIllustration',
    importPath: 'src/UI/assets/ProcessIllustration.molecule',
    status: 'DRAFT',
    whenToUse:
      'Wspólna rama ilustracji: obustronny odstęp, zamknięty border 3 px i promień 12 px. Ekrany pozostają rysowane, bez nakładania zdjęć.',
  },
  scaleContact: {
    id: 'scale-contact',
    name: 'ScaleContact',
    importPath: 'src/UI/components/ScaleContact/ScaleContact.molecule',
    status: 'DRAFT',
    whenToUse:
      'Wspólny moduł kontaktu dla Scale na cenniku i stronie dla stylistek. Treść pochodzi z tłumaczeń strony.',
  },
  lpHero: {
    id: 'lp-hero',
    name: 'LpHero',
    importPath: 'src/UI/components/LpHero/LpHero.organism',
    status: 'FROZEN',
    whenToUse:
      'Kanoniczny hero stron statycznych: chip-eyebrow (bywa h1 dla SEO), headline ze złotym italic akcentem, sloty actions/meta/media; bez media układ jednokolumnowy.',
  },
  inkPanel: {
    id: 'ink-panel',
    name: 'InkPanel',
    importPath: 'src/UI/components/InkPanel/InkPanel.atom',
    status: 'FROZEN',
    whenToUse:
      'Zamknięty ciemny prostokąt na jasnym tle (ton ink lub violet); daje tylko pole, ramę i kolor tekstu, wnętrze graniczy strona, NIGDY full-bleed (taste 14).',
  },
  faqSection: {
    id: 'faq-section',
    name: 'FaqSection',
    importPath: 'src/UI/components/FaqSection/FaqSection.molecule',
    status: 'FROZEN',
    whenToUse:
      'Jedyny wzorzec FAQ na LP: SectionHeader + lista AccordionItem z kanoniczną skórką, multi-open i uncontrolled (zastąpił 9 per-page kopii).',
  },
  trustSignals: {
    id: 'trust-signals',
    name: 'TrustSignals',
    importPath: 'src/UI/components/TrustSignals/TrustSignals.molecule',
    status: 'FROZEN',
    whenToUse:
      'Hero VALUE-proofy (punchy 3-item value-anchor: „0% prowizji", „Zatrzymujesz 100%"): pills jako inline rząd z kropkami-separatorami w CSS. Rola AUTHORITY/TRUST (Stripe/UE/VAT/Polska recyklowane) przeniesiona na TrustProse (głos ownera /ui S52). chips/grid pozostają na for-clients (composed split) — nie dla bare badge-stripów.',
  },
  trustProse: {
    id: 'trust-prose',
    name: 'TrustProse',
    importPath: 'src/UI/components/TrustProse/TrustProse.molecule',
    status: 'FROZEN',
    whenToUse:
      'Proza zaufania (głos ownera /ui S52 = wariant C): jedno editorial zdanie serif z gold-italic akcentami na słowach-kluczach (t.rich <em>), zero ikon — zastąpiła ikona+bullet trust-listę (TrustSignals w roli authority/trust) na cenniku, about, kontakcie, for-studios. tone=ink na negatywie, align=start w kolumnie, opcjonalny note (cichy caption, np. VAT).',
  },
  statsBand: {
    id: 'stats-band',
    name: 'StatsBand',
    importPath: 'src/UI/components/StatsBand/StatsBand.molecule',
    status: 'FROZEN',
    whenToUse:
      'Sekcja liczb-dowodów: ink-card jako zamknięta ciemna karta (kanon S21) lub plain-row jako cichy rząd bez panelu; figure jest semantycznym strong.',
  },
  stepsSection: {
    id: 'steps-section',
    name: 'StepsSection',
    importPath: 'src/UI/components/StepsSection/StepsSection.organism',
    status: 'FROZEN',
    whenToUse:
      'Kanoniczna sekwencja kroków z automatyczną numeracją 01/02 przez NumberMarker size sm (zdrowa skala, zakaz lg); columns lub list, semantyczny ol.',
  },
  photoFinaleCta: {
    id: 'photo-finale-cta',
    name: 'PhotoFinaleCta',
    importPath: 'src/UI/components/PhotoFinaleCta/PhotoFinaleCta.organism',
    status: 'DRAFT',
    whenToUse:
      'Finał foto + tekst na atramencie (kanon home, siatka 45/55): photo jest torem grida, nie absolutnym dekorem. imageSide left = home, right = for-clients. Slot heading/body/actions/footnote; akcent słowa przez PhotoFinaleCtaAccent. NIE zastępuje FinalCtaBand (ten zostaje na stronach bez kadru). Gęstość i kadr: publiczne hooki --photo-finale-* na className/style.',
  },
} satisfies Record<string, UiLibraryEntryMeta>;

/* ─── KOMPOZYCJE (S24) ─── */

export const COMPOSITION_ENTRIES = {
  appHero: {
    id: 'app-hero',
    name: 'AppHero',
    importPath: 'src/UI/components/AppHero/AppHero.organism',
    status: 'FROZEN',
    whenToUse:
      'JEDYNA karta-intro ekranu APLIKACJI (głos ownera S25/1 = D): zamknięty prostokąt na KREMIE systemowym (--color-bg-subtle) + neutralny hairline, BEZ sparkle. Krem jest tu decyzją z głosu S97 (wariant B), doprecyzowaną głosem S98/A (krem należy do karty-intro AppHero i do JEDNEGO pasa sekcji, a współdzielone atomy: chip, avatar, select, tor postępu, schodzą na --color-surface-input), i jednocześnie R2 motywu „Jeden krem": AppHero JEST tym jednym kremowym pasem ekranu, więc ekran, który go montuje, nie dokłada drugiej kremowej powierzchni (dawny gold-tint 6/9% zdjęty razem z osobnym wariantem dark — bg-subtle jest mode-aware). Tytuł + meta z ŻYWYCH danych; chip-eyebrow i marketingowy subtitle ZAKAZANE na narzędziach (S86) I na funnelu jako type-label (S88: recovery/onboarding/activate zdjęte). Admin chrome „Admin: …" może mieć eyebrow. Brak danych = sam tytuł; przecinek między członami meta generuje CSS (S126).',
  },
  section: {
    id: 'section',
    name: 'Section',
    importPath: 'src/UI/components/Section/Section.composition',
    status: 'FROZEN',
    whenToUse:
      'JEDYNE źródło full-bleed banda sekcji LP (breakout 100vw + kontener --lp-content-width; tone subtle = bg-subtle z pełną ramą hairline). Adopcja S24: WSZYSTKIE strony zmigrowane (~40 bandów), ręczny breakout w features/ = violation pilnowany przez audit:section-discipline (wyjątki strukturalne tylko z komentarzem section-discipline-allow). Padding nadpisuj przez --section-pad-block, NIGDY gołym paddingiem.',
  },
  trustStatsSection: {
    id: 'trust-stats-section',
    name: 'TrustStatsSection',
    importPath:
      'src/UI/components/TrustStatsSection/TrustStatsSection.organism',
    status: 'FROZEN',
    whenToUse:
      'Jedyny wzorzec sekcji „Dlaczego można nam zaufać" (forma = głos ownera S21 „2C", DECISION w pliku): eyebrow + body na jasnym, 3 liczby-dowody w zamkniętej ink-karcie (StatsBand), badges z ikonami pod kartą; strona dostarcza wyłącznie treść z i18n.',
  },
  phoneQuoteStrip: {
    id: 'phone-quote-strip',
    name: 'PhoneQuoteStrip',
    importPath: 'src/UI/components/PhoneQuoteStrip/PhoneQuoteStrip.organism',
    status: 'DRAFT',
    whenToUse:
      'Zamknięty asymetryczny pas „dowód + cytat": screen aplikacji (PhoneMockup lg, 0.9fr) obok wyciągniętego benefit-cytatu z gold-italic akcentem (1.4fr) w jednej hairline-karcie. Forma z głosu S24/1 wariant B (wygrał A, ale owner: „też wspaniałe, zapisałbym do biblioteki") — czeka na pierwsze realne użycie.',
  },
  reviewsSection: {
    id: 'reviews-section',
    name: 'ReviewsSection',
    importPath: 'src/UI/features/shared/reviews/ReviewsSection.organism',
    status: 'FROZEN',
    whenToUse:
      'Jedyny wzorzec social proof na LP (6 stron; forma = głos ownera S21 „4B": hero-cytat + równy chór). Strona dostarcza zestaw opinii z ReviewsData (RAW SSOT: docs SOCIAL_PROOF) + klucz nagłówka; opcjonalnie heroReviewId wymusza hero-cytat właściwej persony.',
    noRenderReason:
      'opinie beta to realne dane (SOCIAL_PROOF SSOT) sprzężone z Review JSON-LD i i18n static.reviews — render w bibliotece dublowałby treść marketingową; żywe użycie: home / for-stylists.',
  },
} satisfies Record<string, UiLibraryEntryMeta>;

/* ─── ORGANIZMY APLIKACJI (in-app, S28 census gap) ─── */

export const APP_ENTRIES = {
  appBar: {
    id: 'app-bar',
    name: 'AppBar',
    importPath: 'src/UI/components/AppBar/AppBar.organism',
    status: 'FROZEN',
    whenToUse:
      'Górna belka nawigacji stron statycznych (głos S111 C, 2026-09-14): własna płaszczyzna z pełną dolną linią, linki jako komórki siatki z jednozdaniowym podpisem (`hint`), bieżąca strona przez `activeHref` (`aria-current`). Poniżej 1280px hamburger otwiera menu kafli na pełną wysokość z focus-trapem (panel disclosure, NIE aria-modal, patrz DECISION w pliku). Komórki zwężają się, a podpis łamie na dwie linie, gdy etykiety są dłuższe (DE, EN).',
  },
  appDrawer: {
    id: 'app-drawer',
    name: 'AppDrawer',
    importPath: 'src/UI/components/AppDrawer/AppDrawer.organism',
    status: 'DRAFT',
    whenToUse:
      'Wysuwany boczny panel nawigacji aplikacji (role-aware: stylistka/klientka/admin/gość), z swipe-to-close, scroll-lock i focus-trapem. Sterowany prop isOpen + role; sekcje generuje appDrawerSections wg roli i feature-flag.',
    noRenderReason:
      'portalowany fullscreen drawer sterowany isOpen — render w bibliotece nałożyłby backdrop + panel na cały katalog (scroll-lock, swipe, focus-trap aktywne); to overlay nawigacyjny, nie inline-widget. Sekcje zależą od roli + flag (useAuth/feature-flags). Żywy podgląd: dowolny ekran /app.',
  },
  bottomTabBar: {
    id: 'bottom-tab-bar',
    name: 'BottomTabBar',
    importPath: 'src/UI/components/BottomTabBar/BottomTabBar.organism',
    status: 'DRAFT',
    whenToUse:
      'Dolny pasek zakładek aplikacji mobilnej (native feel): tabs z ikoną + etykietą, aktywna przez prop active; jeden tab może być elevated (uniesiony środkowy FAB, accent-bg, icon-only). Akcję nawigacji niesie onClick per tab — komponent nie zna routera.',
  },
  headerUserMenu: {
    id: 'header-user-menu',
    name: 'HeaderUserMenu',
    importPath: 'src/UI/components/HeaderUserMenu/HeaderUserMenu.organism',
    status: 'DRAFT',
    whenToUse:
      'Auth-aware akcja w publicznym headerze: niezalogowany → CTA „Zaloguj się"; desktop bez app-access (useAppEntryMode get-app) → CTA „Otwórz na telefonie"; zalogowany → trigger z Avatarem + dropdown (Panel / Moje konto / Wyloguj). Mounted-gate jest load-bearing dla SSR (patrz DECISION). Sam czyta sesję — nie podaje się propsów.',
  },
  notificationBell: {
    id: 'notification-bell',
    name: 'NotificationBell',
    importPath: 'src/UI/features/notifications/NotificationBell.organism',
    status: 'DRAFT',
    whenToUse:
      'Dzwoneczek powiadomień v1 — agregator ISTNIEJĄCYCH sygnałów (NIE domena notifications, brak unread/realtime): glanceable badge + rozwijana lista deep-linków z liczników, które apka już liczy (pending_shares_count z dashboard-feed, oczekujące prośby z usePendingRequests). Tylko rola stylistka (gate w AppLayout; klientka w v2). Sam czyta query (React Query dedupuje po kluczu) — bez propsów.',
    noRenderReason:
      'zależny od query stylistki (useDashboardFeed + usePendingRequests) — w bibliotece bez auth/danych renderowałby pusty badge. Żywy podgląd: AppBar na dowolnym ekranie /app jako stylistka.',
  },
  galleryPhotoCard: {
    id: 'gallery-photo-card',
    name: 'GalleryPhotoCard',
    importPath: 'src/UI/components/GalleryPhotoCard/GalleryPhotoCard.organism',
    status: 'DRAFT',
    whenToUse:
      'Kafel zdjęcia w galerii: obraz (Cloudinary thumb + srcSet, honest ImagePlaceholder gdy brak) + ColorDot-y + Chip-y traitów + opcjonalne overlaye (serce-ulubione, share, pin-badge, watermark FREE, like-count ≥3). Alt-text budowany z traitów (WCAG 1.1.1). Strona steruje widocznością overlayów przez show* + callbacki.',
  },
  galleryQuickFilters: {
    id: 'gallery-quick-filters',
    name: 'GalleryQuickFilters',
    importPath:
      'src/UI/components/GalleryQuickFilters/GalleryQuickFilters.organism',
    status: 'DRAFT',
    whenToUse:
      'Inline rząd filtrów galerii: kolory jako ColorSwatch (size quick), traity i długości jako klikalne Chip-y; grupy przez role="group"+aria-labelledby (NIE fieldset — patrz DECISION). selected*/onToggle* operują na ID (cuid), nie nazwach. Do pełnego fullscreen filtra z wyszukiwarką służy GalleryFilterSection.',
  },
  galleryStrength: {
    id: 'gallery-strength',
    name: 'GalleryStrength',
    importPath: 'src/UI/components/GalleryStrength/GalleryStrength.organism',
    status: 'DRAFT',
    whenToUse:
      'Karta „siła portfolio" (N6 Endowed Progress — start od 25%, NIGDY 0): SVG circular progress + checklista braków z punktacją i hint-panelami. Strona podaje surowe metryki (photoCount, hasProfileBio, pairedClientCount…), komponent liczy wynik i mapuje braki na ścieżki akcji.',
  },
  galleryLayoutToggle: {
    id: 'gallery-layout-toggle',
    name: 'GalleryLayoutToggle',
    importPath:
      'src/UI/components/GalleryLayoutToggle/GalleryLayoutToggle.atom',
    status: 'DRAFT',
    whenToUse:
      'Dwustanowy przełącznik układu galerii: kafelki (tiles) ↔ pełna szerokość (full-width), icon-only z aria-pressed. Sterowany prop layout + onToggle; strona trzyma stan układu.',
  },
  trialCountdownBanner: {
    id: 'trial-countdown-banner',
    name: 'TrialCountdownBanner',
    importPath:
      'src/UI/components/TrialCountdownBanner/TrialCountdownBanner.molecule',
    status: 'DRAFT',
    whenToUse:
      'Konwersyjny nudge trial→paid (loss aversion): pokazywany TYLKO gdy ≤7 dni do końca triala, w 3 tierach pilności (mild 4-7d / urgent 1-3d / lastDay <24h — eskalacja copy + role alert/status). Dismiss per-sesja (sessionStorage, wraca w nowej sesji — patrz DECISION). Strona podaje trialEndsAt + onClick.',
  },
  cookieBanner: {
    id: 'cookie-banner',
    name: 'CookieBanner',
    importPath: 'src/UI/components/CookieBanner/CookieBanner.organism',
    status: 'DRAFT',
    whenToUse:
      'Baner zgody cookies (RODO): collapsed = Akceptuj wszystkie / Tylko niezbędne / Dostosuj; expanded = 3 toggle (niezbędne disabled+checked, analityka, marketing). Zero propsów — czyta cookieConsent.store + useAuth. Pokazywany TYLKO niezalogowanym z consent===null (model opt-OUT: analityka aktywna od wejścia, „tylko niezbędne" ją wyłącza).',
    noRenderReason:
      'widoczność zależy od persisted consent (Zustand, consent===null) + niezalogowanej sesji + mounted-gate — w bibliotece zwykle nie renderuje nic (zgoda już zapisana w localStorage); rzetelny render wymagałby resetu store. Żywy podgląd: publiczna część app przy świeżym consent.',
  },
  supportFloatingButton: {
    id: 'support-floating-button',
    name: 'SupportFloatingButton',
    importPath:
      'src/UI/components/SupportFloatingButton/SupportFloatingButton.organism',
    status: 'DRAFT',
    whenToUse:
      'Pływający (position: fixed) przycisk-link do kontaktu/wsparcia, ukrywany na stronach kontaktu i centrum pomocy (HIDDEN_PATHS). Zero propsów — sam czyta router.pathname i kieruje na ROUTES_FRONT.CONTACT.',
  },
  createSessionModal: {
    id: 'create-session-modal',
    name: 'CreateSessionModal',
    importPath:
      'src/UI/components/CreateSessionModal/CreateSessionModal.organism',
    status: 'DRAFT',
    whenToUse:
      'Modal tworzenia sesji inspiracji z parowaną stylistką: krok wyboru z listy (available / blocked z aktywną sesją) albo potwierdzenie preselect (H11 — bez auto-POST na otwarciu) → krok done. Sterowany open + onClose; strona dostarcza listę stylists + onCreateSession.',
    noRenderReason:
      'portalowany fullscreen AppDialog sterowany open — render open nałożyłby modal na cały katalog (backdrop + focus-trap). Logika krokowa zależy od listy sparowanych stylistek (dane sesji). Żywy podgląd: ekran sesji w /app.',
  },
  galleryFilterSection: {
    id: 'gallery-filter-section',
    name: 'GalleryFilterSection',
    importPath:
      'src/UI/components/GalleryFilterSection/GalleryFilterSection.organism',
    status: 'DRAFT',
    whenToUse:
      'Pływający FAB filtrów (z licznikiem aktywnych) otwierający fullscreen GalleryFilterOverlay. Wariant „mocny" filtra galerii (kolory + traity per kategoria + długości + szukajka) — gdy GalleryQuickFilters inline to za mało.',
    noRenderReason:
      'renderuje position:fixed FAB + fullscreen GalleryFilterOverlay — FAB pływałby nad katalogiem, a otwarty overlay przykryłby stronę. To kontroler nakładki, nie inline-widget. Żywy podgląd: galeria w /app.',
  },
  galleryFilterOverlay: {
    id: 'gallery-filter-overlay',
    name: 'GalleryFilterOverlay',
    importPath:
      'src/UI/components/GalleryFilterOverlay/GalleryFilterOverlay.organism',
    status: 'DRAFT',
    whenToUse:
      'Fullscreen panel filtrów galerii (kolory, traity grupowane per kategoria FilterTraitSection, długości, tekstowa szukajka), z scroll-lock i focus-trapem. Sterowany isOpen + onClose; zwykle przez GalleryFilterSection, nie bezpośrednio.',
    noRenderReason:
      'portalowany fullscreen overlay sterowany isOpen — render open przykryłby cały katalog (scroll-lock + focus-trap aktywne). Konsumowany przez GalleryFilterSection. Żywy podgląd: galeria w /app.',
  },
} satisfies Record<string, UiLibraryEntryMeta>;

/* ─── UTILITY / LAYOUT i rodzina etykiet: osobny plik (limit długości) ─── */

export { LABEL_FAMILY_ENTRIES, UTILITY_ENTRIES };

/** Grupy w kolejności renderowania — TOC i sekcje czytają stąd. */
export const UI_LIBRARY_GROUPS: ReadonlyArray<UiLibraryGroup> = [
  { id: 'atomy', title: 'Atomy', entries: Object.values(ATOM_ENTRIES) },
  {
    id: 'molecules',
    title: 'Molecules (S19-S21)',
    entries: Object.values(MOLECULE_ENTRIES),
  },
  {
    id: 'molecules-lp',
    title: 'Molecules LP (S22)',
    entries: Object.values(LP_ENTRIES),
  },
  {
    id: 'compositions',
    title: 'Kompozycje (S24)',
    entries: Object.values(COMPOSITION_ENTRIES),
  },
  {
    id: 'app-organisms',
    title: 'Organizmy aplikacji (S28)',
    entries: Object.values(APP_ENTRIES),
  },
  {
    id: 'utility',
    title: 'Utility / Layout',
    entries: Object.values(UTILITY_ENTRIES),
  },
  {
    id: 'label-family',
    title: 'Rodzina etykiet: kiedy które',
    entries: Object.values(LABEL_FAMILY_ENTRIES),
  },
];
