#!/usr/bin/env bash
# tint-discipline.sh — strażnik motywu „Jeden krem" (głos S94, owner 2026-08-19;
# domknięcie głosami S98/A i S98/B).
#
# INTENT:
#   Owner rozstrzygnął głos kontrastu cennika na wariant C i podniósł go do
#   rangi motywu CAŁEGO produktu. Pełne reguły R1–R10 w DESIGN.md §Motyw
#   „Jeden krem"; ten skrypt egzekwuje te, które da się rozstrzygnąć
#   deterministycznie ze źródeł:
#     R1 sekcja jest PAPIEREM albo pełnym negatywem — trzeciej drogi nie ma,
#     R2 jeden krem (--color-bg-subtle) na stronę; prymitywy współdzielone
#        kremu NIE noszą (głos S98/A: krem należy do karty-intro i pasa),
#     R4 zero zebry — rytm listy i tabeli trzyma hairline + spacing,
#     R6 kontrast zostaje dla CTA (headroom),
#     R7 tint kodujący STAN (error/warning/success/info) zostaje — poza zakresem,
#     R8 rama akcentu MUSI odwracać się z trybem (--color-ink jest ciemny
#        w OBU, więc w dark rysuje ciemną linię na ciemnym tle),
#     R10 tabela musi mieć JAWNĄ decyzję o table-layout.
#
#   Przed sweepem: 380 złotych tintów tła w 173 modułach, z losowymi
#   procentami 2–40%. Trzy do siedmiu kremowych washy na stronę = dokładnie ta
#   „mdłość", którą owner odrzucił w wariancie DZIŚ.
#
# DLACZEGO SKANER JEST TAK ROZBUDOWANY:
#   Ten strażnik okazał się WĘŻSZY, niż deklarował, TRZY RAZY z rzędu:
#     1. wymagał `color-mix(in oklch, var(--color-primary) N%` — złoto na
#        pierwszej pozycji i tylko w oklch → przepuścił 34 żywe tinty;
#     2. nie widział aliasów, background-image ani solidnego złota
#        przygaszonego przez opacity (renderowo to samo co tint);
#     3. parser „linia otwiera / linia zamyka" NIE WIDZIAŁ bloków zapisanych
#        w jednej linii — to znalazł dopiero fixture, nie czytanie regexa;
#     4. adwersaryjne review (S99) zdjęło jeszcze dziewięć obejść naraz:
#        procent PRZED kolorem, relative color (`rgb(from …)`) bez color-mix,
#        neutralny token spoza szóstki powierzchni jako baza, skrót
#        `border-top` i właściwości logiczne, krem za lokalnym aliasem,
#        `min-width: 0px` jako uniwersalny wyciszacz, `inset` box-shadow
#        zalewający powierzchnię, hex w inline-style oraz obiekt stylu
#        zbudowany pod stałą (`style={colorStyle}`).
#     5. fala mutacyjna (S100) zdjęła jeszcze osiem żywych wektorów: alias
#        złota i alias KREMU zdefiniowane w INNYM pliku modułu (rozwiązywanie
#        było globalne tylko dla palety), `@property` z tintem w
#        `initial-value`, box-shadow BEZ `inset` (`0 0 0 999px` zalewa
#        wszystko dookoła elementu), `filter: opacity(.08)` zamiast
#        właściwości `opacity`, surowa funkcja koloru (`rgba(212,168,64,.12)`,
#        `oklch(… / .12)`) bez tokenu i bez hexa, bramka `color-mix`
#        odcinająca testy hexa/kremu w inline-style oraz tint w `border-image`.
#     6. trzecia runda review (S101) zdjęła trzy FAŁSZYWKI i jedno obejście:
#        globalne rozwiązywanie aliasów po samej NAZWIE zlewało moduły w jeden
#        namespace (`--eyebrow-color` neutralny w jednym module dziedziczył
#        „złoto" z dwóch innych), próg chromatyczności mierzył bezwzględny
#        rozstrzał kanałów bez oglądania jasności (`rgba(28,20,12,.45)` =
#        prawie czerń, a zgłaszana), `color()` nie było na liście funkcji
#        koloru, a rozjazd R7 między tokenem a zapisem surowym nie zostawiał
#        żadnego śladu.
#   Dlatego skan jedzie po realnie sparsowanych blokach (świadomy komentarzy
#   i stringów), rozwiązuje aliasy złota, kremu i akcentu GLOBALNIE tylko tam,
#   gdzie deklaracja faktycznie jest globalna (`:root`/`:host`/`@property`
#   w palecie, tokens.css i modułach), a aliasy scope'owane klasą — PER PLIK,
#   i liczy udział złota także wtedy, gdy jest RESZTĄ mieszania, gdy procent
#   stoi przy literale bazy, gdy schowano go w zmiennej albo gdy niesie go
#   ALFA relative color.
#   Dowód, że łapie: tests/audit/_fixtures/tint-discipline + meta-audyt
#   audit-selftest.sh (każda gałąź ma próbkę MUST-FAIL z plikiem .expect albo
#   MUST-PASS kotwiczący próg; liczb celowo NIE hardcodujemy — rotują).
#
# ESCAPE (wyjątki żyją PRZY deklaracji, nigdy w centralnej liście — ta by zgniła):
#   /* tint-allow: <powód> */        — powód OBOWIĄZKOWY (pusty = brak wyjątku)
#   /* ink-border-allow: <powód> */  — rama z atramentu na powierzchni ink
#   /* table-layout-auto: <powód> */ — tabela świadomie na auto (scroll + nowrap)
#   Powód jest obowiązkowy dla WSZYSTKICH TRZECH markerów: pusty marker to
#   wyjątek nie do zweryfikowania w review i dostaje własny komunikat.
#   Komentarz działa w ciele bloku, w jego „główce" (między poprzednią klamrą
#   a selektorem) albo w główce @media, w którym blok siedzi. NIE przecieka
#   z sąsiedniego bloku — okno liczone liniami przechodziło przez klamrę.
#
# SCOPE: main/src/UI/**/*.module.css + main/src/UI/**/*.tsx (inline style).
#   Poza: styles/ (tam MIESZKAJĄ tokeny roli — to ich definicja, nie użycie)
#   i features/dev/playground/** (warianty do głosowania z założenia łamią kanon).
#
# EXIT: 0 gdy czysto, 1 gdy znaleziono.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
UI_DIR="${ROOT}/main/src/UI"

print_boxed_header "Tint discipline: motyw „Jeden krem” (R1–R10)" "🍦"

# Pusta lista plików to NAJGORSZY możliwy stan strażnika: melduje „passed"
# i wychodzi zerem, więc literówka w ścieżce, przeniesienie katalogu albo
# zawężony filtr `find` zamieniają go w atrapę, której nikt nie zauważy —
# zieleń wygląda tak samo jak zieleń zapracowana. Dlatego zero plików do skanu
# jest błędem, a nie sukcesem.
if [[ ! -d "$UI_DIR" ]]; then
  print_error "Brak katalogu ${UI_DIR#"${ROOT}/"} — strażnik nie ma czego skanować (zieleń nad zerem plików = atrapa)"
  exit 1
fi

declare -a SCAN_FILES
mapfile -t SCAN_FILES < <(find "$UI_DIR" \( -name "*.module.css" -o -name "*.tsx" \) -type f \
  -not -path "*/dev/playground/*" | sort)

if [[ "${#SCAN_FILES[@]}" -eq 0 ]]; then
  print_error "Zero plików do skanu w ${UI_DIR#"${ROOT}/"} — strażnik raportowałby „passed” nad pustką"
  exit 1
fi

print_header "Skan ${#SCAN_FILES[@]} plików: tinty tła, krem, zebra, rama akcentu, tabele"

SCANNER="$(mktemp)"
trap 'rm -f "$SCANNER"' EXIT

cat > "$SCANNER" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');

const uiDir = process.env.UI_DIR;
const files = process.argv.slice(2);
const out = [];

// ─── 1. Zbiór tokenów ZŁOTA (z aliasami) ────────────────────────────────────
// Aliasy są PROBLEMEM, nie ciekawostką: --color-accent i --color-cta to
// w palettes.css dosłowne `var(--color-primary)`, więc tint przez nie renderuje
// się identycznie, a skan po nazwie „primary" go nie widzi.
const GOLD_SEED = [
  'color-primary',
  'color-secondary',
  'color-accent',
  'color-cta',
  'color-accent-fg',
  'color-accent-hover',
];
// Tokeny ROLI = sankcjonowane wyjścia motywu. Są wyprowadzone ze złota, więc
// bez tej listy strażnik krzyczałby na rozwiązanie, do którego sam kieruje.
const ROLE_TOKENS = new Set([
  'color-mark-bg',
  'color-mark-bg-strong',
  'color-mark-bg-on-ink',
  'color-state-selected',
  'color-state-hover',
  'color-bg-subtle',
]);

// Token kremu: jedyny sankcjonowany pas złamanej bieli, limitowany do JEDNEGO
// wystąpienia na stronę (R2).
const CREAM = 'color-bg-subtle';

const gold = new Set(GOLD_SEED);
for (const rel of ['styles/themes/palettes.css', 'styles/tokens.css']) {
  const p = path.join(uiDir || '', rel);
  let src = '';
  try {
    src = fs.readFileSync(p, 'utf8');
  } catch {
    continue; // mini-projekt fixtura nie ma palety — seed wystarcza
  }
  // Tylko DOSŁOWNE aliasy (`--x: var(--y)`), nie pochodne color-mix: te drugie
  // to właśnie tokeny roli, które mają prawo nieść złoto.
  for (let pass = 0; pass < 4; pass++) {
    const re = /--([a-z0-9-]+)\s*:\s*var\(--([a-z0-9-]+)\)\s*;/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (gold.has(m[2]) && !ROLE_TOKENS.has(m[1])) gold.add(m[1]);
    }
  }
}

// ─── 1b. Aliasy GLOBALNE po WSZYSTKICH modułach ─────────────────────────────
// Rozwiązywanie aliasów było globalne WYŁĄCZNIE dla palety i tokens.css, a poza
// nimi per-plik. To zostawiało dwa otwarte wektory, oba potwierdzone
// uruchomieniem:
//   a.module.css:  :root { --page-wash: var(--color-primary); }
//   b.module.css:  background: color-mix(…, var(--page-wash) 12%, transparent);
// oraz ten sam chwyt na KREMIE, który rozbrajał limit „jeden pas na stronę"
// w całości (alias kremu w cudzym pliku, użyty tu dwa razy).
//
// ZASIĘG jest jednak WĘŻSZY niż „wszystko, co wygląda na alias". Deklaracja
// custom property obowiązuje w PODDRZEWIE selektora, w którym stoi, a klasa
// CSS Modules jest hashowana per plik — więc `--eyebrow-color` ustawione
// w `.aboutPage` nie ma nic wspólnego z `--eyebrow-color` ustawionym
// w `.pricingPage`. Rozwiązywanie po samej NAZWIE zlewało oba w jeden
// namespace i produkowało FAŁSZYWKI: moduł, w którym `--eyebrow-color` jest
// neutralny (`var(--color-text-muted)`), dziedziczył znaczenie „złoto"
// z dwóch cudzych modułów. Kolizja siedzi w żywym drzewie (trzy moduły, dwa
// z aliasem złota) i nie strzela dziś tylko dlatego, że nikt nie użył tej
// zmiennej w `background`. Ta sama mechanika na KREMIE dawała fałszywe
// „DRUGI krem w module (R2)".
// Dlatego globalnie rozwiązujemy WYŁĄCZNIE deklaracje o zasięgu dokumentu:
// `:root` / `:host` (tam kaskada faktycznie nie zna granic plików) oraz
// `@property` (rejestracja jest globalna z definicji). Alias zadeklarowany
// w klasie rozwiązuje się PER PLIK — robi to localGold/localCream w sekcji 5.
// Trzy przebiegi: alias potrafi wskazywać alias zdefiniowany w pliku, który
// stoi dalej w kolejności skanu.
const globalCream = new Set();
const globalAliases = [];
for (const f of files) {
  if (!f.endsWith('.module.css')) continue;
  let src = '';
  try {
    src = fs.readFileSync(f, 'utf8');
  } catch {
    continue; // plik zniknął w trakcie skanu — nie ma czego rozwiązywać
  }
  for (const b of parseBlocks(src)) {
    if (!isDocumentScoped(b.head)) continue;
    for (const d of varDecls(b)) {
      const direct = d.value.trim().match(/^var\(\s*--([a-z0-9-]+)\s*\)$/);
      if (direct) globalAliases.push({ name: d.name, target: direct[1] });
    }
  }
}
for (let pass = 0; pass < 3; pass++) {
  for (const { name, target } of globalAliases) {
    if (ROLE_TOKENS.has(name)) continue;
    if (target === CREAM || globalCream.has(target)) globalCream.add(name);
    else if (gold.has(target)) gold.add(name);
  }
}

// ─── 2. Parser bloków (świadomy komentarzy i stringów) ──────────────────────
// Kluczowe wobec poprzedniej wersji: blok zapisany w JEDNEJ linii jest tu
// normalnym blokiem, a nie niewidzialnym bytem.
function parseBlocks(text) {
  const blocks = [];
  const stack = [];
  let i = 0;
  let headStart = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '{') {
      stack.push({ head: text.slice(headStart, i), headStart, bodyStart: i + 1 });
      headStart = i + 1;
      i++;
      continue;
    }
    if (c === '}') {
      const b = stack.pop();
      if (b) {
        b.bodyEnd = i;
        b.body = text.slice(b.bodyStart, i);
        b.ancestors = stack.slice();
        b.isLeaf = !/\{/.test(stripStringsAndComments(b.body));
        blocks.push(b);
      }
      headStart = i + 1;
      i++;
      continue;
    }
    if (c === ';' && stack.length === 0) {
      headStart = i + 1;
    }
    i++;
  }
  return blocks;
}

// Maskowanie komentarzy w TSX: znaki komentarza zamieniamy na SPACJE, a nie
// wycinamy, więc indeksy i numery linii zostają te same. Bez tego zakomentowany
// (albo opisany w komentarzu) `style={{ … }}` liczył się jako żywy kod.
function maskComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i++) out += text[i] === '\n' ? '\n' : ' ';
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') {
          out += text[i];
          i++;
          if (i < n) {
            out += text[i];
            i++;
          }
          continue;
        }
        out += text[i];
        i++;
      }
      if (i < n) {
        out += text[i];
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ');
}
function stripStringsAndComments(s) {
  return stripComments(s).replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
}
function commentsOf(s) {
  // Delimitery WYCINAMY: bez tego `/* tint-allow: */` przechodzi jako wyjątek
  // „z powodem", bo `*/` jest niepustym ciągiem znaków. Escape bez powodu to
  // wyjątek nie do zweryfikowania w review, czyli dokładnie to, przed czym
  // marker ma chronić.
  return (s.match(/\/\*[\s\S]*?\*\//g) || [])
    .map(c => c.slice(2, -2))
    .join('\n');
}
function lineOf(text, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

// ─── 3. Deklaracje ──────────────────────────────────────────────────────────
function declarations(body) {
  const clean = stripComments(body);
  const decls = [];
  let depth = 0;
  let buf = '';
  for (const ch of clean) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) {
      decls.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  decls.push(buf);
  return decls
    .map(d => {
      const idx = d.indexOf(':');
      if (idx === -1) return null;
      return { prop: d.slice(0, idx).trim().toLowerCase(), value: d.slice(idx + 1).trim() };
    })
    .filter(d => d && d.prop && !d.prop.includes('{'));
}

// Deklaracja zmiennej to nie tylko `--x: …` w ciele reguły. `@property --x`
// rejestruje zmienną NAZWĄ W GŁÓWCE, a wartość niesie `initial-value`, więc
// test „prop zaczyna się od --" jej nie widział i cała drabina kremu zapisana
// przez @property przechodziła bezgłośnie.
function varDecls(b) {
  const pairs = [];
  const propHead = stripComments(b.head).match(/@property\s+--([a-z0-9-]+)/);
  const decls = declarations(b.body);
  if (propHead) {
    const iv = decls.find(d => d.prop === 'initial-value');
    if (iv) pairs.push({ name: propHead[1], value: iv.value });
  }
  for (const d of decls) {
    if (d.prop.startsWith('--')) pairs.push({ name: d.prop.slice(2), value: d.value });
  }
  return pairs;
}

// Zasięg DOKUMENTU: `:root`/`:host` (kaskada nie zna granic plików) oraz
// `@property` (rejestracja jest globalna z definicji). Wszystko inne to
// selektor scope'owany — w CSS Modules hashowany per plik.
function isDocumentScoped(head) {
  const h = stripComments(head).replace(/\s+/g, ' ').trim();
  return /(^|,)\s*(:root|:host)\b/.test(h) || /@property\s+--[a-z0-9-]+/.test(h);
}

// ─── 4. Udział złota w wartości ─────────────────────────────────────────────
// Zapisy tego samego tintu, z których pierwsza wersja widziała JEDEN:
//   var(--gold) 12%                       — procent wprost,
//   12% var(--gold)                       — procent PRZED kolorem (CSS Color 5
//                                           nie narzuca kolejności),
//   var(--gold) var(--mix, 18%)           — procent schowany w zmiennej,
//   var(--gold) .12e2%                    — procent w notacji wykładniczej,
//   color-mix(..., var(--paper) 92%, var(--gold))  — złoto jako RESZTA,
//   rgb(from var(--gold) r g b / .08)     — relative color, BEZ color-mix.
const NUM = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?';
const HEX_LITERAL = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
// Baza mieszania zapisana LITERAŁEM, nie tokenem. Trzeba ją widzieć razem
// z jej procentem: `color-mix(in oklch, transparent 88%, var(--color-primary))`
// to 12% złota, a skan zbierający procenty wyłącznie przy `var(--x)` liczył
// to jako złoto PEŁNE (100%) i wypuszczał bez śladu.
const BASE_LITERAL = /\btransparent\b|\bwhite\b|\bblack\b|#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const PCT_AFTER_LITERAL = new RegExp(`^\\s*(${NUM})%`);
const PCT_AFTER = new RegExp(`^[^,)]*\\)\\s*(${NUM})%`);
const PCT_BEFORE = new RegExp(`[,(]\\s*(${NUM})%\\s*$`);
const REL_COLOR = new RegExp(
  `\\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\\(\\s*from\\s+var\\(\\s*--([a-z0-9-]+)\\s*\\)([^()]*)\\)`,
  'g'
);
const REL_ALPHA = new RegExp(`\\/\\s*(${NUM})(%?)\\s*$`);

// AKCENT to domknięta LISTA, a wszystko poza nią jest bazą mieszania.
// Poprzednia wersja pytała odwrotnie („czy baza pasuje do
// color-(bg|surface|paper|elevated|ink|on-ink)"), więc KAŻDY inny neutralny
// token był furtką: `color-mix(in oklch, var(--color-border) 92%,
// var(--color-primary))` uchodziło za „mieszaninę dwóch akcentów" i wychodziło
// ze skanu bez śladu, choć renderuje 8% złota. Mieszanina dwóch AKCENTÓW nadal
// zostaje poza zakresem (to pełnokolorowy odcień roli, nie wash pod treścią),
// ale akcent trzeba teraz NAZWAĆ — nienazwany kolor danych ma escape.
function isAccentToken(token, isGold, localAccent) {
  if (isGold(token) || (localAccent && localAccent.has(token))) return true;
  if (/^color-text-/.test(token)) return false;
  return /(^|-)(accent|primary|secondary|cta|brand|hue|error|warning|danger|success|info|mark)(-|$)/.test(
    token
  );
}

// Relative color (`rgb(from var(--gold) r g b / .08)`) renderuje się identycznie
// jak tint, a nie ma w sobie ani color-mix, ani procentu przy tokenie — udział
// niesie ALFA. Bez tej gałęzi share wychodził 100 i próg nigdy nie strzelał.
function relativeShare(value, isGold) {
  REL_COLOR.lastIndex = 0;
  let m;
  while ((m = REL_COLOR.exec(value)) !== null) {
    const name = m[1];
    if (!isGold(name) || ROLE_TOKENS.has(name)) continue;
    const alpha = m[2].match(REL_ALPHA);
    if (!alpha) return { token: name, share: 100 };
    const raw = Number(alpha[1]);
    return { token: name, share: alpha[2] === '%' ? raw : raw * 100 };
  }
  return null;
}

function goldShare(value, localGold, localAccent) {
  const isGold = name => gold.has(name) || localGold.has(name);
  const rel = relativeShare(value, isGold);
  if (rel) return rel;
  const re = /var\(\s*--([a-z0-9-]+)/g;
  let m;
  const others = [];
  // Bazą jest biel, czerń, przezroczystość i hex NEUTRALNY. Hex CHROMATYCZNY to
  // drugi akcent (tak wygląda `--client-rose: #e16a8c`), więc mieszanina z nim
  // nie jest washem powierzchni. Procent stojący PRZY takiej bazie trafia do
  // `others` — inaczej złoto-reszta wychodziło ze skanu jako pełny kolor.
  let surfaceBase = false;
  BASE_LITERAL.lastIndex = 0;
  let bm;
  while ((bm = BASE_LITERAL.exec(value)) !== null) {
    const lit = bm[0];
    if (lit[0] === '#' && chromatic(expandHex(lit.slice(1)))) continue;
    surfaceBase = true;
    const pctAfter = value.slice(bm.index + lit.length).match(PCT_AFTER_LITERAL);
    const pctBefore = value.slice(0, bm.index).match(PCT_BEFORE);
    const pct = pctAfter || pctBefore;
    if (pct) others.push(Number(pct[1]));
  }
  let hit = null;
  while ((m = re.exec(value)) !== null) {
    const name = m[1];
    const after = value.slice(m.index + m[0].length);
    const before = value.slice(0, m.index);
    const pct = after.match(PCT_AFTER) || before.match(PCT_BEFORE);
    const pctVar = after.match(/^[^,)]*\)\s*var\(/);
    if (isGold(name) && !ROLE_TOKENS.has(name)) {
      if (hit === null) {
        if (pct) hit = { token: name, share: Number(pct[1]) };
        else if (pctVar) hit = { token: name, share: 'zmienna' };
        else hit = { token: name, share: null };
      }
    } else {
      if (!isAccentToken(name, isGold, localAccent)) surfaceBase = true;
      if (pct) others.push(Number(pct[1]));
    }
  }
  if (hit === null) return null;
  if (hit.share === null) {
    // Złoto bez procentu: w color-mix jest resztą, poza nim = pełny kolor.
    if (/color-mix\(/.test(value) && others.length && surfaceBase) {
      hit.share = Math.max(0, 100 - Math.max(...others));
    } else if (/color-mix\(/.test(value) && others.length) {
      return null; // mieszanina dwóch NAZWANYCH akcentów, nie tint powierzchni
    } else {
      hit.share = 100;
    }
  }
  return hit;
}

const BG_PROPS = new Set(['background', 'background-color', 'background-image']);
// border-image (i jego longhand) maluje POWIERZCHNIĘ ramy, nie linię — tint
// wpuszczony tędy renderuje się jak każdy inny wash, a lista właściwości
// powierzchni go nie obejmowała.
const SURFACE_PROPS = new Set([
  ...BG_PROPS,
  'stroke',
  'fill',
  'border-image',
  'border-image-source',
]);
// Rama akcentu bywa zapisana skrótem (`border-top: 2px solid …`) albo
// właściwością logiczną (`border-inline-start`), a to najczęstszy REALNY zapis
// jednostronnego paska. Lista samych `*-color` widziała tylko zapis rozbity.
const BORDER_PROP =
  /^(border|border-color|border-(top|right|bottom|left)(-color)?|border-(inline|block)(-(start|end))?(-color)?|outline|outline-color)$/;

// box-shadow nie jest tłem, ale duże rozlanie albo rozmycie zalewa CAŁĄ
// powierzchnię — renderowo to ten sam wash co background. `0 0 0 1px` zostaje
// obrysem (hairline ring), więc próg stoi na 20px: poniżej rysujemy linię,
// powyżej malujemy płaszczyznę.
// Wymóg `inset` ZDJĘTY: cień BEZ inset maluje na zewnątrz, więc
// `0 0 0 999px color-mix(…12%…)` zalewa wszystko DOOKOŁA elementu — ten sam
// wash, tylko po drugiej stronie krawędzi. Warunek `\binset\b` przepuszczał
// go w całości.
function isWashShadow(prop, value) {
  if (prop !== 'box-shadow') return false;
  return (value.match(/-?\d*\.?\d+px/g) || []).some(l => Math.abs(parseFloat(l)) >= 20);
}

// ─── 4b. Tint zapisany SUROWĄ funkcją koloru ────────────────────────────────
// `rgba(212,168,64,0.12)` i `oklch(0.82 0.12 88 / 0.12)` renderują dokładnie
// ten sam wash co color-mix, a nie mają w sobie ani tokenu, ani hexa — więc
// wypadały ze skanu w całości (hex-policy też ich nie widzi: nie ma znaku „#").
// Liczy się KOMBINACJA dwóch cech, bo dopiero ona opisuje wash:
//   · kolor CHROMATYCZNY — biel, czerń i szarość to legalne przyciemnienie
//     overlaya (żyje w AppDrawer, AdminLayout, AppDialog), nie kolor marki;
//   · alfa <= 45% — ten sam próg, co udział złota w mieszaninie.
// Pełny, nieprzezroczysty kolor surowy to INNA klasa (ucieczka z systemu
// tokenów, nie wash pod treścią) i nie należy do tego strażnika.
//
// `color()` MUSI tu być: `color(srgb 0.88 0.70 0.25 / 0.12)` renderuje ten sam
// wash co `rgb(224 179 65 / 0.12)`, a lista funkcji jej nie znała — mimo że
// sąsiedni REL_COLOR (relative color) już ją wymieniał. Zapis z pominiętą
// pozycją w liście funkcji to najtańsze obejście, jakie istnieje.
const RAW_COLOR = /\b(rgba?|hsla?|oklch|oklab|lch|lab|color)\(\s*(?!from\b)([^()]*)\)/g;

function parseAlpha(raw) {
  const t = String(raw).trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(t)) return null;
  return t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
}

// Nasycenie liczone WZGLĘDNIE, nie jako rozstrzał surowych kanałów.
// Próg „max-min > 12" nie oglądał jasności, więc zgłaszał `rgba(28, 20, 12,
// .45)` — praktycznie czerń, dokładnie ten „legalny overlay", który komentarz
// wyżej obiecuje przepuścić — a wpuszczał kolory o tym samym rozstrzale przy
// innej jasności. Chroma OKLCH jest miarą percepcyjną: dla czerni i bieli
// dąży do zera niezależnie od tego, jak rozjechane są kanały sRGB.
// JEDNA liczba dla jednej cechy: ten sam próg obowiązuje rgb, hsl, color(),
// oklch i oklab, więc nie ma dwóch konkurencyjnych definicji „koloru".
// Kalibracja NIE jest na włos: złoto marki ma w tej palecie chromę ~0.13,
// kolory stanu 0.15–0.18, a neutralne przyciemnienia overlaya <= 0.023
// (`rgba(28,20,12)` = 0.020, `hsl(30 40% 8%)` = 0.020, kremowa biel
// `rgba(250,244,238)` = 0.010). Próg 0.04 leży w szerokiej pustce między
// tymi dwiema grupami, a nie na granicy któregoś z nich.
const CHROMA_FLOOR = 0.04;
// CIE Lab/LCH operuja w innej skali niz OKLab: jedna jednostka OKLab to okolo
// 345 jednostek CIE. Stala byla UZYWANA w galezi lab()/lch(), ale nigdy nie
// powstala, wiec kazde trafienie na te notacje wywracalo skaner ReferenceError-em
// zamiast zglosic regule (a `set -euo pipefail` zamienialo to w twardy blad
// audytu, nie w cicha zielen — to jedyny powod, dla ktorego nie przeszlo bokiem).
const LAB_CHROMA_FLOOR = CHROMA_FLOOR * 345;
// Lab i LCH mierzą chromę w jednostkach CIE (~0–130), nie OKLab. Przelicznik
// bierzemy z tej samej palety: złoto ma OKLCH C ~0.13 i Lab C ~45, czyli
// jedna jednostka OKLab to ~345 jednostek CIE. Bez przeliczenia obie gałęzie
// zostałyby przy progu „2", czyli równowartości OKLab 0.006 — ta sama
// fałszywka na prawie-czerni, tylko w trzeciej notacji.
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
// r,g,b w zakresie 0–1.
function oklchChroma(r, g, b) {
  return oklchChromaLinear(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
}
function oklchChromaLinear(R, G, B) {
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.sqrt(A * A + Bb * Bb);
}
// HSL → sRGB (0–1). Bez tego `hsl(30 40% 8%)` (ta sama prawie-czerń, inaczej
// zapisana) wpadał w próg „saturacja > 5%", bo saturacja HSL rośnie przy
// zerowej jasności — ta sama fałszywka, tylko w drugiej notacji.
function hslToRgb(h, sPct, lPct) {
  const S = sPct / 100;
  const L = lPct / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = L - c / 2;
  const t = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(hp) % 6];
  return [t[0] + m, t[1] + m, t[2] + m];
}

function rawChromatic(fn, parts) {
  const num = s => {
    const t = String(s).trim();
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(t)) return null;
    return { v: parseFloat(t), pct: t.endsWith('%') };
  };
  if (fn === 'rgb' || fn === 'rgba') {
    const c = parts.slice(0, 3).map(num);
    if (c.length < 3 || c.some(x => x === null)) return false;
    const v = c.map(x => (x.pct ? x.v / 100 : x.v / 255));
    return oklchChroma(v[0], v[1], v[2]) > CHROMA_FLOOR;
  }
  if (fn === 'hsl' || fn === 'hsla') {
    const h = num(parts[0]);
    const s = num(parts[1]);
    const l = num(parts[2]);
    if (h === null || s === null || l === null) return false;
    const rgb = hslToRgb(h.v, s.v, l.v);
    return oklchChroma(rgb[0], rgb[1], rgb[2]) > CHROMA_FLOOR;
  }
  if (fn === 'color') {
    // Pierwszy człon to PRZESTRZEŃ, nie kanał. Przestrzenie rgb-podobne mają
    // kanały 0–1, więc rozstrzał porównujemy w tej samej skali co chromę;
    // xyz mierzy się względem bieli D65/D50 i bez normalizacji sama biel
    // wyglądałaby na rozjechany kolor.
    const space = String(parts[0] || '').trim().toLowerCase();
    const c = parts.slice(1, 4).map(num);
    if (c.length < 3 || c.some(x => x === null)) return false;
    let v = c.map(x => (x.pct ? x.v / 100 : x.v));
    if (space.startsWith('xyz')) {
      const wp = space === 'xyz-d50' ? [0.9642, 1, 0.8249] : [0.9505, 1, 1.089];
      v = v.map((x, i) => x / wp[i]);
      return Math.max(...v) - Math.min(...v) > 0.05;
    }
    if (!/^(srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020)$/.test(space)) return false;
    // `srgb-linear` niesie kanały JUŻ zlinearyzowane — puszczenie ich drugi raz
    // przez transfer function zaniżałoby chromę.
    const chroma =
      space === 'srgb-linear'
        ? oklchChromaLinear(v[0], v[1], v[2])
        : oklchChroma(v[0], v[1], v[2]);
    return chroma > CHROMA_FLOOR;
  }
  if (fn === 'oklch') {
    const c = num(parts[1]);
    return c !== null && Math.abs(c.pct ? c.v * 0.004 : c.v) > CHROMA_FLOOR;
  }
  // Chroma to DŁUGOŚĆ wektora (a, b), nie większa z jego składowych: test
  // „|a| > próg LUB |b| > próg" zaniżał kolor leżący po skosie i zawyżał
  // kolor leżący wzdłuż osi.
  // Procenty i tu maja wlasna skale: 100% osi a/b w `oklab()` to 0,4 (jak 100%
  // C w `oklch()`). Bez przeliczenia surowe „1" z zapisu `1%` szlo na prog 0,04
  // i neutralny `oklab(50% 1% 1%)` leciał jako tint, choc jego realna chroma to
  // 0,0057. Siostrzana galaz `oklch` skalowala od poczatku — ta nie.
  if (fn === 'oklab') {
    const axis = (x) => (x === null ? null : x.pct ? x.v * 0.004 : x.v);
    const a = axis(num(parts[1]));
    const b = axis(num(parts[2]));
    if (a === null || b === null) return false;
    return Math.hypot(a, b) > CHROMA_FLOOR;
  }
  // Notacja procentowa ma w CIE INNA skale niz liczbowa: 100% osi a/b w `lab()`
  // to 125 jednostek, a 100% C w `lch()` to 150. Bez przeliczenia skaner
  // porownywal surowe „8" z progiem 13,8 i przepuszczal tint, ktory realnie
  // ma chrome 14,14. Siostrzana galaz `oklch` skalowala procenty od poczatku.
  const labAxis = (x) => (x === null ? null : x.pct ? x.v * 1.25 : x.v);
  const lchChroma = (x) => (x === null ? null : x.pct ? x.v * 1.5 : x.v);
  if (fn === 'lch') {
    const c = lchChroma(num(parts[1]));
    return c !== null && Math.abs(c) > LAB_CHROMA_FLOOR;
  }
  if (fn === 'lab') {
    const a = labAxis(num(parts[1]));
    const b = labAxis(num(parts[2]));
    if (a === null || b === null) return false;
    return Math.hypot(a, b) > LAB_CHROMA_FLOOR;
  }
  return false;
}

// DECISION (nie usuwaj tego komentarza):
// R7 („tint kodujący STAN zostaje — poza zakresem") działa WYŁĄCZNIE na
// nazwach: wyłącza mieszaniny z var(--color-error|warning|success|info) przez
// isAccentToken. Zapis SUROWY nazw nie ma, więc `rgba(192, 57, 43, 0.10)` jest
// zgłaszany, a równoważne `color-mix(…, var(--color-error) 10%, transparent)`
// przechodzi. To NIE jest przeoczenie i nie domykamy tego zgadywaniem odcienia:
// R7 istnieje dlatego, że TOKEN niesie znaczenie („to jest błąd"), a trójka
// liczb nie niesie żadnego — jest zwykłą ucieczką z systemu tokenów i przy
// zmianie palety nie pojedzie razem z nią. Rozjazd jest więc świadomy, a jego
// ślad stoi w KOMUNIKACIE audytu („R7 nie zwalnia zapisu surowego").
// Próbka kotwicząca decyzję: _fixtures/tint-discipline/must-fail/raw-status-red.
function rawColorTint(value) {
  RAW_COLOR.lastIndex = 0;
  let m;
  while ((m = RAW_COLOR.exec(value)) !== null) {
    const fn = m[1];
    const slash = m[2].split('/');
    let alpha = null;
    let parts = m[2].trim().split(/[\s,]+/).filter(Boolean);
    if (slash.length === 2) {
      alpha = parseAlpha(slash[1]);
      parts = slash[0].trim().split(/[\s,]+/).filter(Boolean);
    } else if (parts.length === 4) {
      alpha = parseAlpha(parts[3]);
      parts = parts.slice(0, 3);
    }
    if (alpha === null || !(alpha > 0) || alpha > 0.45) continue;
    if (!rawChromatic(fn, parts)) continue;
    return { fn: m[0], alpha };
  }
  return null;
}

// `filter: opacity(.08)` renderuje się PIKSEL W PIKSEL jak właściwość
// `opacity`, a skan pytający o nazwę właściwości go nie widział.
function opacityOf(decls) {
  const direct = decls.find(d => d.prop === 'opacity');
  if (direct) return { shown: direct.value.trim(), value: Number(direct.value) };
  const filt = decls.find(d => d.prop === 'filter');
  if (filt) {
    const m = filt.value.match(/(?:^|[\s(])opacity\(\s*(\d*\.?\d+)(%?)\s*\)/);
    if (m) return { shown: m[1] + m[2], value: m[2] === '%' ? Number(m[1]) / 100 : Number(m[1]) };
  }
  return null;
}

// Powód musi stać w TEJ SAMEJ LINII co marker: `\s*` przeskakuje nowe linie,
// więc pusty escape „pożyczał" sobie pierwsze słowo z następnego komentarza
// i wyglądał na uzasadniony.
const ALLOW_TINT = /tint-allow:[ \t]*\S/;
const ALLOW_INK = /ink-border-allow:[ \t]*\S/;
const ALLOW_TABLE = /table-layout-auto:[ \t]*\S/;
// Wszystkie TRZY markery mają ten sam kontrakt: powód jest OBOWIĄZKOWY.
// Wcześniej tylko `tint-allow` meldował pusty escape jawnym komunikatem,
// a pozostałe dwa cicho spadały do zwykłego naruszenia R8/R10 — czyli nikt
// nie dowiadywał się, że próbował się zwolnić i nie napisał z czego.
const BARE_MARKERS = [
  { bare: /tint-allow:/, full: ALLOW_TINT, name: 'tint-allow' },
  { bare: /ink-border-allow:/, full: ALLOW_INK, name: 'ink-border-allow' },
  { bare: /table-layout-auto:/, full: ALLOW_TABLE, name: 'table-layout-auto' },
];
const ZEBRA_SEL = /:nth-(?:child|of-type|last-child|last-of-type)\(\s*(?:even|odd|\d*n)/;
// Hex zakodowany URL-owo w data-URI omija hex-policy (w pliku nie ma znaku „#").
// Skanujemy tylko hexy CHROMATYCZNE: biel/czerń/szarość w SVG jako
// background-image to konieczność strukturalna (SVG w tle nie czyta zmiennych
// CSS ani currentColor), a kolor MARKI schowany w data-URI to ucieczka
// z systemu tokenów — tak przeżyła złota siatka kropek w layoucie admina.
const URL_HEX = /%23([0-9a-fA-F]{6})\b/;
function chromatic(hex) {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) > 12;
}
function expandHex(h) {
  return h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
}
// Inicjalizator stałej: od znaku `=` do średnika na zerowej głębokości nawiasów.
// Tyle wystarcza, żeby zobaczyć obiekt stylu zbudowany poza JSX-em.
function initializerOf(text, name) {
  const decl = new RegExp(`(?:const|let|var)\\s+${name}\\b[^=;]*=`);
  const m = decl.exec(text);
  if (!m) return '';
  let i = m.index + m[0].length;
  const start = i;
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) break;
      depth--;
    } else if (c === ';' && depth === 0) break;
  }
  return text.slice(start, i);
}

// ─── 5. Skan ────────────────────────────────────────────────────────────────
const creamPerFile = new Map();

for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  const rel = file;

  if (file.endsWith('.tsx')) {
    text = maskComments(text);
    // Inline style w TSX = klasa CAŁKOWICIE ślepa na skan CSS. Tak przeżyła
    // złota drabina 8/12/16% cyklowana `index % 3` w detalu sesji: trzy reguły
    // motywu złamane naraz, w miejscu, którego skan modułów nie widzi.
    //
    // Detektor szukający literału `style={{` widział jednak TYLKO obiekt wpisany
    // wprost w JSX. `style={colorStyle}`, gdzie obiekt powstał linijkę wyżej pod
    // stałą, przechodził bez śladu, a to najczęstszy zapis w komponencie, który
    // składa styl warunkowo. Dlatego identyfikator RESOLVUJEMY do inicjalizatora
    // i skanujemy jego treść.
    const re = /style=\{/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const openIdx = m.index + 'style={'.length;
      let obj = '';
      let shape = 'style={{…}}';
      if (text[openIdx] === '{') {
        let depth = 0;
        let i = openIdx;
        for (; i < text.length; i++) {
          if (text[i] === '{') depth++;
          else if (text[i] === '}') {
            depth--;
            if (depth === 0) break;
          }
        }
        obj = text.slice(openIdx, i + 1);
      } else {
        const id = text.slice(openIdx).match(/^\s*([A-Za-z_$][\w$]*)/);
        if (!id) continue;
        obj = initializerOf(text, id[1]);
        shape = `style={${id[1]}}`;
      }
      if (!obj) continue;
      // Bramka `color-mix` stała PRZED wszystkimi testami, więc odcinała
      // hex, hex URL-owy, krem i surową funkcję koloru — czyli dokładnie te
      // zapisy, które NIE mają w sobie color-mix i po to je tu wpisano.
      // Zostaje wyłącznie tam, gdzie ma sens: token złota BEZ mieszania to
      // pełny kolor marki (R1 go dopuszcza), nie wash pod treścią.
      const isMix = /color-mix\(/.test(obj);
      const hasGold = isMix && [...gold].some(g => obj.includes(`--${g}`));
      const hasCream = obj.includes(`--${CREAM}`);
      // Hex w inline-style omija WSZYSTKO: hex-policy skanuje wyłącznie
      // *.module.css, a `hasGold` pytał o token `--…`, którego tu nie ma.
      const hasHex = (obj.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) || []).some(h =>
        chromatic(expandHex(h.slice(1)))
      );
      const hasUrlHex = (obj.match(/%23([0-9a-fA-F]{6})\b/g) || []).some(h => chromatic(h.slice(3)));
      const hasRawColor = rawColorTint(obj) !== null;
      if (hasGold || hasCream || hasHex || hasUrlHex || hasRawColor) {
        out.push(
          `${rel}:${lineOf(text, m.index)}  [${shape}]  tint w INLINE STYLE — skan CSS jest na to ślepy`
        );
      }
    }
    continue;
  }

  const blocks = parseBlocks(text);
  const localGold = new Set();
  const localCream = new Set();
  const localAccent = new Set();
  const localTints = new Set();
  // Alias lokalny wskazujący złoto, alias lokalny wskazujący KREM oraz WŁASNA
  // drabina kremu modułu (--cream-1/2/3 i pochodne): tint schowany za zmienną
  // strony, którego skan po `background` nie widzi. Tak /for-clients doniosła
  // cztery kremowe bandy. Aliasu kremu (`--band: var(--color-bg-subtle)`) nie
  // śledził wcześniej NIKT, a R2 wymagała literalnego var(--color-bg-subtle),
  // więc jedno przemianowanie rozbrajało limit „jeden pas na stronę".
  // Trzy przebiegi, bo alias potrafi stać w pliku PRZED tym, co aliasuje.
  // Zbiera je varDecls (sekcja 3) — ten sam parser, którego używa rozwiązywanie
  // globalne, więc @property i `--x: …` liczą się tu identycznie.
  for (let pass = 0; pass < 3; pass++) {
    for (const b of blocks) {
      for (const d of varDecls(b)) {
        const name = d.name;
        const direct = d.value.match(/^var\(\s*--([a-z0-9-]+)\s*\)$/);
        if (direct && (direct[1] === CREAM || globalCream.has(direct[1]) || localCream.has(direct[1]))) {
          localCream.add(name);
          continue;
        }
        if (direct && (gold.has(direct[1]) || localGold.has(direct[1]))) {
          localGold.add(name);
          localAccent.add(name);
          continue;
        }
        // Token, którego wartością jest goły kolor CHROMATYCZNY, jest akcentem
        // strony (np. `--client-rose: #e16a8c`), nie powierzchnią. Bez tego
        // odwrócony test bazy uznawał go za papier i zgłaszał mieszaninę dwóch
        // akcentów jako 45-procentowy tint.
        const bare = d.value.trim().match(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
        if (bare && chromatic(expandHex(bare[0].slice(1)))) {
          localAccent.add(name);
          continue;
        }
        if (direct && isAccentToken(direct[1], n => gold.has(n) || localGold.has(n), localAccent)) {
          localAccent.add(name);
          continue;
        }
        if (/color-mix\(/.test(d.value)) {
          const g = goldShare(d.value, localGold, localAccent);
          if (g && typeof g.share === 'number' && g.share <= 45) localTints.add(name);
        }
        if (rawColorTint(d.value)) localTints.add(name);
      }
    }
  }
  const creamRe = new RegExp(
    `var\\(\\s*--(?:${[CREAM, ...globalCream, ...localCream].join('|')})\\s*\\)`
  );

  for (const b of blocks) {
    if (!b.isLeaf) continue;
    const selector = stripComments(b.head).replace(/\s+/g, ' ').trim();
    const selChain = [
      ...b.ancestors.map(a => stripComments(a.head).replace(/\s+/g, ' ').trim()),
      selector,
    ].join(' ');
    const scope =
      commentsOf(b.body) +
      '\n' +
      commentsOf(b.head) +
      '\n' +
      b.ancestors.map(a => commentsOf(a.head)).join('\n');
    const line = lineOf(text, b.headStart);
    const label = selector || '?';

    const bareMarker = BARE_MARKERS.find(mk => mk.bare.test(scope) && !mk.full.test(scope));
    if (bareMarker) {
      out.push(
        `${rel}:${line}  [${label}]  ${bareMarker.name} BEZ POWODU — wyjątek nie do zweryfikowania w review`
      );
      continue;
    }
    const allowed = ALLOW_TINT.test(scope);
    const decls = declarations(b.body);
    const opacity = opacityOf(decls);
    // Tylko CZĘŚCIOWA przezroczystość. `opacity: 0` to element UKRYTY w stanie
    // bazowym (wskaźnik aktywnej zakładki, który animuje się do 1) — jego
    // widoczny stan opisuje inna reguła i to ona podlega ocenie.
    const opacityValue = opacity ? opacity.value : NaN;
    const opacityLow = opacityValue > 0 && opacityValue < 0.9;

    // Element wielkości LINII albo GLIFU nie jest powierzchnią: motyw celuje
    // w tint POD TREŚCIĄ (sekcja, karta, panel, wiersz), a nie w 2-pikselowy
    // konektor kroków czy kropkę. Ta sama granica, którą DESIGN.md opisuje
    // przy tokenach ZNAKU („element wielkości glifu, nie tło treści").
    // `0px` i `min-width` NIE tłumią: `min-width: 0` to idiom flexboxa obecny
    // w co drugim module, więc dopuszczony jako wyciszacz stawał się
    // uniwersalnym wyłącznikiem strażnika. Liczy się JAWNY rozmiar 1–6px.
    const tinySize = decls.some(
      d => /^(height|width)$/.test(d.prop) && /^([1-6])px$/.test(d.value.trim())
    );

    let flagged = false;
    for (const d of decls) {
      const urlHex = d.value.match(URL_HEX);
      if (urlHex && chromatic(urlHex[1])) {
        out.push(
          `${rel}:${line}  [${label}]  kolor marki zakodowany URL-owo (${urlHex[0]}) — omija także hex-policy`
        );
        flagged = true;
        break;
      }
      if (!SURFACE_PROPS.has(d.prop) && !isWashShadow(d.prop, d.value)) continue;

      if (!allowed && !tinySize) {
        const g = goldShare(d.value, localGold, localAccent);
        if (g && (g.share === 'zmienna' || g.share <= 45)) {
          if (BG_PROPS.has(d.prop) || g.share !== 100) {
            out.push(
              `${rel}:${line}  [${label}]  tint tła (${g.token} ${g.share}${g.share === 'zmienna' ? '' : '%'}) bez tokenu roli`
            );
            flagged = true;
            break;
          }
        }
        if (g && g.share === 100 && opacityLow && BG_PROPS.has(d.prop)) {
          out.push(
            `${rel}:${line}  [${label}]  solidne złoto + opacity ${opacity.shown} = ten sam wash co tint`
          );
          flagged = true;
          break;
        }
        const raw = rawColorTint(d.value);
        if (raw) {
          out.push(
            `${rel}:${line}  [${label}]  surowa funkcja koloru z alfą ${raw.alpha} (${raw.fn}) — tint poza systemem tokenów; R7 (stan) NIE zwalnia zapisu surowego, użyj tokenu`
          );
          flagged = true;
          break;
        }
        const localHit = [...localTints].find(nm => new RegExp(`var\\(\\s*--${nm}\\s*\\)`).test(d.value));
        if (localHit) {
          out.push(
            `${rel}:${line}  [${label}]  tint przez lokalną zmienną --${localHit} (własna drabina kremu, R2)`
          );
          flagged = true;
          break;
        }
      }

      // R2 — krem. Prymitywy współdzielone go NIE noszą (głos S98/A).
      if (creamRe.test(d.value) && !allowed) {
        // WYŁĄCZNIE katalog prymitywów współdzielonych (main/src/UI/components),
        // nie dowolny „components" w drzewie feature'a — UserDetailsDialog leży
        // w features/admin/components i jest częścią JEDNEJ strony, nie
        // prymitywem montowanym na każdym ekranie.
        const isComponent = /\/UI\/components\//.test(rel);
        const base = path.basename(rel);
        if (isComponent && base !== 'Section.module.css' && base !== 'AppHero.module.css') {
          out.push(
            `${rel}:${line}  [${label}]  krem w prymitywie współdzielonym — mnoży się przez każdy ekran (R2, głos S98/A)`
          );
          flagged = true;
          break;
        }
        if (!isComponent) {
          const key = selector.replace(/:root\[data-mode='dark'\]\s*/g, '').trim();
          const seen = creamPerFile.get(rel) || new Set();
          if (!seen.has(key)) {
            seen.add(key);
            creamPerFile.set(rel, seen);
            if (seen.size > 1) {
              out.push(
                `${rel}:${line}  [${label}]  DRUGI krem w module — jeden pas kremu na stronę (R2)`
              );
              flagged = true;
              break;
            }
          }
        }
      }
    }
    if (flagged) continue;

    // R4 — zebra.
    if (ZEBRA_SEL.test(selChain) && decls.some(d => BG_PROPS.has(d.prop))) {
      out.push(`${rel}:${line}  [${label}]  zebra (R4)`);
      continue;
    }

    // R8 — rama akcentu musi odwracać się z trybem.
    if (!/data-mode=['"]?dark/.test(selChain) && !ALLOW_INK.test(scope)) {
      const inkBorder = decls.find(
        d => BORDER_PROP.test(d.prop) && /var\(\s*--color-ink\s*\)/.test(d.value) && !/color-mix\(/.test(d.value)
      );
      if (inkBorder) {
        out.push(
          `${rel}:${line}  [${label}]  --color-ink jako rama (R8) — ciemny w OBU trybach, w dark wyróżnienie znika`
        );
        continue;
      }
    }

    // R10 — tabela musi mieć JAWNĄ decyzję o table-layout.
    if (decls.some(d => d.prop === 'border-collapse')) {
      const hasLayout = decls.some(d => d.prop === 'table-layout');
      if (!hasLayout && !ALLOW_TABLE.test(scope)) {
        out.push(
          `${rel}:${line}  [${label}]  tabela bez decyzji o table-layout (R10)`
        );
        continue;
      }
    }
  }
}

process.stdout.write(out.join('\n'));
NODE

VIOLATIONS=$(UI_DIR="$UI_DIR" node "$SCANNER" "${SCAN_FILES[@]}")

print_separator

if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | wc -l | tr -d " ")
  print_error "Tint discipline FAILED — ${COUNT} naruszeń motywu „Jeden krem”:"
  echo ""
  echo "$VIOLATIONS" | sed "s|${ROOT}/||"
  echo ""
  echo "Napraw (wybierz jedno):"
  echo "  1. ZNAK (glif w kółku, medalion, avatar, licznik, bullet, badge):"
  echo "     background: var(--color-mark-bg) / var(--color-mark-bg-strong)"
  echo "     na atramencie: var(--color-mark-bg-on-ink)"
  echo "  2. TRWAŁY STAN wybrania:  background: var(--color-state-selected)"
  echo "  3. ULOTNY HOVER:          background: var(--color-state-hover)  (neutralny)"
  echo "  4. POWIERZCHNIA (sekcja, karta, panel, wiersz, box):"
  echo "     zdejmij tint → var(--color-bg-main); wyróżnienie niesie ZAMKNIĘTA"
  echo "     rama 4-bok + waga typografii (R3), a plan POLECANY w zestawie —"
  echo "     pełny negatyw ink (głos S98/B). Sprawdź, czy tint nie pełnił roli"
  echo "     GRANICY — jeśli tak, granicę przejmuje hairline albo spacing."
  echo "  5. KONTROLKA / ATOM (chip, avatar, tor, input, podkład medium):"
  echo "     var(--color-surface-input) — krem należy do karty-intro i JEDNEGO"
  echo "     pasa sekcji (głos S98/A), nie do prymitywu, który powtarza się"
  echo "     kilkanaście razy na ekranie."
  echo "  6. ZEBRA: usuń regułę. Rytm trzyma hairline + spacing (R4)."
  echo "  7. RAMA AKCENTU: --color-text-primary (odwraca się z trybem), nie"
  echo "     --color-ink. Rama Z ATRAMENTU na powierzchni ink to co innego —"
  echo "     opisz to markerem /* ink-border-allow: <powód> */."
  echo "  8. TABELA: dopisz table-layout: fixed ALBO uzasadnij auto markerem"
  echo "     /* table-layout-auto: <powód> */ (np. log ze scrollem i nowrap)."
  echo "  9. TINT STANU zapisany SUROWO (rgba/hsl/oklch/color): przepisz na token"
  echo "     — color-mix(in oklch, var(--color-error) 10%, transparent). R7"
  echo "     zwalnia TOKEN stanu, nie trójkę liczb: liczby nie niosą znaczenia"
  echo "     i nie pojadą ze zmianą palety."
  echo " 10. Uzasadniony wyjątek (zagłosowany kanon / tint kodujący dane):"
  echo "     /* tint-allow: <powód> */  — powód jest OBOWIĄZKOWY."
  echo ""
  echo "Reguły motywu: DESIGN.md §Motyw „Jeden krem” (R1–R10)."
  echo "Dowód, że ten strażnik łapie: npm run audit:selftest"
  exit 1
fi

print_success "Tint discipline passed — tinty przez tokeny roli, jeden krem, zero zebry"
exit 0
