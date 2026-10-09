#!/usr/bin/env bash
# edge-stripe-discipline.sh — Enforce floor §3 (no one-sided accent borders),
# THE forms the gradient/shadow grep AND the `border-left:` grep both miss.
#
# INTENT:
#   Anti-AI-Slop floor §3 bans one-sided accent borders (a colored left/right
#   stripe on a card/row = the AI-slop "tell"; depth must come from full 4-sided
#   hairline + tonal surface + label, not a stripe). Earlier greps catch only
#   some forms:
#     - the gradient/box-shadow grep misses non-shadow stripes entirely,
#     - the `border-(left|right):` grep misses stripes drawn as an absolutely
#       positioned thin bar (a `::before`/`::after` OR a plain `<span>` rail).
#   So a thin full-height bar pinned to ONE edge slips through both.
#   `.currentPlanCard::before`, the admin severity/status rails, the SalonStaff
#   owner rail and AdminSupport `.awaitingRail` all survived multiple quality
#   passes this way (cleaned S31). This audit closes that third blind-spot.
#
# RULE (structural, no counters/baselines — nothing here rots):
#   ANY CSS block in main/src/UI/**/*.module.css is a VIOLATION when it
#   draws a THIN EDGE BAR on EITHER axis. Both axes are enforced; the thinness
#   thresholds differ, because the two figures are authored differently.
#
#   VERTICAL bar (stripe on the left/right edge):
#     (a) `width: 1-6px`, AND
#     (b) pinned full-height to ONE horizontal edge — either
#         `inset: <v> auto <v> 0` / `inset: <v> 0 <v> auto` (auto in a left/right
#         slot), OR longhand `left:0`/`right:0` together with BOTH `top:` and
#         `bottom:` set (any value — top:6px/bottom:6px still spans the edge).
#     The 3-value `inset` shorthand is deliberately NOT matched on this axis:
#     with three values `left` and `right` share ONE slot, so a one-sided
#     vertical bar cannot be written that way at all.
#
#   HORIZONTAL bar (the same figure rotated 90°, a rule on the top/bottom edge):
#     (a) `height: 1-8px` OR `height: clamp(1-8px, …)` — the clamp form is how
#         these were actually authored (`clamp(3px, 0.5vw, 5px)`), and the
#         printed-edge rails ran 8px, hence the wider band than on the vertical
#         axis, AND
#     (b) pinned full-width to ONE vertical edge — either the 4-value
#         `inset: <v> <v> auto <v>` / `inset: auto <v> <v> <v>`, the 3-value
#         shorthand `inset: <top> <inline> auto` / `inset: auto <inline> <bottom>`
#         (this is how the ActivateRolePage accent bars slipped through a whole
#         theme wave), OR longhand `top:0`/`bottom:0` together with BOTH `left:`
#         and `right:` set.
#
#   UNLESS:
#     1. its `background` OR `background-color` is a NEUTRAL structural token
#        (--color-divider / line / border / surface) or `none` — a neutral
#        one-sided divider is allowed (same status as <hr>). This exception
#        needs NO marker: the colour itself is the justification. Both the
#        shorthand and the `background-color:` longhand count, OR
#     2. an explanatory opt-out comment `edge-stripe-allow: <reason>` appears
#        in the block, in its head (the comment right above the selector) or
#        in the head of an enclosing @media / ancestor block. The REASON IS
#        MANDATORY — a bare `edge-stripe-allow:` gets its own message, because
#        an exception nobody can verify in review is exactly what the marker
#        guards against. New exceptions live IN the code next to the
#        declaration (visible in review), never in a central list.
#
# S100 (fala mutacyjna) zamknęła w tym skanerze trzy dziury naraz:
#   · `hasNeutralBg` pytał WYŁĄCZNIE o skrót `background:`, więc legalny
#     neutralny dzielnik zapisany `background-color: var(--color-divider)`
#     był zgłaszany jako pasek akcentu (potwierdzona fałszywka);
#   · parser liczył klamry per LINIA, więc blok zapisany w JEDNEJ linii miał
#     opens == closes i był niewidzialny, choć ten sam blok rozbity na linie
#     failował;
#   · pusty escape `edge-stripe-allow:` zwalniał z reguły, nie mówiąc z czego.
#   Dowód: tests/audit/_fixtures/edge-stripe-discipline (obie osie, skrót
#   3-członowy, clamp, granice cienkości z obu stron, escape z powodem i bez).
#
#   A geometry-only base block (thin edge bar, background transparent/none,
#   colored by a `[data-x] ...::before` modifier) is STILL flagged — the bar
#   shape itself is the tell, regardless of where the colour is set.
#
#   Fix the common case by removing the bar: differentiate the card/row with a
#   full 4-sided hairline (border-color may be accent — that is NOT one-sided) +
#   tonal tint + a label/badge, or a discrete status DOT (kanon S30/S31).
#
# SCOPE: CAŁE main/src/UI (features, components, layouts, primitives — i każdy
#   katalog, który tam dopiero powstanie). Wyjęte: **/playground/** (warianty
#   eksperymentalne).
#   Do S109 skan obejmował WYŁĄCZNIE features/** z uzasadnieniem „components/
#   i layouts/ hostują prymitywy, które dostają więcej uwagi i mają legalne
#   paski". To była zieleń nad połową kodu: AppLayout, BottomTabBar i AppDrawer
#   — czyli chrome widoczny na KAŻDYM ekranie /app, a więc miejsce o najwyższej,
#   nie najniższej stawce — nigdy nie zostały obejrzane. „Prymityw ma legalny
#   pasek" to argument za MARKEREM `edge-stripe-allow: <powód>` przy tym pasku,
#   nie za wyjęciem katalogu spod skanu: wyjątek widoczny w review jest dokładnie
#   tym, czego ten strażnik pilnuje.
#   Zakres jest KORZENIEM, nie listą katalogów, właśnie dlatego, że lista
#   gnije po cichu: nowy katalog obok `primitives/` wypadłby ze skanu bez
#   jednego słowa w wyjściu, a to ta sama fałszywa zieleń o piętro wyżej.
#
# EXIT: 0 if no violations, 1 if found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
UI_DIR="${ROOT}/main/src/UI"

print_boxed_header "Edge-stripe discipline: no one-sided accent rails (floor §3)" "📏"

# Pusta lista plików to najgorszy stan strażnika: melduje „passed" i wychodzi
# zerem, więc przeniesiony katalog albo zawężony filtr `find` zamieniają go
# w atrapę nie do odróżnienia od zieleni zapracowanej.
if [[ ! -d "$UI_DIR" ]]; then
  print_error "Brak katalogu ${UI_DIR#"${ROOT}/"} — nie ma czego skanować (zieleń nad zerem plików = atrapa)"
  exit 1
fi

declare -a CSS_FILES
mapfile -t CSS_FILES < <(find "$UI_DIR" -name "*.module.css" -type f \
  -not -path "*/playground/*" | sort)

if [[ "${#CSS_FILES[@]}" -eq 0 ]]; then
  print_error "Zero arkuszy do skanu w ${UI_DIR#"${ROOT}/"} — strażnik raportowałby „passed” nad pustką"
  exit 1
fi

print_header "Scanning ${#CSS_FILES[@]} stylesheets in main/src/UI for thin one-edge accent bars (oś pionowa I pozioma)"

SCANNER="$(mktemp)"
trap 'rm -f "$SCANNER"' EXIT

# Skaner jedzie przez plik tymczasowy, nie przez `node -e '…'`: kod parsera
# musi swobodnie używać apostrofów (`content: '}'`, znaki cudzysłowu
# w klasach znaków), a te zamykały ciąg w pojedynczych cudzysłowach basha.
cat > "$SCANNER" <<'NODE'
const fs = require("fs");
const files = process.argv.slice(1);
// Powód jest OBOWIĄZKOWY i musi stać w TEJ SAMEJ linii co marker (`\s*`
// przeskakiwałoby nowe linie, więc pusty escape „pożyczał" sobie pierwsze
// słowo z następnego komentarza). Escape bez powodu to wyjątek nie do
// zweryfikowania w review — dokładnie to, przed czym marker ma chronić.
const ALLOW = /edge-stripe-allow:[ \t]*\S/;
const ALLOW_BARE = /edge-stripe-allow:/;
const out = [];

const isThinVerticalEdgeBar = (body) => {
  if (!/width:\s*[1-6]px(\b|;)/.test(body)) return false;
  // inset with auto in a left/right slot → vertical one-edge pin
  const insetPin =
    /inset:\s*\S+\s+auto\s+\S+\s+0(\b|;|\s)/.test(body) ||   // left bar (right=auto)
    /inset:\s*\S+\s+\S+\s+\S+\s+auto(\b|;|\s)/.test(body);    // right bar (left=auto)
  // longhand: left|right anchored to 0 AND both top & bottom set → full-height
  // edge pin (top:6px / bottom:6px still spans the edge — value is irrelevant).
  const longPin =
    /(^|[;{\s])(left|right):\s*0(\b|;)/m.test(body) &&
    /(^|[;{\s])top:\s*[^;]+;/m.test(body) &&
    /(^|[;{\s])bottom:\s*[^;]+;/m.test(body);
  return insetPin || longPin;
};
// Oś POZIOMA — ta sama figura obrócona o 90°: cienki pasek przyklejony do
// GÓRNEJ albo DOLNEJ krawędzi. Pierwsza wersja ratcheta widziała tylko oś
// pionową, więc pięć „printed edge" pasków (login, 404, 500, maintenance,
// unsubscribe, status) przeżyło kilka fal jakości. Wysokość bierzemy też
// z clamp(), bo tak właśnie były zapisane (clamp(3px, 0.5vw, 5px)).
const isThinHorizontalEdgeBar = (body) => {
  if (!/height:\s*(?:[1-8]px(\b|;)|clamp\(\s*[1-8]px)/.test(body)) return false;
  // Skrót 3-WARTOŚCIOWY (`inset: <top> <inline> <bottom>`) omijał ten skan,
  // bo obie reguły niżej wymagają CZTERECH członów. Tak właśnie zapisany był
  // pasek akcentu na trzech kartach ActivateRolePage (`inset: 0 var(--sp-2)
  // auto`) — przeżył całą falę motywu jako fałszywa zieleń (S98). Oś pionowa
  // NIE dostaje tego wariantu: przy trzech wartościach left i right dzielą
  // jeden człon, więc jednostronny pas pionowy jest w tym zapisie niemożliwy.
  const insetPin =
    /inset:\s*\S+\s+\S+\s+auto\s+\S+(\b|;|\s)/.test(body) ||  // górny pasek (bottom=auto)
    /inset:\s*auto\s+\S+\s+\S+\s+\S+(\b|;|\s)/.test(body) ||   // dolny pasek (top=auto)
    /inset:\s*\S+\s+\S+\s+auto\s*(;|\})/.test(body) ||           // 3-czł. górny pasek
    /inset:\s*auto\s+\S+\s+\S+\s*(;|\})/.test(body);             // 3-czł. dolny pasek
  const longPin =
    /(^|[;{\s])(top|bottom):\s*0(\b|;)/m.test(body) &&
    /(^|[;{\s])left:\s*[^;]+;/m.test(body) &&
    /(^|[;{\s])right:\s*[^;]+;/m.test(body);
  return insetPin || longPin;
};
// Neutral structural fill → allowed (a neutral one-sided divider == <hr>).
// `background-color:` MUSI tu być obok skrótu: legalny neutralny dzielnik
// zapisany longhandem (`background-color: var(--color-divider)`) był zgłaszany
// jako pasek akcentu — POTWIERDZONA fałszywka, znaleziona uruchomieniem.
const hasNeutralBg = (body) =>
  /background(-color)?:[^;]*var\(--color-(divider|line|border|surface)/.test(body) ||
  /background(-color)?:\s*none(\b|;)/.test(body);

// Parser blokow zyje w JEDNYM zrodle (`_css-blocks.cjs`) — wyniesiony stad,
// gdy ta sama wada („blok w jednej linii jest niewidzialny") wyszla w trzech
// innych straznikach. Czwarta kopia zaczelaby dryfowac; to ta sama lekcja,
// co jeden `SCRIPT_GUARDS` dla obu sciezek pre-commita.
const { parseBlocks } = require(process.env.CSS_BLOCKS_MODULE);

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ");
const stripStringsAndComments = (s) =>
  stripComments(s).replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
// Delimitery WYCINAMY: bez tego `/* edge-stripe-allow: */` przechodzi jako
// wyjątek „z powodem", bo `*/` jest niepustym ciągiem znaków — i pusty escape
// zwalnia z reguły, choć nie mówi z czego. Marker żyje wyłącznie w komentarzu,
// więc scope budujemy z TREŚCI komentarzy, nie z surowego tekstu.
const commentsOf = (s) =>
  (s.match(/\/\*[\s\S]*?\*\//g) || []).map((c) => c.slice(2, -2)).join("\n");

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const blk of parseBlocks(text)) {
    // @-rules / czyste wrappery nie mają własnych deklaracji warte sprawdzenia;
    // ich ciało to zagnieżdżone bloki, które i tak przechodzą osobno.
    if (/\{/.test(stripStringsAndComments(blk.body))) continue;
    const body = blk.body;
    const sel = stripComments(blk.head).replace(/\s+/g, " ").trim();
    // Wyjątek żyje w ciele bloku, w jego „główce" (czyli komentarzu tuż nad
    // selektorem) albo w główce @media, w którym blok siedzi. Główka zaczyna
    // się PO klamrze zamykającej poprzedni blok, więc wyjątek nie przecieka
    // z sąsiada — okno liczone liniami przechodziło przez klamrę.
    const scope = [body, blk.head, ...blk.ancestors.map(a => a.head)]
      .map(commentsOf)
      .join("\n");
    const isEdgeBar = isThinVerticalEdgeBar(body) || isThinHorizontalEdgeBar(body);
    if (!isEdgeBar || hasNeutralBg(body)) continue;
    if (ALLOW_BARE.test(scope) && !ALLOW.test(scope)) {
      out.push(
        `${file}:${blk.start}  [${sel || "?"}]  edge-stripe-allow BEZ POWODU — wyjątek nie do zweryfikowania w review`
      );
      continue;
    }
    if (ALLOW.test(scope)) continue;
    out.push(`${file}:${blk.start}  [${sel || "?"}]  jednostronny pasek akcentu`);
  }
}
process.stdout.write(out.join("\n"));
NODE

VIOLATIONS=$(CSS_BLOCKS_MODULE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_css-blocks.cjs" node "$SCANNER" "${CSS_FILES[@]}")

print_separator

if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | wc -l | tr -d ' ')
  print_error "Edge-stripe discipline FAILED — ${COUNT} one-sided accent bar(s):"
  echo ""
  echo "$VIOLATIONS" | sed "s|${ROOT}/||"
  echo ""
  echo "Fix (pick one):"
  echo "  1. Remove the bar — differentiate with a FULL 4-sided hairline"
  echo "     (border-color may be accent), tonal tint + label/badge, or a"
  echo "     discrete status DOT (kanon S30/S31)."
  echo "  2. If the bar is a NEUTRAL structural divider, color it"
  echo "     var(--color-divider) (neutral one-sided dividers are allowed)."
  echo "  3. If genuinely justified, add a comment in or above the block:"
  echo "     /* edge-stripe-allow: <reason> */"
  exit 1
fi

print_success "Edge-stripe discipline passed — no one-sided accent bars in main/src/UI"
exit 0
