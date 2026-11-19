// @vitest-environment node
import { describe, expect, it } from 'vitest';
import rule from './tint-discipline.mjs';
import { lintCss } from '../test-utils.mjs';

const FIXTURES = [
  {
    sample: 'must-fail/alias-chain.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/alias-chain.module.css':
        '/* Alias lokalny wskazujący na złoto: skan po nazwie --color-primary go nie\n   widzi, bo w deklaracji tła stoi nazwa aliasu. */\n.aliased {\n  --sekcja-akcent: var(--color-primary);\n  background: color-mix(in oklch, var(--sekcja-akcent) 12%, transparent);\n}\n',
    },
    frags: ['[.aliased]  background tint (sekcja-akcent 12%)'],
  },
  {
    sample: 'must-fail/alias-cross-file',
    fail: true,
    files: {
      'src/UI/features/fixture/a-page.module.css':
        '/* Alias zdefiniowany w INNYCH plikach niż użyty. Rozwiązywanie aliasów było\n   globalne wyłącznie dla palety, a poza nią per-plik — więc wystarczyło\n   rozdzielić deklarację i użycie na dwa moduły, żeby tint zniknął ze skanu.\n   Łańcuch jest rozpięty na TRZY pliki i odwrócony względem sortowania:\n   użycie tutaj, ogniwo pośrednie w m-, źródło złota w z-. Jeden przebieg\n   rozwiązywania zatrzymuje się na ogniwie pośrednim. */\n.washed {\n  background: color-mix(in oklch, var(--page-wash) 12%, transparent);\n}\n',
      'src/UI/features/fixture/m-mid.module.css':
        ':root {\n  --page-wash: var(--wash-source);\n}\n',
      'src/UI/features/fixture/z-tokens.module.css':
        ':root {\n  --wash-source: var(--color-primary);\n}\n',
    },
    frags: ['[.washed]  background tint (page-wash 12%)'],
  },
  {
    sample: 'must-fail/at-property-tint.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/at-property-tint.module.css':
        "/* Drabina kremu zarejestrowana przez @property: nazwa zmiennej stoi\n   w GŁÓWCE reguły, a wartość niesie `initial-value`, więc test „deklaracja\n   zaczyna się od --\" jej nie widział i cały wash przechodził bezgłośnie. */\n@property --page-wash {\n  syntax: '<color>';\n  inherits: false;\n  initial-value: color-mix(in oklch, var(--color-primary) 12%, transparent);\n}\n\n.washed {\n  background: var(--page-wash);\n}\n",
    },
    frags: ['[.washed]  tint through the local variable --page-wash'],
  },
  {
    sample: 'must-fail/at-rule-head-reset.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/at-rule-head-reset.module.css':
        '/* Instrukcja najwyższego poziomu zakończona średnikiem. Bez resetu „główki"\n   na średniku selektor kolejnego bloku sklejał się z nią w jeden ciąg, więc\n   etykieta naruszenia przestawała wskazywać regułę, której dotyczy. */\n@layer base, components;\n\n.tinted {\n  background: color-mix(in oklch, var(--color-primary) 12%, transparent);\n}\n',
    },
    frags: ['[.tinted]  background tint (color-primary 12%)'],
  },
  {
    sample: 'must-fail/background-shorthand.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/background-shorthand.module.css':
        "/* Tint w SKRÓCIE background, za obrazem — skan wymagający color-mix zaraz po\n   dwukropku nie ma czego dopasować, a pod zdjęciem leży ten sam wash. */\n.coverTile {\n  background: url('/img/lp/hero.avif') center / cover no-repeat\n    color-mix(in oklch, var(--color-primary) 12%, transparent);\n}\n",
    },
    frags: ['[.coverTile]  background tint (color-primary 12%)'],
  },
  {
    sample: 'must-fail/border-image-tint.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/border-image-tint.module.css':
        '/* border-image maluje POWIERZCHNIĘ ramy, nie linię — tint wpuszczony tędy\n   renderuje się jak każdy inny wash, a lista właściwości powierzchni go nie\n   obejmowała. */\n.tickedFrame {\n  border-image: repeating-linear-gradient(\n      45deg,\n      color-mix(in oklch, var(--color-primary) 12%, transparent) 0 4px,\n      transparent 4px 8px\n    )\n    8;\n}\n',
    },
    frags: ['[.tickedFrame]  background tint (color-primary 12%)'],
  },
  {
    sample: 'must-fail/border-shorthand-ink.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/border-shorthand-ink.module.css':
        '/* Rama akcentu zapisana SKRÓTEM i właściwością LOGICZNĄ. Lista samych\n   `border-*-color` widziała tylko zapis rozbity, a `border-top: 2px solid`\n   to najczęstszy realny zapis jednostronnego paska (R8). */\n.featuredTop {\n  border-top: 2px solid var(--color-ink);\n}\n\n.featuredStart {\n  border-inline-start: 2px solid var(--color-ink);\n}\n',
    },
    frags: [
      '[.featuredTop]  --color-ink as a frame (R8)',
      '[.featuredStart]  --color-ink as a frame (R8)',
    ],
  },
  {
    sample: 'must-fail/brace-in-string.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/brace-in-string.module.css':
        "/* Klamra w CIĄGU ZNAKÓW (`content: '}'`). Parser nieświadomy stringów zamykał\n   na niej blok, więc deklaracja tła lądowała POZA jakimkolwiek blokiem\n   i wypadała ze skanu w całości. */\n.tinted::after {\n  content: '}';\n  background: color-mix(in oklch, var(--color-primary) 12%, transparent);\n}\n",
    },
    frags: ['[.tinted::after]  background tint (color-primary 12%)'],
  },
  {
    sample: 'must-fail/color-text-is-base.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/color-text-is-base.module.css':
        '/* `--color-text-primary` kończy się na „primary”, więc bez jawnego wyłączenia\n   rodziny color-text-* wpadałby do akcentów, a mieszanina „dwóch akcentów”\n   wychodzi ze skanu bez śladu. Tymczasem to token TEKSTU, czyli baza\n   powierzchni, i złoto jest tu resztą mieszania: 8% washu pod treścią. */\n.washedOnText {\n  background: color-mix(in oklch, var(--color-text-primary) 92%, var(--color-primary));\n}\n',
    },
    frags: ['[.washedOnText]  background tint (color-primary 8%)'],
  },
  {
    sample: 'must-fail/cream-alias-cross-file',
    fail: true,
    files: {
      'src/UI/features/fixture/a-page.module.css':
        '/* Ten sam chwyt na KREMIE: alias mieszka w cudzym pliku, więc limit „jeden\n   pas kremu na stronę" przestawał obowiązywać w całości. Tu są dwa pasy. */\n.heroBand {\n  background: var(--band);\n}\n\n.footerBand {\n  background: var(--band);\n}\n',
      'src/UI/features/fixture/z-tokens.module.css':
        ':root {\n  --band: var(--color-bg-subtle);\n}\n',
    },
    frags: ['[.footerBand]  SECOND cream in the module'],
  },
  {
    sample: 'must-fail/cream-alias.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/cream-alias.module.css':
        '/* Krem za lokalnym aliasem: R2 wymagała literalnego var(--color-bg-subtle),\n   więc jedno przemianowanie rozbrajało limit „jeden pas na stronę”. Tu są\n   dwa pasy kremu, tyle że pod nazwą --band. */\n.page {\n  --band: var(--color-bg-subtle);\n}\n\n.heroBand {\n  background: var(--band);\n}\n\n.footerBand {\n  background: var(--band);\n}\n',
    },
    frags: ['[.footerBand]  SECOND cream in the module'],
  },
  {
    sample: 'must-fail/empty-reason.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/empty-reason.module.css':
        '/* Escape bez powodu = brak informacji dla review, czyli wyjątek nie do\n   zweryfikowania. Tło jest tu ZGODNE z motywem (token roli), więc jedynym\n   powodem faila może być sam pusty marker: gdy gałąź „tint-allow bez powodu”\n   zniknie, ta próbka przechodzi i meta-strażnik to widzi. Wcześniej łamała\n   dwie rzeczy naraz i chroniła regułę, której nie sprawdzała. */\n.noReason {\n  /* tint-allow: */\n  background: var(--color-mark-bg);\n}\n',
    },
    frags: ['[.noReason]  tint-allow without a reason'],
  },
  {
    sample: 'must-fail/escape-leak.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/escape-leak.module.css':
        '.legit {\n  /* tint-allow: ten wyjątek należy do TEGO bloku */\n  background: color-mix(in oklch, var(--color-primary) 10%, transparent);\n}\n/* Blok niżej NIE jest objęty wyjątkiem wyżej — okno „3 linie nad blokiem”\n   przechodziło jednak przez klamrę zamykającą i wyjątek przeciekał. */\n.leaked {\n  background: color-mix(in oklch, var(--color-primary) 10%, transparent);\n}\n',
    },
    frags: ['[.leaked]  background tint (color-primary 10%)'],
  },
  {
    sample: 'must-fail/exponent-percent.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/exponent-percent.module.css':
        '/* Procent w notacji wykładniczej (.12e2% == 12%) — legalny CSS, którego\n   regex `\\d{1,3}(\\.\\d+)?` nie parsował, więc udział złota wychodził „brak”. */\n.exponent {\n  background: color-mix(in oklch, var(--color-primary) .12e2%, transparent);\n}\n',
    },
    frags: ['[.exponent]  background tint (color-primary 12%)'],
  },
  {
    sample: 'must-fail/filter-opacity-chained.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/filter-opacity-chained.module.css':
        "/* Dotychczasowa próbka miała `opacity()` na POCZĄTKU wartości, więc mutacja\n   zawężająca test do początku wartości przeżywała. W realnym kodzie filtr\n   prawie zawsze jest łańcuchem, a udział bywa zapisany procentem. */\n.washChained::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  background: var(--color-primary);\n  filter: blur(2px) opacity(0.08);\n}\n\n.washPercent::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  background: var(--color-primary);\n  filter: opacity(8%);\n}\n",
    },
    frags: [
      '[.washChained::before]  solid gold + opacity 0.08',
      '[.washPercent::after]  solid gold + opacity 8%',
    ],
  },
  {
    sample: 'must-fail/filter-opacity.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/filter-opacity.module.css':
        "/* `filter: opacity(.08)` renderuje się PIKSEL W PIKSEL jak właściwość\n   `opacity`, a skan pytał o nazwę właściwości, więc solidne złoto przygaszone\n   filtrem uchodziło za pełny kolor marki. */\n.washByFilter::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  background: var(--color-primary);\n  filter: opacity(0.08);\n}\n",
    },
    frags: ['[.washByFilter::before]  solid gold + opacity 0.08'],
  },
  {
    sample: 'must-fail/global-alias.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/global-alias.module.css':
        '/* --color-accent i --color-cta to w palettes.css DOSŁOWNE aliasy\n   --color-primary (var(--color-primary)), więc tint przez nie to ten sam tint. */\n.viaAccent {\n  background: color-mix(in oklch, var(--color-accent) 14%, transparent);\n}\n',
    },
    frags: ['[.viaAccent]  background tint (color-accent 14%)'],
  },
  {
    sample: 'must-fail/gold-as-remainder.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/gold-as-remainder.module.css':
        '/* Złoto BEZ procentu — jest resztą mieszania, więc jego udział to 100 minus\n   procent drugiego koloru. Regex wymagający cyfr po var(--color-primary)\n   przepuszczał to bezgłośnie. */\n.remainder {\n  background: color-mix(in oklch, var(--color-bg-main) 92%, var(--color-primary));\n}\n',
    },
    frags: ['[.remainder]  background tint (color-primary 8%)'],
  },
  {
    sample: 'must-fail/gold-seed-tokens.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/gold-seed-tokens.module.css':
        '/* Cztery z sześciu tokenów ZŁOTA nie miały ani jednej próbki: usunięcie ich\n   z listy startowej przechodziło przez meta-strażnika bezgłośnie, a każdy\n   z nich renderuje dokładnie ten sam kolor marki. */\n.viaSecondary {\n  background: color-mix(in oklch, var(--color-secondary) 12%, transparent);\n}\n\n.viaCta {\n  background: color-mix(in oklch, var(--color-cta) 13%, transparent);\n}\n\n.viaAccentFg {\n  background: color-mix(in oklch, var(--color-accent-fg) 14%, transparent);\n}\n\n.viaAccentHover {\n  background: color-mix(in oklch, var(--color-accent-hover) 15%, transparent);\n}\n',
    },
    frags: [
      '[.viaSecondary]  background tint (color-secondary 12%)',
      '[.viaCta]  background tint (color-cta 13%)',
      '[.viaAccentFg]  background tint (color-accent-fg 14%)',
      '[.viaAccentHover]  background tint (color-accent-hover 15%)',
    ],
  },
  {
    sample: 'must-fail/hex-base-neutral.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/hex-base-neutral.module.css':
        '/* Baza mieszania zapisana HEXEM neutralnym (papier). To ta sama figura co\n   `var(--color-bg-main) 92%`, tylko z pominięciem tokenu — a rozpoznanie\n   hexa jako bazy nie miało próbki. */\n.overPaperHex {\n  background: color-mix(in oklch, #f7f5f2 92%, var(--color-primary));\n}\n',
    },
    frags: ['[.overPaperHex]  background tint (color-primary 8%)'],
  },
  {
    sample: 'must-fail/ink-allow-empty.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/ink-allow-empty.module.css':
        '/* Pusty escape ramy z atramentu. Reszta bloku jest ZGODNA z motywem, więc\n   jedynym powodem faila może być sam marker bez powodu — gdy ta gałąź\n   zniknie, komunikat zmieni się na zwykłe R8 i meta-strażnik to zobaczy. */\n.timelineDot {\n  /* ink-border-allow: */\n  background: var(--color-primary);\n  border: 2px solid var(--color-ink);\n}\n',
    },
    frags: ['[.timelineDot]  ink-border-allow without a reason'],
  },
  {
    sample: 'must-fail/ink-border.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/ink-border.module.css':
        '/* --color-ink jest ciemny w OBU trybach, więc jako rama wyróżnienia na\n   powierzchni strony w ciemności rysuje ciemną linię na ciemnym tle\n   i wyróżnienie znika (R8). */\n.featured {\n  background: var(--color-bg-main);\n  border: 2px solid var(--color-ink);\n}\n',
    },
    frags: ['[.featured]  --color-ink as a frame (R8)'],
  },
  {
    sample: 'must-fail/inset-shadow-wash.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/inset-shadow-wash.module.css':
        '/* box-shadow nie jest tłem, ale `inset` z rozlaniem na pół ekranu zalewa\n   CAŁĄ powierzchnię — renderowo to ten sam wash co background, a lista\n   właściwości powierzchni go nie obejmowała. */\n.washByShadow {\n  box-shadow: inset 0 0 0 999px\n    color-mix(in oklch, var(--color-primary) 12%, transparent);\n}\n',
    },
    frags: ['[.washByShadow]  background tint (color-primary 12%)'],
  },
  {
    sample: 'must-fail/lab-chromatic-tint.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/lab-chromatic-tint.module.css':
        '.labTint {\n  background: lab(60 40 30 / 0.12);\n}\n',
    },
    frags: ['raw colour function'],
  },
  {
    sample: 'must-fail/lab-percent-tint.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/lab-percent-tint.module.css':
        '.labPercentTint {\n  background: lab(50 8% 8% / 0.12);\n}\n',
    },
    frags: ['raw colour function'],
  },
  {
    sample: 'must-fail/lch-chromatic-tint.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/lch-chromatic-tint.module.css':
        '.lchTint {\n  background: lch(60 50 90 / 0.12);\n}\n',
    },
    frags: ['raw colour function'],
  },
  {
    sample: 'must-fail/local-cream-ladder.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/local-cream-ladder.module.css':
        '/* WŁASNA drabina kremu modułu: procent i token złota siedzą w deklaracji\n   zmiennej, a `background` widzi już tylko nazwę. To ta gałąź, która doniosła\n   cztery kremowe bandy na /for-clients, i przez cały czas nie miała próbki —\n   wyłączenie jej przechodziło przez meta-strażnika bez śladu. */\n.page {\n  --wash-1: color-mix(in oklch, var(--color-primary) 8%, var(--color-bg-main));\n}\n\n.introCard {\n  background: var(--wash-1);\n}\n',
    },
    frags: ['[.introCard]  tint through the local variable --wash-1'],
  },
  {
    sample: 'must-fail/local-raw-tint-var.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/local-raw-tint-var.module.css':
        '/* Drabina lokalna zbudowana na SUROWEJ funkcji koloru, nie na color-mix:\n   gałąź `rawColorTint` w rozpoznawaniu zmiennych modułu nie miała ani jednej\n   próbki, więc jej wyłączenie przechodziło bez śladu. */\n.page {\n  --wash-raw: rgba(212, 168, 64, 0.12);\n}\n\n.introCard {\n  background: var(--wash-raw);\n}\n',
    },
    frags: ['[.introCard]  tint through the local variable --wash-raw'],
  },
  {
    sample: 'must-fail/local-threshold-boundary.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/local-threshold-boundary.module.css':
        '/* Bliźniaczy próg drabiny lokalnej — ta sama granica, inna gałąź kodu\n   (localTints), i tak samo niezakotwiczona od góry. */\n.page {\n  --wash-44: color-mix(in oklch, var(--color-primary) 44%, var(--color-bg-main));\n  --wash-45: color-mix(in oklch, var(--color-primary) 45%, var(--color-bg-main));\n}\n\n.introCard {\n  background: var(--wash-44);\n}\n\n.outroCard {\n  background: var(--wash-45);\n}\n',
    },
    frags: [
      '[.introCard]  tint through the local variable --wash-44',
      '[.outroCard]  tint through the local variable --wash-45',
    ],
  },
  {
    sample: 'must-fail/main%src%UI%components%Chip%Chip.module.css',
    fail: true,
    files: {
      'src/UI/components/Chip/Chip.module.css':
        '/* Krem w prymitywie WSPÓŁDZIELONYM (głos S98/A): chip renderuje się\n   kilkanaście razy na jednym ekranie z filtrami, więc „jeden krem na stronę”\n   przestaje być prawdą, zanim strona zdąży cokolwiek narysować. */\n.chip {\n  background: var(--color-bg-subtle);\n}\n',
    },
    frags: ['[.chip]  cream in a shared primitive'],
  },
  {
    sample: 'must-fail/min-width-not-a-silencer.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/min-width-not-a-silencer.module.css':
        '/* Wyciszacz rozmiaru liczy WYŁĄCZNIE height/width. `min-width` i `min-height`\n   opisują ograniczenie, nie narysowany rozmiar — element z min-width: 2px\n   potrafi być pełną powierzchnią i tint pod nim zostaje tintem. */\n.railHandle {\n  min-width: 2px;\n  padding: var(--sp-3);\n  background: color-mix(in oklch, var(--color-primary) 12%, transparent);\n}\n',
    },
    frags: ['[.railHandle]  background tint (color-primary 12%)'],
  },
  {
    sample: 'must-fail/neutral-base-percent.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/neutral-base-percent.module.css':
        '/* Procent stojący przy BAZIE zapisanej literałem (transparent / white /\n   black), a nie przy tokenie. Skan zbierał procenty wyłącznie przy var(--x),\n   więc złoto-reszta wychodziło jako kolor PEŁNY (100%) i przechodziło. */\n.overTransparent {\n  background: color-mix(in oklch, transparent 88%, var(--color-primary));\n}\n\n.overWhite {\n  background: color-mix(in srgb, white 90%, var(--color-primary));\n}\n\n.overBlack {\n  background: color-mix(in srgb, black 91%, var(--color-primary));\n}\n',
    },
    frags: [
      '[.overTransparent]  background tint (color-primary 12%)',
      '[.overWhite]  background tint (color-primary 10%)',
      '[.overBlack]  background tint (color-primary 9%)',
    ],
  },
  {
    sample: 'must-fail/neutral-base-remainder.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/neutral-base-remainder.module.css':
        '/* Złoto jako reszta mieszania z tokenem NEUTRALNYM spoza szóstki\n   color-(bg|surface|paper|elevated|ink|on-ink). Test bazy pytał o tę szóstkę,\n   więc --color-border uchodził za „drugi akcent” i cała deklaracja wychodziła\n   ze skanu jako mieszanina akcentów, choć maluje 8% złota. */\n.viaBorderToken {\n  background: color-mix(in oklch, var(--color-border) 92%, var(--color-primary));\n}\n',
    },
    frags: ['[.viaBorderToken]  background tint (color-primary 8%)'],
  },
  {
    sample: 'must-fail/oklab-chromatic-percent.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/oklab-chromatic-percent.module.css':
        '/* Kontrola dla siostrzanej fixtury must-pass: skalowanie procentow ma\n   przeliczac, a nie WYCISZAC galaz. Tu a=0,06 i b=0,12, czyli chroma 0,134 —\n   ponad trzykrotnie ponad progiem tintu. */\n.oklabChromaticPercent {\n  background: oklab(70% 15% 30% / 0.12);\n}\n',
    },
    frags: ['raw colour function'],
  },
  {
    sample: 'must-fail/outline-ink.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/outline-ink.module.css':
        '/* `outline` i `outline-color` też rysują ramę wyróżnienia (R8) i też są\n   ciemne w OBU trybach — a lista właściwości ramy nie miała dla nich próbki. */\n.focusedCard {\n  outline: 2px solid var(--color-ink);\n}\n\n.focusedRow {\n  outline-color: var(--color-ink);\n}\n',
    },
    frags: [
      '[.focusedCard]  --color-ink as a frame (R8)',
      '[.focusedRow]  --color-ink as a frame (R8)',
    ],
  },
  {
    sample: 'must-fail/outset-shadow-wash.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/outset-shadow-wash.module.css':
        '/* Cień BEZ `inset`. Warunek wymagający `inset` przepuszczał tę figurę\n   w całości, a `0 0 0 999px` maluje na ZEWNĄTRZ elementu, czyli zalewa\n   washem wszystko dookoła — ten sam efekt, tylko po drugiej stronie\n   krawędzi. */\n.floodRing {\n  box-shadow: 0 0 0 999px\n    color-mix(in oklch, var(--color-primary) 12%, transparent);\n}\n',
    },
    frags: ['[.floodRing]  background tint (color-primary 12%)'],
  },
  {
    sample: 'must-fail/palette-alias',
    fail: true,
    files: {
      'src/UI/styles/themes/palettes.css':
        '/* Paleta z DWUSTOPNIOWYM aliasem złota, zapisanym w kolejności odwrotnej niż\n   rozwiązywanie: --brand-wash wskazuje --brand-gold ZANIM --brand-gold zostanie\n   zdefiniowany. Pokrywa i samo dopisywanie aliasu do zbioru złota, i to, że\n   pętla musi przejść po źródle więcej niż raz. */\n:root {\n  --brand-wash: var(--brand-gold);\n  --brand-gold: var(--color-primary);\n}\n',
      'src/UI/features/fixture/via-palette-alias.module.css':
        '/* Tint przez alias, który istnieje WYŁĄCZNIE w palecie: seed strażnika go nie\n   zna, więc bez rozwiązywania aliasów z palettes.css ta deklaracja jest\n   niewidzialna, choć renderuje 12% złota marki. */\n.viaPaletteAlias {\n  background: color-mix(in oklch, var(--brand-wash) 12%, transparent);\n}\n',
    },
    frags: ['[.viaPaletteAlias]  background tint (brand-wash 12%)'],
  },
  {
    sample: 'must-fail/percent-before-color.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/percent-before-color.module.css':
        '/* Procent PRZED kolorem: CSS Color 5 nie narzuca kolejności w color-mix,\n   a skan czytający tylko to, co stoi PO var(--gold), nie miał czego dopasować. */\n.reversedOrder {\n  background: color-mix(in oklch, 12% var(--color-primary), var(--color-bg-main));\n}\n',
    },
    frags: ['[.reversedOrder]  background tint (color-primary 12%)'],
  },
  {
    sample: 'must-fail/percent-in-var.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/percent-in-var.module.css':
        '/* Procent schowany w zmiennej: skan po literale „N%” po tokenie złota nie ma\n   czego dopasować, a renderuje się dokładnie ten sam wash. */\n.hiddenShare {\n  background: color-mix(\n    in oklch,\n    var(--color-primary) var(--wash-mix, 18%),\n    var(--color-bg-main)\n  );\n}\n',
    },
    frags: ['[.hiddenShare]  background tint (color-primary variable)'],
  },
  {
    sample: 'must-fail/raw-alpha-boundary.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/raw-alpha-boundary.module.css':
        '/* Granica alfy nie była zakotwiczona z żadnej strony: wszystkie próbki\n   surowego koloru siedziały na 0.10–0.12, więc mutacja `> 0.45` → `>= 0.45`\n   przeżywała. 0.45 to OSTATNIA alfa, którą motyw uznaje za wash. */\n.at45 {\n  background: rgba(212, 168, 64, 0.45);\n}\n',
    },
    frags: ['[.at45]  raw colour function with alpha 0.45'],
  },
  {
    sample: 'must-fail/raw-alpha-percent.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/raw-alpha-percent.module.css':
        '/* Alfa zapisana procentem, w obu składniach: nowoczesnej (ukośnik) i starej\n   (czwarty argument po przecinku). Wszystkie dotychczasowe próbki miały alfę\n   ułamkową, więc gałąź przeliczająca procent nie miała ani jednego dowodu. */\n.slashPercent {\n  background: rgb(212 168 64 / 12%);\n}\n\n.legacyPercent {\n  background: rgba(212, 168, 64, 12%);\n}\n',
    },
    frags: [
      '[.slashPercent]  raw colour function with alpha 0.12',
      '[.legacyPercent]  raw colour function with alpha 0.12',
    ],
  },
  {
    sample: 'must-fail/raw-chromatic-light.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/raw-chromatic-light.module.css':
        '/* Druga strona tej samej granicy: jasny tint z realną chromą zostaje\n   naruszeniem. `oklch()` zapisuje chromę WPROST, więc para 0.041 / 0.04\n   przypina próg z obu stron (bliźniacza próbka must-pass: raw-chroma-floor). */\n.washLightGold {\n  background: rgba(238, 205, 140, 0.25);\n}\n\n.washNearFloor {\n  background: rgba(248, 236, 205, 0.3);\n}\n\n.washFloorAbove {\n  background: oklch(0.82 0.041 88 / 0.12);\n}\n',
    },
    frags: [
      '[.washLightGold]  raw colour function with alpha 0.25',
      '[.washNearFloor]  raw colour function with alpha 0.3',
      '[.washFloorAbove]  raw colour function with alpha 0.12',
    ],
  },
  {
    sample: 'must-fail/raw-color-alpha.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/raw-color-alpha.module.css':
        '/* Surowa funkcja koloru: ani tokenu, ani hexa, ani color-mix — więc skan nie\n   miał czego dopasować, a hex-policy też jest ślepa (w pliku nie ma „#").\n   Kolor chromatyczny z alfą <= 45% to definicja washu, tyle że wpisana\n   liczbami. */\n.washRgba {\n  background: rgba(212, 168, 64, 0.12);\n}\n\n.washOklch {\n  background: oklch(0.82 0.12 88 / 0.12);\n}\n',
    },
    frags: [
      '[.washRgba]  raw colour function with alpha 0.12',
      '[.washOklch]  raw colour function with alpha 0.12',
    ],
  },
  {
    sample: 'must-fail/raw-color-function.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/raw-color-function.module.css':
        '/* `color()` renderuje ten sam wash co `rgb()`, a nie było jej na liście\n   funkcji koloru, choć sąsiedni skan relative color już ją znał. Zapis\n   z pominiętą pozycją w liście to najtańsze obejście, jakie istnieje. */\n.washSrgb {\n  background: color(srgb 0.88 0.7 0.25 / 0.12);\n}\n\n.washP3 {\n  background: color(display-p3 0.86 0.68 0.26 / 12%);\n}\n',
    },
    frags: [
      '[.washSrgb]  raw colour function with alpha 0.12',
      '[.washP3]  raw colour function with alpha 0.12',
    ],
  },
  {
    sample: 'must-fail/raw-status-red.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/raw-status-red.module.css':
        '/* R7 („tint kodujący STAN zostaje”) works on token NAMES, so a raw notation\n   does not benefit from it: the equivalent color-mix with var(--color-error)\n   passes, the number triple does not. The mismatch is deliberate (see the DECISION\n   at rawColorTint in tests/audit/tint-discipline.sh) and must stand in the MESSAGE,\n   so nobody rediscovers it in review. */\n.errorTint {\n  background: rgba(192, 57, 43, 0.1);\n}\n',
    },
    frags: [
      '[.errorTint]  raw colour function with alpha 0.1',
      'R7 (state) does not exempt a raw value, use the token',
    ],
  },
  {
    sample: 'must-fail/relative-color-alpha.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/relative-color-alpha.module.css':
        '/* Relative color: ani color-mix, ani procentu przy tokenie — udział niesie\n   ALFA, więc skan liczący wyłącznie mieszaniny widział pełne złoto (100%)\n   i próg nigdy nie strzelał. Renderowo to ten sam wash. */\n.viaRgbFrom {\n  background: rgb(from var(--color-primary) r g b / 0.08);\n}\n\n.viaOklchFrom {\n  background: oklch(from var(--color-primary) l c h / 8%);\n}\n',
    },
    frags: [
      '[.viaRgbFrom]  background tint (color-primary 8%)',
      '[.viaOklchFrom]  background tint (color-primary 8%)',
    ],
  },
  {
    sample: 'must-fail/single-line-block.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/single-line-block.module.css':
        '/* Cały blok w JEDNEJ linii — parser oparty na „linia otwiera / linia zamyka”\n   nigdy takiego bloku nie widział: opens == closes, więc nie trafiał ani na\n   stos, ani do ciała żadnego bloku. Znaleziony przez ten fixture, nie przez\n   czytanie regexa. */\n.oneLiner { background: color-mix(in oklch, var(--color-primary) 12%, transparent); }\n',
    },
    frags: ['[.oneLiner]  background tint (color-primary 12%)'],
  },
  {
    sample: 'must-fail/size-above-tiny.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/size-above-tiny.module.css':
        '/* Górna granica wyciszacza rozmiaru: 1–6px to linia albo glif, 8px to już\n   pasek, pod którym da się położyć treść. Bez tej próbki rozszerzenie\n   zakresu do [1-9] przechodziło przez meta-strażnika bez śladu. */\n.thickBar {\n  height: 8px;\n  background: color-mix(in oklch, var(--color-primary) 12%, transparent);\n}\n',
    },
    frags: ['[.thickBar]  background tint (color-primary 12%)'],
  },
  {
    sample: 'must-fail/solid-plus-opacity.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/solid-plus-opacity.module.css':
        "/* Solidne złoto plus przezroczystość renderuje się PIKSEL W PIKSEL tak samo\n   jak tint 7% — a żaden skan po color-mix tego nie widzi. */\n.washByOpacity::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  background: var(--color-primary);\n  opacity: 0.07;\n}\n",
    },
    frags: ['[.washByOpacity::before]  solid gold + opacity 0.07'],
  },
  {
    sample: 'must-fail/surface-props.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/surface-props.module.css':
        '/* Zestaw właściwości POWIERZCHNI: każde usunięcie z listy przeżywało mutację,\n   bo wszystkie próbki malowały przez goły `background`. background-color\n   i background-image to ten sam wash, a fill/stroke to jego wersja w SVG. */\n.panel {\n  background-color: color-mix(in oklch, var(--color-primary) 12%, transparent);\n}\n\n.dotField {\n  background-image: radial-gradient(\n    color-mix(in oklch, var(--color-primary) 14%, transparent) 1px,\n    transparent 1px\n  );\n  background-size: 12px 12px;\n}\n\n.chartArea {\n  fill: color-mix(in oklch, var(--color-primary) 16%, transparent);\n}\n\n.chartLine {\n  stroke: color-mix(in oklch, var(--color-primary) 18%, transparent);\n}\n',
    },
    frags: [
      '[.panel]  background tint (color-primary 12%)',
      '[.dotField]  background tint (color-primary 14%)',
      '[.chartArea]  background tint (color-primary 16%)',
      '[.chartLine]  background tint (color-primary 18%)',
    ],
  },
  {
    sample: 'must-fail/table-allow-empty.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/table-allow-empty.module.css':
        '/* Pusty escape decyzji o table-layout — ta sama klasa co wyżej: marker bez\n   powodu to wyjątek nie do zweryfikowania w review. */\n.logTable {\n  /* table-layout-auto: */\n  width: 100%;\n  border-collapse: collapse;\n}\n',
    },
    frags: ['[.logTable]  table-layout-auto without a reason'],
  },
  {
    sample: 'must-fail/table-auto.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/table-auto.module.css':
        '/* Tabela bez jawnej decyzji o table-layout: auto waży kolumny długością\n   nagłówka, więc porównanie rozjeżdża się przy każdej zmianie copy (R10). */\n.comparison {\n  width: 100%;\n  border-collapse: collapse;\n}\n',
    },
    frags: ['[.comparison]  table without a table-layout decision (R10)'],
  },
  {
    sample: 'must-fail/threshold-boundary.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/threshold-boundary.module.css':
        '/* Próg 45% nie był zakotwiczony od GÓRY: mutacja przesuwająca go w dół\n   przeżywała, bo wszystkie próbki siedziały głęboko pod progiem (8–14%).\n   44 i 45 to ostatnie dwa udziały, które motyw uznaje za wash. */\n.at44 {\n  background: color-mix(in oklch, var(--color-primary) 44%, var(--color-bg-main));\n}\n\n.at45 {\n  background: color-mix(in oklch, var(--color-primary) 45%, var(--color-bg-main));\n}\n',
    },
    frags: [
      '[.at44]  background tint (color-primary 44%)',
      '[.at45]  background tint (color-primary 45%)',
    ],
  },
  {
    sample: 'must-fail/two-creams.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/two-creams.module.css':
        '/* Dwa kremy na jednej stronie — dokładnie to, czego zakazuje R2. */\n.heroBand {\n  background: var(--color-bg-subtle);\n}\n\n.footerBand {\n  background: var(--color-bg-subtle);\n}\n',
    },
    frags: ['[.footerBand]  SECOND cream in the module'],
  },
  {
    sample: 'must-fail/urlencoded-hex.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/urlencoded-hex.module.css':
        "/* Hex zakodowany URL-owo w data-URI: omija także hex-policy, bo w pliku nie ma\n   znaku „#”. Tak przeżyła złota siatka kropek w layoucie admina. */\n.dotGrid {\n  background-image: url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle r='1' fill='%23d4a840'/%3E%3C/svg%3E\");\n}\n",
    },
    frags: ['[.dotGrid]  URL-encoded brand colour (%23d4a840)'],
  },
  {
    sample: 'must-fail/zebra-nth-of-type.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/zebra-nth-of-type.module.css':
        '/* Zebra zapisana przez nth-of-type / nth-last-child — skan łapał tylko\n   nth-child, więc alternacja przechodziła pod innym zapisem tego samego. */\n.row:nth-of-type(even) {\n  background: var(--color-surface-input);\n}\n\n.cell:nth-last-child(2n) {\n  background: var(--color-surface-hover);\n}\n',
    },
    frags: [
      '[.row:nth-of-type(even)]  zebra (R4)',
      '[.cell:nth-last-child(2n)]  zebra (R4)',
    ],
  },
  {
    sample: 'must-fail/zero-px-silencer.module.css',
    fail: true,
    files: {
      'src/UI/features/fixture/zero-px-silencer.module.css':
        '/* Wyciszacz rozmiaru liczy JAWNY rozmiar 1–6px (linia, glif, konektor).\n   `0px` to nie element wielkości linii, tylko pudełko zwinięte do zera, które\n   rośnie paddingiem albo aspect-ratio, więc rozszerzenie zakresu w dół\n   (`[0-6]px`) zamienia każde wyzerowane pudełko w uniwersalny wyłącznik\n   strażnika. Wariant `min-width` pokrywa osobna próbka:\n   min-width-not-a-silencer. */\n.collapsedBox {\n  width: 0px;\n  padding-inline: var(--sp-4);\n  background: color-mix(in oklch, var(--color-primary) 12%, transparent);\n}\n',
    },
    frags: ['[.collapsedBox]  background tint (color-primary 12%)'],
  },
  {
    sample: 'must-pass/alias-scope-collision',
    fail: false,
    files: {
      'src/UI/features/fixture/a-about.module.css':
        '/* Kolizja nazw między modułami, żywa w drzewie: --eyebrow-color ustawia\n   AboutPage (złoto), PricingPage (złoto) i trzecia strona (neutralnie).\n   Deklaracja stoi w KLASIE, więc obowiązuje w poddrzewie tej klasy, a klasa\n   CSS Modules jest hashowana per plik. Rozwiązywanie aliasów po samej NAZWIE\n   zlewało te trzy zmienne w jedną i przenosiło „złoto" na moduł, który go nie\n   ma. */\n.aboutPage {\n  --eyebrow-color: var(--color-accent-fg);\n}\n',
      'src/UI/features/fixture/b-pricing.module.css':
        '/* Druga strona, ta sama nazwa zmiennej, znowu złoto. Dwa źródła kolizji\n   wystarczą, żeby globalny namespace wyglądał wiarygodnie. */\n.pricingPage {\n  --eyebrow-color: var(--color-primary);\n}\n',
      'src/UI/features/fixture/c-neutral.module.css':
        '/* Trzeci moduł: ta sama nazwa, wartość NEUTRALNA. Wash pod nagłówkiem jest tu\n   szarością tekstu, nie kolorem marki, i strażnik nie ma prawa go zgłosić.\n   Przed domknięciem zasięgu zgłaszał: --eyebrow-color był w zbiorze złota\n   przez dwa CUDZE moduły. */\n.helpPage {\n  --eyebrow-color: var(--color-text-muted);\n}\n\n.helpPage .eyebrowWash {\n  background: color-mix(in oklch, var(--eyebrow-color) 12%, transparent);\n}\n',
      'src/UI/features/fixture/d-story.module.css':
        '/* Ta sama mechanika na KREMIE. Tu alias --band faktycznie wskazuje krem\n   i niesie JEDEN pas, czyli zapis w pełni legalny (R2). */\n.storyPage {\n  --band: var(--color-bg-subtle);\n}\n\n.storyPage .heroBand {\n  background: var(--band);\n}\n',
      'src/UI/features/fixture/e-faq.module.css':
        '/* Inny moduł, ta sama nazwa --band, wartość neutralna. Dwa użycia, więc przy\n   globalnym rozwiązywaniu po nazwie wychodziło fałszywe „DRUGI krem\n   w module (R2)" na module, w którym kremu nie ma ani grama. */\n.faqPage {\n  --band: var(--color-surface-input);\n}\n\n.faqPage .rowA {\n  background: var(--band);\n}\n\n.faqPage .rowB {\n  background: var(--band);\n}\n',
    },
    frags: ['background tint', 'SECOND cream in the module'],
  },
  {
    sample: 'must-pass/cream-alias-once.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/cream-alias-once.module.css':
        '/* JEDEN pas kremu, tyle że pod lokalną nazwą — alias sam w sobie nie jest\n   naruszeniem, limit dotyczy liczby pasów. */\n.page {\n  --band: var(--color-bg-subtle);\n}\n\n.benefitsBand {\n  background: var(--band);\n}\n\n.rest {\n  background: var(--color-bg-main);\n}\n',
    },
    frags: ['SECOND cream in the module'],
  },
  {
    sample: 'must-pass/cream-dark-mode-pair.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/cream-dark-mode-pair.module.css':
        "/* Ten SAM pas kremu opisany dwa razy: raz w trybie jasnym, raz w nadpisaniu\n   dla ciemnego. To jedna powierzchnia, nie dwie — klucz zliczania musi\n   normalizować prefiks trybu, inaczej każde nadpisanie dark liczyłoby się\n   jako drugi krem. */\n.heroBand {\n  background: var(--color-bg-subtle);\n}\n\n:root[data-mode='dark'] .heroBand {\n  background: var(--color-bg-subtle);\n}\n",
    },
    frags: ['SECOND cream in the module'],
  },
  {
    sample: 'must-pass/dark-mode-ink-border.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/dark-mode-ink-border.module.css':
        "/* R8 pilnuje ramy, która NIE odwraca się z trybem. W nadpisaniu jawnie\n   przypisanym do trybu ciemnego atrament jest wyborem świadomym i widocznym\n   w selektorze — reguła musi ten wyjątek widzieć. */\n:root[data-mode='dark'] .featured {\n  border: 2px solid var(--color-ink);\n}\n",
    },
    frags: ['--color-ink as a frame (R8)', 'ink-border-allow without a reason'],
  },
  {
    sample: 'must-pass/escaped-in-media-gap.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/escaped-in-media-gap.module.css':
        '/* tint-allow: jeden pas kremu rozcięty hairlinem — oba panele MUSZĄ mieć ten\n   sam tint, żeby szczelina 1px czytała się jako linia, a nie jako prześwit. */\n@media (min-width: 768px) {\n  .splitLeft {\n    background: color-mix(in oklch, var(--color-primary) 7%, var(--color-bg-main));\n  }\n\n  .splitRight {\n    background: color-mix(in oklch, var(--color-primary) 7%, var(--color-bg-main));\n  }\n}\n',
    },
    frags: ['background tint', 'tint-allow without a reason'],
  },
  {
    sample: 'must-pass/escaped-with-reason.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/escaped-with-reason.module.css':
        '.dataTint {\n  /* tint-allow: hue pochodzi z imienia stylistki, więc tint KODUJE DANE */\n  background: color-mix(\n    in oklch,\n    var(--cover-hue, var(--color-primary)) var(--cover-mix, 18%),\n    var(--color-bg-main)\n  );\n}\n',
    },
    frags: ['background tint', 'tint-allow without a reason'],
  },
  {
    sample: 'must-pass/flex-min-width.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/flex-min-width.module.css':
        '/* `min-width: 0` bez tintu — najczęstsza deklaracja flexboxa w repo.\n   Odebranie jej mocy wyciszania nie może zamienić jej w naruszenie. */\n.truncatingCell {\n  min-width: 0;\n  overflow: hidden;\n  background: var(--color-bg-main);\n}\n',
    },
    frags: ['background tint'],
  },
  {
    sample: 'must-pass/gold-as-text-and-full-block.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/gold-as-text-and-full-block.module.css':
        '/* Złoto jako TEKST i jako PEŁNY blok koloru (R1 dopuszcza pełny negatyw)\n   — motyw zakazuje tintu POD TREŚCIĄ, nie koloru marki jako takiego. */\n.accentWord {\n  color: var(--color-accent-fg);\n}\n\n.goldBlock {\n  background: var(--color-primary);\n  color: var(--color-primary-contrast);\n}\n',
    },
    frags: ['background tint'],
  },
  {
    sample: 'must-pass/hairline-connector.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/hairline-connector.module.css':
        "/* Konektor kroków w grubości 2px: element wielkości LINII, nie powierzchnia\n   pod treścią. Wyciszenie po rozmiarze zostaje, ale wyłącznie dla jawnego\n   1–6px na height/width. */\n.stepsList::before {\n  content: '';\n  position: absolute;\n  width: 2px;\n  background: color-mix(in oklch, var(--color-primary) 25%, transparent);\n}\n",
    },
    frags: ['background tint'],
  },
  {
    sample: 'must-pass/hairline-ring-outset.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/hairline-ring-outset.module.css':
        "/* Obrys BEZ inset: zdjęcie wymogu `inset` nie może zamienić hairline'a\n   w naruszenie. Granica jest w rozlaniu (20px), nie w słowie kluczowym. */\n.ringed {\n  background: var(--color-bg-main);\n  box-shadow: 0 0 0 1px color-mix(in oklch, var(--color-primary) 22%, transparent);\n}\n",
    },
    frags: ['background tint'],
  },
  {
    sample: 'must-pass/hairline-ring-shadow.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/hairline-ring-shadow.module.css':
        '/* `inset 0 0 0 1px` to OBRYS w grubości włosa, nie wash powierzchni —\n   zapis obecny w kilkunastu żywych modułach. Strażnik liczy box-shadow jako\n   powierzchnię dopiero od rozlania/rozmycia 20px w górę. */\n.ringed {\n  background: var(--color-bg-main);\n  box-shadow: inset 0 0 0 1px\n    color-mix(in oklch, var(--color-primary) 22%, transparent);\n}\n',
    },
    frags: ['background tint'],
  },
  {
    sample: 'must-pass/hex-base-chromatic.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/hex-base-chromatic.module.css':
        '/* Hex CHROMATYCZNY jako baza to drugi AKCENT, nie papier — mieszanina dwóch\n   akcentów daje pełnokolorowy odcień roli, nie wash pod treścią. Ten sam\n   zapis co --client-rose w ActivateRolePage, tylko bez pośrednictwa tokenu. */\n.roleOrbLiteral {\n  background: color-mix(in oklch, #e16a8c 55%, var(--color-primary));\n}\n',
    },
    frags: ['background tint'],
  },
  {
    sample: 'must-pass/hidden-by-default.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/hidden-by-default.module.css':
        "/* opacity: 0 = element UKRYTY w stanie bazowym (wskaźnik aktywnej zakładki\n   animujący się do 1). To nie jest przygaszone złoto udające tint — jego\n   widoczny stan opisuje osobna reguła i to ona podlega ocenie.\n   Świadomie BEZ deklaracji rozmiaru: z `height: 2px` próbkę wyciszał\n   wyciszacz rozmiaru, a nie warunek `opacity > 0`, który miała pokrywać. */\n.tab::after {\n  content: '';\n  position: absolute;\n  inset: auto 0 0 0;\n  background: var(--color-primary);\n  opacity: 0;\n}\n\n.tab[data-active='true']::after {\n  opacity: 1;\n}\n",
    },
    frags: ['solid gold + opacity'],
  },
  {
    sample: 'must-pass/ink-border-on-ink.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/ink-border-on-ink.module.css':
        '/* Rama z atramentu NA atramentowej powierzchni = wycięcie, nie wyróżnienie:\n   powierzchnia jest mode-invariant, więc rama też ma być.\n   ink-border-allow: kropka osi czasu leży na sekcji w atramencie */\n.timelineDot {\n  background: var(--color-primary);\n  border: 2px solid var(--color-ink);\n}\n\n/* Mieszanina NA atramencie (jaśniejszy odcień do ramowania karty-negatywu) —\n   to nie jest „ink jako uniwersalna linia”. */\n.negativeCard {\n  background: var(--color-ink);\n  border-color: color-mix(in oklch, var(--color-on-ink) 18%, var(--color-ink));\n}\n',
    },
    frags: ['--color-ink as a frame (R8)', 'ink-border-allow without a reason'],
  },
  {
    sample: 'must-pass/lab-neutral-overlay.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/lab-neutral-overlay.module.css':
        '.labNeutral {\n  background: lab(20 0.5 0.4 / 0.4);\n}\n',
    },
    frags: ['raw colour function'],
  },
  {
    sample: 'must-pass/local-accent-chain.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/local-accent-chain.module.css':
        '/* Łańcuch aliasów AKCENTU rozwiązywany w trzech przebiegach: --rose-alias\n   wskazuje token zdefiniowany NIŻEJ w pliku, więc pojedynczy przebieg\n   zostawiał go nierozpoznanym i mieszanina dwóch akcentów lądowała w raporcie\n   jako 45-procentowy tint. */\n.roleOrb {\n  background: color-mix(in oklch, var(--rose-alias) 55%, var(--color-primary));\n}\n\n.page {\n  --rose-alias: var(--client-rose);\n  --client-rose: #e16a8c;\n}\n',
    },
    frags: ['background tint', 'tint through the local variable'],
  },
  {
    sample: 'must-pass/main%src%UI%components%AppHero%AppHero.module.css',
    fail: false,
    files: {
      'src/UI/components/AppHero/AppHero.module.css':
        '/* AppHero i Section to DWA prymitywy, które mają prawo nieść krem (głos\n   S98/A): hero jest kartą-intro strony, nie atomem powtarzanym kilkanaście\n   razy na ekranie. Wyjątek dla AppHero nie miał próbki, więc jego usunięcie\n   przechodziło przez meta-strażnika bez śladu. */\n.heroBand {\n  background: var(--color-bg-subtle);\n}\n',
    },
    frags: ['cream in a shared primitive'],
  },
  {
    sample: 'must-pass/main%src%UI%components%Section%Section.module.css',
    fail: false,
    files: {
      'src/UI/components/Section/Section.module.css':
        '/* Kanoniczny pas kremu: JEDEN komponent, który ma prawo go nieść (drugi to\n   AppHero). Reszta prymitywów współdzielonych schodzi na neutralny stopień —\n   inaczej krem mnoży się przez każdy ekran, który je montuje (głos S98/A). */\n.subtle {\n  background: var(--color-bg-subtle);\n}\n',
    },
    frags: ['cream in a shared primitive'],
  },
  {
    sample:
      'must-pass/main%src%UI%features%admin%components%UserDetailsDialog.module.css',
    fail: false,
    files: {
      'src/UI/features/admin/components/UserDetailsDialog.module.css':
        '/* Reguła „krem w prymitywie współdzielonym” celuje WYŁĄCZNIE w katalog\n   main/src/UI/components. UserDetailsDialog leży w features/admin/components\n   i jest częścią JEDNEJ strony, nie prymitywem montowanym na każdym ekranie,\n   więc jeden pas kremu ma tu prawo żyć. Bez tej próbki udokumentowana\n   decyzja nie miała żadnego dowodu i zawężenie wzorca do „components/”\n   przechodziło bezgłośnie. */\n.dialogIntro {\n  background: var(--color-bg-subtle);\n}\n',
    },
    frags: ['cream in a shared primitive'],
  },
  {
    sample: 'must-pass/media-nested-table.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/media-nested-table.module.css':
        '/* Tabela z JAWNĄ decyzją o table-layout, zagnieżdżona w @media. Skan liczy\n   tylko bloki LIŚCIE — bez tego ciało @media (z którego parser deklaracji\n   wyławia samo `border-collapse`) raportowałoby tabelę bez decyzji, choć\n   decyzja stoi linijkę wyżej. */\n@media (min-width: 768px) {\n  .comparison {\n    table-layout: fixed;\n    border-collapse: collapse;\n  }\n}\n',
    },
    frags: [
      'tabela bez decyzji o table-layout',
      'table-layout-auto without a reason',
    ],
  },
  {
    sample: 'must-pass/neutral-raw-overlay.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/neutral-raw-overlay.module.css':
        '/* Surowe kolory, które ZOSTAJĄ: przyciemnienie overlaya (biel/czerń nie\n   niosą chromy, więc nie są kolorem marki) oraz pełny, nieprzezroczysty\n   kolor banera. Rozpoznanie washu wymaga OBU cech naraz — chromy i alfy\n   <= 45% — a każda z osobna ma prawo żyć. */\n.scrim {\n  background: rgba(0, 0, 0, 0.5);\n}\n\n.scrimSlash {\n  background: rgb(0 0 0 / 0.12);\n}\n\n.solidBanner {\n  background: oklch(78% 0.17 85);\n}\n',
    },
    frags: ['raw colour function'],
  },
  {
    sample: 'must-pass/neutral-urlhex.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/neutral-urlhex.module.css':
        "/* Hex URL-owy NEUTRALNY: biel w SVG w tle to konieczność strukturalna (SVG\n   nie czyta zmiennych CSS ani currentColor), nie ucieczka z systemu tokenów.\n   Skan hexa URL-owego musi pytać o chromę, nie o sam zapis. */\n.grid::after {\n  content: '';\n  background-image: url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='2' height='2' fill='%23ffffff'/%3E%3C/svg%3E\");\n}\n",
    },
    frags: ['URL-encoded brand colour'],
  },
  {
    sample: 'must-pass/nth-child-layout.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/nth-child-layout.module.css':
        '/* nth-child użyty do UKŁADU, bez tła — to nie zebra. */\n.tile:nth-child(even) {\n  grid-column: span 2;\n}\n\n.tile:nth-of-type(3) {\n  align-self: end;\n}\n',
    },
    frags: ['zebra (R4)'],
  },
  {
    sample: 'must-pass/oklab-neutral-percent.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/oklab-neutral-percent.module.css':
        '/* Notacja procentowa w oklab(): 100% osi a/b to 0,4, wiec `1%` = 0,004.\n   Realna chroma tego koloru to 0,0057 — daleko ponizej progu tintu. */\n.oklabNeutralPercent {\n  background: oklab(50% 1% 1% / 0.12);\n}\n',
    },
    frags: ['raw colour function'],
  },
  {
    sample: 'must-pass/one-cream.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/one-cream.module.css':
        '/* Jeden pas kremu na stronę — legalny. */\n.benefitsBand {\n  background: var(--color-bg-subtle);\n}\n\n.rest {\n  background: var(--color-bg-main);\n}\n',
    },
    frags: ['SECOND cream in the module'],
  },
  {
    sample: 'must-pass/raw-alpha-above.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/raw-alpha-above.module.css':
        '/* 0.46 to już pełnokolorowa powierzchnia akcentu, nie wash pod treścią,\n   a alfa 0 to element całkowicie przezroczysty (jego widoczny stan opisuje\n   inna reguła). Obie granice muszą być zakotwiczone, inaczej rozszerzenie\n   progu zamienia strażnika w zakaz koloru marki jako takiego. */\n.at46 {\n  background: rgba(212, 168, 64, 0.46);\n}\n\n.fullyTransparent {\n  background: rgba(212, 168, 64, 0);\n}\n',
    },
    frags: ['raw colour function'],
  },
  {
    sample: 'must-pass/raw-chroma-floor.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/raw-chroma-floor.module.css':
        '/* Chroma DOKŁADNIE na progu to jeszcze nie kolor (próg jest ostry: „>”).\n   Bez tej próbki mutacja podnosząca CHROMA_FLOOR przeżywała, bo wszystkie\n   naruszenia siedziały trzykrotnie nad progiem. */\n.washAtFloor {\n  background: oklch(0.82 0.04 88 / 0.12);\n}\n',
    },
    frags: ['raw colour function'],
  },
  {
    sample: 'must-pass/raw-near-black-overlay.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/raw-near-black-overlay.module.css':
        '/* Próg chromatyczności mierzył BEZWZGLĘDNY rozstrzał kanałów, bez oglądania\n   jasności, więc prawie-czerń o ciepłym odcieniu (rozstrzał 16) była\n   zgłaszana jako tint marki, choć komentarz strażnika obiecuje przepuścić\n   każde neutralne przyciemnienie overlaya. Te trzy zapisy to ten sam kolor\n   w trzech notacjach: dwie pierwsze mają chromę ~0.020, trzecia ~0.023. */\n.scrimWarm {\n  background: rgba(28, 20, 12, 0.45);\n}\n\n.scrimWarmHsl {\n  background: hsla(30, 40%, 8%, 0.45);\n}\n\n.scrimWarmLifted {\n  background: rgba(40, 34, 22, 0.4);\n}\n\n.scrimNeutralColorFn {\n  background: color(srgb 0.1 0.1 0.1 / 0.4);\n}\n',
    },
    frags: ['raw colour function'],
  },
  {
    sample: 'must-pass/role-token-literal-alias',
    fail: false,
    files: {
      'src/UI/features/fixture/badge.module.css':
        '.badgeSoft {\n  background: color-mix(in oklch, var(--color-mark-bg-on-ink) 40%, var(--color-ink));\n}\n',
      'src/UI/styles/tokens.css':
        '/* Rola „znak na atramencie" bywa PEŁNYM złotem: na ciemnej powierzchni badge\n   nie potrzebuje przygaszenia, więc token roli jest tu DOSŁOWNYM aliasem\n   złota. Bez listy tokenów roli wpadłby do zbioru złota i strażnik zaczął by\n   krzyczeć na wyjście, do którego sam kieruje. */\n:root {\n  --color-primary: #c8a24a;\n  --color-mark-bg-on-ink: var(--color-primary);\n}\n',
    },
    frags: ['background tint'],
  },
  {
    sample: 'must-pass/role-tokens.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/role-tokens.module.css':
        '/* Trzy role, w których tint ZOSTAJE złoty — każda przez token z tokens.css.\n   Strażnik nie może ich ruszać, bo to jest właśnie wyjście, na które kieruje. */\n.markCircle {\n  background: var(--color-mark-bg);\n}\n\n.markCircleStrong {\n  background: var(--color-mark-bg-strong);\n}\n\n.markOnInk {\n  background: var(--color-mark-bg-on-ink);\n}\n\n.selectedRow {\n  background: var(--color-state-selected);\n}\n\n.hoverRow:hover {\n  background: var(--color-state-hover);\n}\n',
    },
    frags: ['background tint'],
  },
  {
    sample: 'must-pass/status-tints.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/status-tints.module.css':
        '/* R7: tint kodujący STAN niesie znaczenie — poza zakresem motywu.\n   Czystka „wszystkiego, co ma color-mix” byłaby błędem, nie wykonaniem. */\n.error {\n  background: color-mix(in oklch, var(--color-error) 12%, transparent);\n}\n\n.warning {\n  background: color-mix(in oklch, var(--color-warning) 12%, transparent);\n}\n\n.success {\n  background: color-mix(in oklch, var(--color-success) 16%, transparent);\n}\n\n.info {\n  background: color-mix(in oklch, var(--color-info) 12%, transparent);\n}\n',
    },
    frags: ['background tint'],
  },
  {
    sample: 'must-pass/tables.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/tables.module.css':
        '/* Dwa legalne zapisy: jawnie stała szerokość kolumn albo jawnie uzasadniony\n   auto. Zakazany jest tylko BRAK decyzji. */\n.comparison {\n  width: 100%;\n  border-collapse: collapse;\n  table-layout: fixed;\n}\n\n.logTable {\n  /* table-layout-auto: log admina scrolluje się poziomo (nowrap + overflow-x),\n     więc kolumny mają sizować się treścią, nie równym podziałem */\n  width: 100%;\n  border-collapse: collapse;\n  white-space: nowrap;\n}\n',
    },
    frags: [
      'tabela bez decyzji o table-layout',
      'table-layout-auto without a reason',
    ],
  },
  {
    sample: 'must-pass/threshold-above.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/threshold-above.module.css':
        '/* 46% to już nie wash, tylko pełnokolorowa powierzchnia akcentu — próg musi\n   być zakotwiczony także od tej strony, inaczej rozszerzenie go w górę\n   zamieniłoby strażnika w zakaz koloru marki jako takiego. */\n.at46 {\n  background: color-mix(in oklch, var(--color-primary) 46%, var(--color-bg-main));\n}\n\n.page {\n  --wash-46: color-mix(in oklch, var(--color-primary) 46%, var(--color-bg-main));\n}\n\n.introCard {\n  background: var(--wash-46);\n}\n',
    },
    frags: ['background tint', 'tint through the local variable'],
  },
  {
    sample: 'must-pass/tiny-size-upper.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/tiny-size-upper.module.css':
        "/* 6px to ostatnia grubość, którą motyw uznaje za LINIĘ (konektor, tor,\n   podkreślenie). Bez tej próbki zawężenie wyciszacza do [1-5] przechodziło\n   bez śladu i zaczynało krzyczeć na hairline'y. */\n.trackRail {\n  height: 6px;\n  background: color-mix(in oklch, var(--color-primary) 25%, transparent);\n}\n",
    },
    frags: ['background tint'],
  },
  {
    sample: 'must-pass/two-accents-mixed.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/two-accents-mixed.module.css':
        '/* Dwa AKCENTY zmieszane w jeden odcień roli: hue klientki (--client-rose,\n   goły kolor chromatyczny) z 55-procentowym udziałem, złoto marki jako reszta.\n   To pełnokolorowy akcent, nie wash pod treścią — dokładnie ten zapis żyje\n   w ActivateRolePage i strażnik nie może go ruszać. */\n.page {\n  --client-rose: #e16a8c;\n  --activate-accent: color-mix(in oklch, var(--client-rose) 55%, var(--color-primary));\n}\n\n.roleOrb {\n  background: var(--activate-accent);\n}\n',
    },
    frags: ['background tint', 'tint through the local variable'],
  },
  {
    sample: 'must-pass/url-fragment.module.css',
    fail: false,
    files: {
      'src/UI/features/fixture/url-fragment.module.css':
        "/* %23 to zakodowany „#”, ale tu jest referencją do filtra w tym samym SVG,\n   nie kolorem — strażnik nie może tego mylić z hexem. */\n.grain::after {\n  content: '';\n  background-image: url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\");\n}\n",
    },
    frags: ['URL-encoded brand colour'],
  },
];

const MODULE = 'src/UI/features/x/x.module.css';
const lint = css => lintCss(rule, { [MODULE]: css }).findings;
const GOLD_12 = 'color-mix(in oklch, var(--color-primary) 12%, transparent)';

describe('css/tint-discipline', () => {
  // Every sample of the retired tests/audit/_fixtures/<old-name> (same verdict; the fragments are
  // the old .expect / .expect-not lines in this rule's wording).
  for (const sample of FIXTURES) {
    it(`fixture ${sample.sample}`, () => {
      const { findings } = lintCss(rule, sample.files);
      const text = findings.map(f => f.message).join('\n');
      if (sample.fail) {
        expect(findings.length, sample.sample).toBeGreaterThan(0);
        for (const fragment of sample.frags) {
          expect(text).toContain(fragment);
        }
      } else {
        expect(findings, sample.sample).toEqual([]);
      }
    });
  }

  it('does not count prose: a tint in a comment or in a non-surface string', () => {
    expect(lint(`/* background: ${GOLD_12}; */ .a { color: red; }`)).toEqual(
      []
    );
    expect(lint(`.a::after { content: '${GOLD_12}'; }`)).toEqual([]);
    expect(
      lint(
        `.a { background: var(--color-bg-main); /* was: background: ${GOLD_12} */ }`
      )
    ).toEqual([]);
  });

  it('checks the own declarations of a block that also nests blocks (old parser skipped it)', () => {
    expect(
      lint(`.card { background: ${GOLD_12}; &:hover { color: red; } }`)
    ).toHaveLength(1);
    expect(
      lint(
        `.card { color: red; @media (min-width: 768px) { background: ${GOLD_12}; } }`
      )
    ).toHaveLength(1);
  });

  it('accepts role tokens and a tint-allow with a reason; rejects a bare one', () => {
    expect(lint('.a { background: var(--color-mark-bg); }')).toEqual([]);
    expect(
      lint(
        `/* tint-allow: data-coded heat map */\n.a { background: ${GOLD_12}; }`
      )
    ).toEqual([]);
    expect(
      lint(`/* tint-allow: */\n.a { background: ${GOLD_12}; }`)[0].message
    ).toContain('without a reason');
  });

  it('does not let an escape leak from a sibling block', () => {
    const css = `.a { /* tint-allow: kept */ color: red; }\n.b { background: ${GOLD_12}; }`;
    expect(lint(css)).toHaveLength(1);
  });

  it('resolves a document-scope alias across files and a class alias per file only', () => {
    const files = {
      'src/UI/a.module.css': ':root { --wash: var(--color-primary); }',
      'src/UI/b.module.css':
        '.x { background: color-mix(in oklch, var(--wash) 12%, transparent); }',
    };
    expect(lintCss(rule, files).findings).toHaveLength(1);
    const scoped = {
      'src/UI/a.module.css': '.page { --wash: var(--color-primary); }',
      'src/UI/b.module.css':
        '.x { background: color-mix(in oklch, var(--wash) 12%, transparent); }',
    };
    expect(lintCss(rule, scoped).findings).toEqual([]);
  });

  it('fails the presence floor on an empty tree and names a missing anchor', () => {
    const result = lintCss(
      rule,
      { [MODULE]: '.a { color: red; }' },
      { measured: true }
    );
    expect(result.errors.join()).toContain('floor');
    expect(result.errors.join()).toContain('src/UI/styles/tokens.css');
  });
});
