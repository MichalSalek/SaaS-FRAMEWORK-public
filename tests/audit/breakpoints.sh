#!/usr/bin/env bash
# breakpoints.sh — Punkty załamania pochodzą z zadeklarowanej siatki.
#
# INTENT (S99):
#   AGENTS.md deklaruje cztery progi (<480 base, >=480 SM, >=768 MD,
#   >=1024 LG, >=1280 XL), a census znalazł SZESNAŚCIE innych, w ~98
#   miejscach: 600, 640, 720, 860, 880, 900, 960, 968, 1000, 1100, 1400...
#   Skutek widać gołym okiem przy powolnej zmianie szerokości okna: sąsiadujące
#   sekcje przełamują się w różnych momentach, bo każda ma swój własny próg.
#   Nie jest to katastrofa na żadnej konkretnej szerokości — jest to brak rytmu
#   na wszystkich pośrednich.
#
# ŁAPIE: `@media (min-width: Npx)` / `(max-width: Npx)` z progiem spoza siatki.
#
# NIE ŁAPIE:
#   Progi kanoniczne 480 / 768 / 1024 / 1280 oraz ich komplementy o jeden
#   mniej (479 / 767 / 1023 / 1279), bo `max-width: 479px` to poprawne
#   dopełnienie `min-width: 480px`, a nie osobny próg.
#   Zapytania inne niż szerokościowe (hover, pointer, prefers-*, print).
#
# ESCAPE: `breakpoint-allow: <powód>` w komentarzu do 4 linii nad @media.
#   Uzasadniony wyjątek to taki, gdzie próg wynika z GEOMETRII konkretnego
#   komponentu (ramka telefonu, szerokość tabeli admina), a nie z układu strony.
#
# EXIT: 0 gdy liczba trafień <= BASELINE, 1 gdy urosła.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

# Ratchet. Migracja istniejących progów do siatki zmienia zachowanie
# responsywne, więc wymaga decyzji per przypadek — dlatego baseline, a nie zero.
BASELINE="${BREAKPOINTS_BASELINE:-74}"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/main/src"

print_boxed_header "Breakpoints come from the declared grid" "⿴"

if [[ ! -d "$SRC_DIR" ]]; then
  print_success "No main/src — nothing to scan"
  exit 0
fi

declare -a CSS_FILES
mapfile -t CSS_FILES < <(find "$SRC_DIR" -name "*.css" -type f | sort)

print_header "Scanning ${#CSS_FILES[@]} stylesheets for off-grid breakpoints"

VIOLATIONS=$(node -e '
const fs = require("fs");
const files = process.argv.slice(1);
const CANON = new Set([480, 479, 768, 767, 1024, 1023, 1280, 1279]);
const ALLOW = /breakpoint-allow:/;
const out = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (!/@media/.test(line)) return;
    // Komentarz-escape w tej samej linii albo do 4 linii wyżej.
    const near = lines.slice(Math.max(0, i - 4), i + 1).some((l) => ALLOW.test(l));
    if (near) return;
    for (const m of line.matchAll(/(min|max)-width:\s*(\d+)px/g)) {
      const px = parseInt(m[2], 10);
      if (CANON.has(px)) continue;
      out.push(`${file}:${i + 1}  ${m[1]}-width: ${px}px`);
    }
  });
}
process.stdout.write(out.join("\n"));
' "${CSS_FILES[@]}")

print_separator

COUNT=0
if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | wc -l | tr -d ' ')
fi

if [[ "$COUNT" -gt "$BASELINE" ]]; then
  print_error "Breakpoints FAILED — ${COUNT} off-grid breakpoint(s), baseline ${BASELINE}:"
  echo ""
  echo "$VIOLATIONS" | sed "s|${ROOT}/||" | head -30
  [[ "$COUNT" -gt 30 ]] && echo "  … i $((COUNT - 30)) więcej"
  echo ""
  echo "Fix: użyj progu z siatki — 480 / 768 / 1024 / 1280 (lub komplementu"
  echo "479 / 767 / 1023 / 1279 dla max-width)."
  echo "Próg wymuszony geometrią komponentu: /* breakpoint-allow: powód */"
  exit 1
fi

if [[ "$COUNT" -lt "$BASELINE" ]]; then
  print_warning "Breakpoints: ${COUNT} < baseline ${BASELINE} — ZACIŚNIJ baseline w tym pliku"
  exit 0
fi

print_success "Breakpoints passed — no new off-grid breakpoints"
exit 0
