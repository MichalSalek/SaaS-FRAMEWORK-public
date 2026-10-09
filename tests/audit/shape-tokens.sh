#!/usr/bin/env bash
# shape-tokens.sh — kształt prymitywów i stron idzie WYŁĄCZNIE przez role
# `--style-*` (głosy ownera S105–S108, 2026-09-06: „Siatka studia”).
#
# INTENT:
#   Po głosie kształtu każdy narożnik, każda linia i każda etykieta produktu
#   czytają jedno źródło: blok `--style-*` w `main/src/UI/styles/tokens.css`.
#   Kodemod S108 przepisał 157 modułów; ten strażnik pilnuje, żeby forma nie
#   odrosła obok tokenów (tak odrosło 883 użyć `--radius-*` i 159 kapitalików
#   między S37 a S105). Reguły są strukturalne, bez liczników i baseline'ów.
#
# REGUŁY (main/src/UI/**/*.css i main/src/pages/**/*.css, poza tokens.css,
# świadome komentarzy):
#   R1 `var(--radius-*)` — stara skala narożników. Użyj `--style-radius-control`
#      (kontrolki), `--style-radius-surface` (karty, panele, dialogi),
#      `--style-radius-pill` (pigułki, chipy), `--style-radius-avatar`,
#      `--style-radius-medallion`, `--style-radius-round` (koło geometryczne:
#      kciuk przełącznika, kropka). Stara skala `--radius-*` nie istnieje.
#   R2 `border-radius` z surową wartością inną niż `0` (px, rem, %, 999px).
#   R3 `text-transform: uppercase` — etykieta bierze `var(--style-label-case)`
#      (kicker: `--style-kicker-case`), po głosie 4 = none.
#   R4 surowa grubość linii w `border*:`/`border-width` (1px, 1.5px, 2px…) —
#      rama = `--style-border-surface`, kontrolka = `--style-border-control`,
#      linia dzieląca = `--style-border-divider`. `outline` i `box-shadow` poza
#      zakresem (pierścienie fokusu nie są ramą).
#   Escape (powód OBOWIĄZKOWY): komentarz `shape-allow: <powód>` w tej samej
#   linii albo do 3 linii wyżej.
#
# PARALLEL_LEFTOVERS: pliki, których strażnik chwilowo nie liczy (moduły otwarte
#   w innej sesji w dniu kodemodu). Od S109 lista jest pusta i aliasy `--radius-*`
#   zniknęły z tokens.css; wpis tutaj = jawny, datowany dług, nie furtka.
#
# EXIT: 0 bez naruszeń, 1 gdy są.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
UI_DIR="${ROOT}/main/src/UI"
PAGES_DIR="${ROOT}/main/src/pages"

print_boxed_header "Shape tokens: corners, lines and labels only through --style-*" "◼"

PARALLEL_LEFTOVERS=(
)

declare -a CSS_FILES
mapfile -t CSS_FILES < <(
  { [[ -d "$UI_DIR" ]] && find "$UI_DIR" \( -name "*.css" -o -name "*.tsx" \) -type f -not -path "*/styles/tokens.css"; \
    [[ -d "$PAGES_DIR" ]] && find "$PAGES_DIR" \( -name "*.css" -o -name "*.tsx" \) -type f; } 2>/dev/null | sort
)
require_scanned "${#CSS_FILES[@]}" "CSS and TSX files under main/src/UI and main/src/pages"
print_header "Scanning ${#CSS_FILES[@]} stylesheets and components"

VIOLATIONS=$(AUDIT_ROOT="$ROOT" LEFTOVERS="$(printf '%s\n' "${PARALLEL_LEFTOVERS[@]}")" node -e '
const fs = require("fs");
const root = process.env.AUDIT_ROOT + "/";
const leftovers = new Set(process.env.LEFTOVERS.split("\n").filter(Boolean));
const files = process.argv.slice(1);
const ALLOW = /shape-allow:/;
const RULES = [
  // R1: also the fallback form `var(--radius-md, 8px)`
  { id: "R1", re: /var\(--radius-[a-z]+\s*[,)]/, msg: "stara skala --radius-* zamiast roli --style-radius-*" },
  // R2: every corner property, every value slot: `0 0 20px 20px` is raw, `0` alone is not
  { id: "R2", re: /border-(?:[a-z]+-)*radius:\s*[^;{}]*\b(?:[1-9][0-9]*(?:\.[0-9]+)?|0?\.[0-9]+)(?:px|rem|em|%)/, msg: "surowy border-radius zamiast roli --style-radius-*" },
  { id: "R3", re: /text-transform:\s*uppercase|font-variant(?:-caps)?:\s*(?:all-)?(?:small|petite)-caps/, msg: "kapitaliki wprost zamiast var(--style-label-case)" },
  // R4: shorthand, every side, logical sides and the -width longhands
  { id: "R4", re: /\bborder(?:-(?:top|bottom|left|right|block|inline|block-start|block-end|inline-start|inline-end))?(?:-width)?:\s*(?:[a-z]+\s+)?(?!0(?:px)?\b)[0-9.]+px\b/, msg: "surowa grubość linii zamiast --style-border-surface/-control/-divider" },
];
// R5: `outline` used as a frame (outside a :focus block) — an outline is a focus ring, not a rama
const OUTLINE_FRAME = /outline:\s*(?:[a-z]+\s+)?[0-9.]+px\b/;
// R6 (TSX only): inline style radius with a literal instead of a role token
const TSX_RADIUS = /borderRadius:\s*[\x27"]?[0-9.]+(?:px|rem|em|%)?[\x27"]?\s*[,}]/;
const out = [];
for (const file of files) {
  const rel = file.startsWith(root) ? file.slice(root.length) : file;
  if (leftovers.has(rel)) continue;
  const raw = fs.readFileSync(file, "utf8");
  // comment-aware: blank out /* … */ but keep line numbers, then scan per line
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
  const rawLines = raw.split("\n");
  const lines = code.split("\n");
  const allowed = i => ALLOW.test(rawLines.slice(Math.max(0, i - 3), i + 1).join("\n"));
  const isTsx = file.endsWith(".tsx");
  lines.forEach((line, i) => {
    if (isTsx) {
      if (TSX_RADIUS.test(line) && !allowed(i)) out.push(`${rel}:${i + 1}  [R6] borderRadius inline z literałem zamiast var(--style-radius-*)`);
      return;
    }
    for (const r of RULES) {
      if (!r.re.test(line)) continue;
      if (allowed(i)) continue;
      out.push(`${rel}:${i + 1}  [${r.id}] ${r.msg}`);
    }
  });
  if (isTsx) continue;
  // R5 needs the block head: innermost `head { body }` pairs over the comment-stripped text
  const blockRe = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = blockRe.exec(code))) {
    const head = m[1].split("}").pop() || "";
    if (/focus/.test(head)) continue;
    const bodyStart = m.index + m[1].length + 1;
    const rel2 = OUTLINE_FRAME.exec(m[2]);
    if (!rel2) continue;
    const ln = code.slice(0, bodyStart + rel2.index).split("\n").length;
    if (allowed(ln - 1)) continue;
    out.push(`${rel}:${ln}  [R5] outline jako rama (poza :focus) zamiast border z --style-border-surface`);
  }
}
process.stdout.write(out.join("\n"));
' "${CSS_FILES[@]}")

print_separator
if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | wc -l | tr -d ' ')
  print_error "Shape tokens FAILED — ${COUNT} violation(s):"
  echo ""
  echo "$VIOLATIONS"
  echo ""
  echo "Fix: read the role from tokens.css (--style-radius-*, --style-border-*,"
  echo "--style-label-case / --style-kicker-case). A deliberate exception needs"
  echo "/* shape-allow: <powód> */ on the line or up to 3 lines above."
  exit 1
fi
print_success "Shape tokens OK — every corner, line and label reads a --style-* role"
exit 0
