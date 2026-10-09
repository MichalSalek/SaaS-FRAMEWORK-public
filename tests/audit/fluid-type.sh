#!/usr/bin/env bash
# fluid-type.sh — Rozmiar płynny pochodzi ze skali, nie z własnego clamp().
#
# INTENT (S99):
#   Census znalazł 219 deklaracji `font-size: clamp()` w 124 RÓŻNYCH zapisach.
#   Sam nagłówek sekcji miał czterdzieści jeden wariantów (24->36, 24->38,
#   26->36, 24->34, 28->36…). Nikt nie wybierał świadomie 3.4vw zamiast 3.6vw
#   dla dwóch sąsiednich sekcji — to dryf, który widać dopiero wtedy, gdy takie
#   nagłówki staną obok siebie. 185 z nich zeszło na osiem stopni
#   `--text-fluid-*`; ten strażnik pilnuje, żeby nowe nie dosypywały.
#
# ŁAPIE: `font-size: clamp(...)` zapisane wprost w module, zamiast tokenu.
#
# NIE ŁAPIE:
#   `font-size: var(--text-fluid-*)` — to jest właśnie cel.
#   Skala w `tokens.css` (tam clamp MA prawo stać — to jego definicja).
#   Deklaracje z `fluid-allow:` — świadomie inny rozmiar (licznik odliczania,
#   figura wychodząca poza skalę). Wymaga powodu w komentarzu.
#
# ESCAPE: /* fluid-allow: dlaczego ten rozmiar nie jest stopniem skali */
#
# EXIT: 0 gdy liczba trafień <= BASELINE, 1 gdy urosła.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

# Ratchet ZACIŚNIĘTY DO ZERA (S104). Poprzednio 33 — tyle deklaracji zostało po
# S99 poza skalą, ale ANONIMOWO: baseline przepuszczał je hurtem, więc kolejna
# mogła dojść bez śladu. Teraz każda z nich niesie `fluid-allow:` z powodem
# (figura wychodząca poza skalę, poziom pośredni dobrany do długości frazy),
# a dwa klastry, które różniły się wyłącznie współczynnikiem vw przy tych
# samych krańcach (22→30 ×10, 18→22 ×3), dostały nazwy: `--text-fluid-subhead`
# i `--text-fluid-panel-title`. Zero znaczy: nowy własny clamp wymaga zdania
# uzasadnienia, nie miejsca w liczniku.
BASELINE="${FLUID_TYPE_BASELINE:-0}"

ROOT="$(get_project_root)"
UI_DIR="${ROOT}/main/src"

print_boxed_header "Fluid type comes from the scale" "◍"

if [[ ! -d "$UI_DIR" ]]; then
  print_success "No main/src — nothing to scan"
  exit 0
fi

declare -a CSS_FILES
mapfile -t CSS_FILES < <(find "$UI_DIR" -name "*.module.css" -type f | sort)

print_header "Scanning ${#CSS_FILES[@]} CSS modules for hand-rolled font-size clamps"

VIOLATIONS=$(node -e '
const fs = require("fs");
const files = process.argv.slice(1);
const out = [];
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!/font-size\s*:\s*clamp\(/.test(line)) return;
    const near = lines.slice(Math.max(0, i - 4), i + 1).some((l) => /fluid-allow:/.test(l));
    if (near) return;
    out.push(`${file}:${i + 1}  ${line.trim().slice(0, 70)}`);
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
  print_error "Fluid-type FAILED — ${COUNT} własnych clamp(), baseline ${BASELINE}:"
  echo ""
  echo "$VIOLATIONS" | sed "s|${ROOT}/||" | head -25
  [[ "$COUNT" -gt 25 ]] && echo "  … i $((COUNT - 25)) więcej"
  echo ""
  echo "Fix: weź stopień ze skali --text-fluid-* (main/src/UI/styles/tokens.css):"
  echo "xs 14-16 · sm 15-17 · md 16-20 · lg 20-26 · xl 24-36 · 2xl 30-48"
  echo "3xl 40-72 · display 48-96."
  echo "Rozmiar świadomie spoza skali: /* fluid-allow: powód */"
  exit 1
fi

if [[ "$COUNT" -lt "$BASELINE" ]]; then
  print_warning "Fluid-type: ${COUNT} < baseline ${BASELINE} — ZACIŚNIJ baseline w tym pliku"
  exit 0
fi

print_success "Fluid-type passed — no new hand-rolled font-size clamps"
exit 0
