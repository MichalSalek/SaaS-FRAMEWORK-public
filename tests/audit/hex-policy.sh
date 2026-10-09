#!/usr/bin/env bash
# hex-policy.sh — Guard against raw hex color literals used as values in
# feature/component CSS modules (tokenization ratchet, FDX FAZA 5 / W5.3).
#
# INTENT:
#   Themed surfaces must draw colour from design tokens (var(--color-*) /
#   palettes.css) so light/dark, contrast and brand changes stay SSOT. A raw
#   #rrggbb sitting directly inside a background / color / border / color-mix()
#   declaration bypasses the token system and rots silently when the palette
#   moves. The W5.3 census tokenized the last 24 scattered literals into named
#   local custom-props; this audit keeps that ratchet from sliding back.
#
# WHAT IS ALLOWED (NOT a violation):
#   1. Hex inside a CSS custom-property DEFINITION line — `--name: #rrggbb;`.
#      This is the endorsed pattern for FUNCTIONAL, mode-invariant, admin /
#      role-internal colours that genuinely don't belong in the global theme
#      palette (trait-category swatches, "main note" highlight, client-role
#      coral-rose). The hex lives in ONE named place per file and is consumed
#      via color-mix(var(--name) …), so it stays DRY and self-documenting.
#   2. Hex inside a comment (whole-line `/* … */` or `* …`, or trailing
#      `… ; /* note #abc */`). Comments often cite a hex for rationale.
#   3. Files on the ALLOWLIST below (each with a documented reason).
#
# WHAT IS A VIOLATION:
#   A raw #hex used directly as a property VALUE (e.g.
#   `color: #ec4899;` or `background: color-mix(in oklch, #facc15 …)`) in a
#   non-allowlisted *.module.css under features/ or components/.
#
# ALLOWLIST — intentional raw hex (rationale in the file's own DECISION comment):
#   - static/LegalDocLayout.module.css  — #000 in @media print: black-on-white
#       paper output, deliberately outside the mode-aware token system.
#   - explore/components/ExploreStylistsTab.module.css — #c13584 = Instagram's
#       official brand colour on the IG affordance (platform recognisability >
#       theme palette); functional, not decorative.
#   - static/HelpCenterPage.module.css — #000 used purely as a darken anchor in
#       color-mix (… var(--color-primary) 88%, #000 12%), documented inline.
#
# WYKRESLONE (S109, po weryfikacji przez usuniecie wpisu i przebieg audytu):
#   - pairing/components/QrScannerOverlay.module.css — PLIKU NIE MA w repo.
#       Wpis chronil nieistniejacy arkusz, czyli nie chronil niczego, a przy
#       tym wygladal na zywy powod.
#   - home/HomePage.module.css — #2a2a20 zniknal wraz z wymiana palety
#       (zostal po nim tylko komentarz). Wpis trzymal caly plik poza skanem,
#       wiec KAZDY nowy surowy heks w najwiekszym module strony glownej
#       przechodzilby bez sladu. To najdrozszy rodzaj martwego wyjatku.
# Pozostale trzy sa zywe — sprawdzone tak samo: po ich usunieciu audyt zglasza
# 9 realnych trafien (IG #c13584 x3, druk #000 x5, kotwica przyciemnienia #000).
#
# SCOPE: KAZDY arkusz `*.css` pod main/src.
#
#   Do S100 skan obejmowal wylacznie `features/` i `components/`, i to tylko
#   pliki `*.module.css`. Poza siecia zostawaly `layouts/`, `primitives/`,
#   `shared/` oraz `styles/` — czyli wlasnie te miejsca, w ktorych zla wartosc
#   boli najbardziej, bo dziedziczy ja caly produkt, a nie jeden ekran. Luka nie
#   byla teoretyczna: `global.css` trzymal dwa fallbacki `var(--token, #hex)` na
#   samym `body` (kolor tla i tekstu CALEJ aplikacji) i surowy kotwiczny hex
#   w efekcie CTA. Zadne z nich nie mialo szansy zapalic sie na czerwono.
#
#   Zasieg jest teraz zdefiniowany przez to, CZYM plik jest (arkuszem stylu),
#   a nie przez to, GDZIE lezy — lista katalogow do utrzymania znika, a nowy
#   katalog stylow jest objety strazem od pierwszego dnia.
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/main/src"

print_boxed_header "Color policy: role tokens over raw hex, oklch, rgb i nazw CSS" "🎨"

# Allowlisted files (paths relative to ROOT). Rationale documented above.
ALLOWLIST=(
  "main/src/UI/features/static/LegalDocLayout.module.css"
  "main/src/UI/features/explore/components/ExploreStylistsTab.module.css"
  "main/src/UI/features/static/HelpCenterPage.module.css"
)

declare -a CSS_FILES=()
if [[ -d "$SRC_DIR" ]]; then
  while IFS= read -r -d $'\0' f; do
    CSS_FILES+=("$f")
  done < <(find "$SRC_DIR" -name "*.css" -type f -print0 \
    | grep -zv "node_modules\|\.next\|/out/\|/dist/")
fi

# Zero plikow = zielen nad pustka, nie do odroznienia od zieleni zapracowanej.
if [[ "${#CSS_FILES[@]}" -eq 0 ]]; then
  print_error "Zero arkuszy .css w ${SRC_DIR#"${ROOT}/"} — straznik raportowalby „passed” nad pustka"
  exit 1
fi

print_header "Scanning ${#CSS_FILES[@]} stylesheet(s) for raw hex values"

# Node does the per-line parsing: strip /* … */ comments (single-line and
# multi-line), exempt custom-property definition lines, then look for any
# remaining #hex in the code portion of the line. The argv carries the
# allowlist count first, then the allowlist, then the files — so the two
# lists can never be confused.
VIOLATIONS=$(ROOT="$ROOT" node - "${#ALLOWLIST[@]}" "${ALLOWLIST[@]}" "${CSS_FILES[@]}" <<'NODE'
const fs = require("fs");
const ROOT = process.env.ROOT.replace(/\/?$/, "/");

const argv = process.argv.slice(2);
const nAllow = parseInt(argv[0], 10);
const allowRel = argv.slice(1, 1 + nAllow);
const files = argv.slice(1 + nAllow);
const allow = new Set(allowRel.map(p => ROOT + p));

const HEX = /#[0-9a-fA-F]{3,8}\b/;
// custom-property definition: `  --some-name: #abc;`  (optionally !important)
const VAR_DEF = /^\s*--[A-Za-z0-9-]+\s*:/;
// SLEPA PLAMA ZAMKNIETA (S109): ten straznik pilnowal wylacznie zapisu #hex,
// wiec surowy `oklch()` przechodzil obok niego bez sladu — a to dzis GLOWNY
// zapis koloru w tym repo (paleta jest w oklch). Tak przezyly szesc miesiecy
// dwa pasy alertow w bursztynie i czerwieni z hue spoza palety.
// Parametryzowany oklch ZOSTAJE legalny: `oklch(0.28 0.05 var(--avatar-hue))`
// to przepis na kolor per uzytkownik, nie literal.
const OKLCH_CALL = /oklch\(/g;
// TRZECIA I CZWARTA KLASA (S110, po fali adwersarialnej): straznik po
// rozszerzeniu na oklch nadal mowil "zero surowych kolorow", a nie widzial ani
// `rgb()/rgba()/hsl()`, ani nazw CSS. Za tym komunikatem chowaly sie zaslony
// modali (rgba(0,0,0,.5)) i biale ikony na nakladce zdjecia. Komunikat, ktory
// obiecuje wiecej, niz sprawdza, jest gorszy niz brak strazniкa.
// KOTWICA W color-mix ZOSTAJE LEGALNA: `color-mix(in oklch, white 16%, …)` to
// udokumentowany idiom tego repo (58 uzyc: wlosowe linie i tinty na ciemnym),
// ta sama klasa co dozwolona kotwica przyciemnienia #000. Scigamy WARTOSC
// samodzielna, nie skladnik mieszania.
// PIATA KLASA (S110, runda 2): heks ZAKODOWANY w data-URI (`%23ffffff` w
// `url("data:image/svg+xml,…")`). Nie zawiera znaku `#`, wiec nie dotykal ani
// tej bramki, ani siostrzanej tint-discipline (ta ostatnia zna ten obejscie
// i wprost zwalnia biel/czern jako "strukturalne").
// DLACZEGO NIE ZAKAZ: w data-URI NIE DA SIE uzyc `var(--token)` — SVG w URL nie
// widzi kaskady CSS, wiec neutralna biel i czern sa tam koniecznoscia techniczna,
// nie lenistwem. Ale KOLOR MARKI zapisany tak samo juz koniecznoscia nie jest:
// zamraza wycofany odcien w miejscu, ktorego zadna wymiana palety nie ruszy —
// dokladnie ten mechanizm zostawil zlote numeraly po charcoal-gold. Dlatego
// przepuszczamy wylacznie neutralne (fff/ffffff/000/000000), a kazdy inny heks
// w url() jest naruszeniem.
const URL_HEX = /%23([0-9a-fA-F]{3,8})\b/g;
// Neutralne we WSZYSTKICH dlugosciach zapisu, takze z kanalem alfa: 4- i
// 8-znakowy wariant to nadal biel albo czern, wiec odrzucanie ich byloby
// falszywka wobec wlasnego komunikatu bramki.
const STRUCTURAL = new Set([
  "fff", "ffff", "ffffff", "ffffffff",
  "000", "0000", "000000", "000000ff",
]);
function brandHexInUrl(line) {
  // `%2523` = PODWOJNIE zakodowany `#`. Bez tego kroku wystarczyloby jedno
  // dodatkowe kodowanie, zeby przemycic kolor marki obok bramki.
  const decoded = line.replace(/%25/g, "%");
  // Regula dotyczy WYLACZNIE data-URI: `%23` w zwyklym tekscie albo jako
  // fragment (`url(%23noiseFilter)`) nie jest kolorem. Bez tego warunku
  // `url(%23feed)` — cztery znaki hex w nazwie filtra — bylo falszywka.
  if (!/url\(/i.test(decoded)) return false;
  let m;
  URL_HEX.lastIndex = 0;
  while ((m = URL_HEX.exec(decoded)) !== null) {
    const idx = decoded.lastIndexOf("url(", m.index);
    if (idx === -1) continue;                 // trafienie poza url()
    if (!/data:/i.test(decoded.slice(idx, m.index))) continue; // fragment, nie obraz
    if (!STRUCTURAL.has(m[1].toLowerCase())) return true;
  }
  return false;
}
const RAW_FN = /\b(rgba?|hsla?)\(/g;
function rawFnIn(line) {
  let m;
  RAW_FN.lastIndex = 0;
  while ((m = RAW_FN.exec(line)) !== null) {
    const args = line.slice(m.index, m.index + 80);
    if (!args.includes("var(")) return true;
  }
  return false;
}
// Nazwa CSS jako CALA wartosc deklaracji: `color: white;`, `background: black !important;`
const NAMED_VALUE =
  /(^|[;{])\s*[a-z-]+\s*:\s*(white|black|red|blue|green|yellow|orange|purple|pink|gray|grey|silver|gold)\s*(!important)?\s*(;|$)/i;
function rawOklchIn(line) {
  let m;
  OKLCH_CALL.lastIndex = 0;
  while ((m = OKLCH_CALL.exec(line)) !== null) {
    // argumenty tego wywolania: do konca deklaracji, wystarczy na heurystyke
    const args = line.slice(m.index, m.index + 80);
    if (!args.includes("var(")) return true;
  }
  return false;
}

const out = [];

for (const file of files) {
  if (allow.has(file)) continue;
  const rel = file.startsWith(ROOT) ? file.slice(ROOT.length) : file;
  const src = fs.readFileSync(file, "utf8");
  // Strip /* … */ comments (incl. multi-line) so hex cited in rationale is ignored.
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = noComments.split("\n");

  lines.forEach((line, i) => {
    const hasHex = HEX.test(line);
    const hasRawOklch = rawOklchIn(line);
    const hasRawFn = rawFnIn(line);
    const hasNamed = NAMED_VALUE.test(line);
    const hasUrlBrandHex = brandHexInUrl(line);
    if (!hasHex && !hasRawOklch && !hasRawFn && !hasNamed && !hasUrlBrandHex)
      return;
    if (VAR_DEF.test(line)) return; // named local token definition — allowed
    out.push(`${rel}:${i + 1}  ${line.trim()}`);
  });
}

process.stdout.write(out.join("\n"));
NODE
)

print_separator

if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | grep -c '' || true)
  print_error "Color policy FAILED — ${COUNT} surowych kolorow poza systemem tokenow:"
  echo ""
  echo "$VIOLATIONS"
  echo ""
  echo "Fix (pick one):"
  echo "  1. Use an existing theme token: var(--color-*) from tokens.css /"
  echo "     palettes.css (preferred for themed surfaces)."
  echo "  2. If the colour is FUNCTIONAL / mode-invariant and genuinely outside"
  echo "     the palette (admin swatch, brand-logo colour, print-black), name it"
  echo "     as a local custom-prop on the page root:"
  echo "       .page { --my-hue: #abcdef; }"
  echo "     and consume it via color-mix(var(--my-hue) …)."
  echo "  3. If the literal is a deliberate, un-tokenizable exception, add it to"
  echo "     the ALLOWLIST in this script WITH a rationale, and drop a"
  echo "     /* DECISION (nie usuwaj): … */ comment at the declaration."
  exit 1
fi

print_success "Color policy passed — zero surowych kolorow (hex, oklch, rgb/hsl, nazwy CSS, kolor marki w data-URI) poza tokenami / nazwanymi lokalnymi; legalne zostaja: kotwica w color-mix, wartosc parametryzowana przez var() i neutralna biel/czern w data-URI (var() tam nie dziala)"
exit 0
