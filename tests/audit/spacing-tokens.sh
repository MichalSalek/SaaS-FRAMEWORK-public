#!/usr/bin/env bash
# spacing-tokens.sh — Odstępy pochodzą ze skali, nie z klawiatury.
#
# INTENT (S99):
#   Census 174 modułów znalazł ~1550 surowych wartości px w propertach
#   odstępu. To nie było niedbalstwo: skala `--sp-0..9` miała dziury tak
#   duże, że NAJCZĘSTSZY odstęp w produkcie (6px, 221 użyć) nie miał tokenu.
#   Skala została przebudowana na px-based `--space-*` (tokens.css), a ten
#   strażnik pilnuje, żeby dziury nie odrosły. Bez niego tydzień nowego kodu
#   i znowu mamy wysyp liczb, a sąsiadujące karty rozjeżdżają się o 2px.
#
# ŁAPIE: surowy px w margin / padding / gap / inset (także w skrótach
#   `padding: 8px 12px` i w wariantach -inline / -block / -top itd.).
#
# NIE ŁAPIE (legalne):
#   0 i 0px            — reset, nie odstęp.
#   1px / -1px         — hairline i jego kompensacja, nie element skali.
#   %, em, rem, ch, vw, vh, auto, calc(), var(), min/max/clamp()
#                      — miary względne i wyliczane rządzą się swoim.
#   `optical:` w bloku albo do 4 linii nad nim — jawna korekta optyczna
#                        (wyrównanie glifu, offset ikony). Skala ma stopnie
#                        co 2px w małym zakresie; jeśli któryś nie pasuje,
#                        to jest optyka i ma być NAZWANA, nie przemycona.
#
# ESCAPE: /* optical: dlaczego akurat ta wartość */
#
# EXIT: 0 gdy liczba trafień <= BASELINE, 1 gdy urosła.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

# Ratchet DOMKNIĘTY na zerze (S99b): po zaokrągleniu ogona sub-gridu każdy
# surowy px w odstępie jest błędem, nie długiem. Wartość świadomie spoza skali
# przechodzi wyłącznie przez `optical:` z powodem.
BASELINE="${SPACING_TOKENS_BASELINE:-0}"

ROOT="$(get_project_root)"
UI_DIR="${ROOT}/main/src"

print_boxed_header "Spacing comes from the scale" "◫"

if [[ ! -d "$UI_DIR" ]]; then
  print_success "No main/src — nothing to scan"
  exit 0
fi

declare -a CSS_FILES
mapfile -t CSS_FILES < <(find "$UI_DIR" -name "*.module.css" -type f | sort)

print_header "Scanning ${#CSS_FILES[@]} CSS modules for raw px spacing"

VIOLATIONS=$(AUDIT_DIR_JS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" node -e '
const fs = require("fs");
const path = require("path");
const { parseBlocks, selectorOf } = require(path.join(process.env.AUDIT_DIR_JS, "_css-blocks.cjs"));
const files = process.argv.slice(1);
const ALLOW = /optical:/;
const out = [];

// Property odstępu: margin/padding (+ wszystkie warianty kierunkowe), gap, inset.
// `top/left/...` celowo POZA zakresem — tam liczba bywa pozycją, nie odstępem.
const SPACING_PROP =
  /^(margin|padding)(-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$|^(row-|column-)?gap$|^inset(-(inline|block)(-(start|end))?)?$/;

// Wartość legalna mimo px: 0, hairline 1px i jego kompensacja.
const isBenign = (px) => px === 0 || Math.abs(px) === 1;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (const blk of parseBlocks(text)) {
    const allowNear =
      ALLOW.test(blk.body) ||
      ALLOW.test(blk.head) ||
      blk.ancestors.some((a) => ALLOW.test(a.head)) ||
      lines.slice(Math.max(0, blk.start - 5), blk.start).some((l) => ALLOW.test(l));
    if (allowNear) continue;

    // Komentarze precz — hex ani px w komentarzu nie są deklaracją.
    const body = blk.body.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const decl of body.split(";")) {
      const d = decl.trim();
      if (!d || d.includes("{")) continue;
      const m = d.match(/^([-a-zA-Z]+)\s*:\s*([\s\S]+)$/);
      if (!m) continue;
      const [, prop, valueRaw] = m;
      if (!SPACING_PROP.test(prop)) continue;
      const value = valueRaw.replace(/\s+/g, " ").trim();
      // var()/calc()/clamp() itd. — wartość pochodzi skądinąd, nie oceniamy.
      if (/\b(var|calc|clamp|min|max|env)\s*\(/.test(value)) continue;
      const pxs = [...value.matchAll(/(?:^|[\s(,])(-?\d*\.?\d+)px/g)].map((x) => parseFloat(x[1]));
      const bad = pxs.filter((px) => !isBenign(px));
      if (bad.length) {
        out.push(`${file}:${blk.start}  [${selectorOf(blk) || "?"}]  ${prop}: ${value}`);
      }
    }
  }
}
process.stdout.write(out.join("\n"));
' "${CSS_FILES[@]}")

# Stara skala porządkowa jest usunięta z tokens.css, więc każde jej użycie jest
# od teraz WIDMEM (niezdefiniowany var w skrócie kasuje całą deklarację).
# Osobny, bezwarunkowy check — nie podlega baseline'owi.
LEGACY=$(grep -rn "var(--sp-[0-9])" "$UI_DIR" --include="*.css" --include="*.tsx" 2>/dev/null || true)
if [[ -n "$LEGACY" ]]; then
  print_error "Spacing-tokens FAILED — stara skala --sp-* wróciła (jest USUNIĘTA, więc to widmo):"
  echo "$LEGACY" | sed "s|${ROOT}/||" | head -20
  echo ""
  echo "Fix: użyj --space-<px>. Mapowanie: sp-0=4 sp-1=8 sp-2=12 sp-3=20"
  echo "sp-4=32 sp-5=48 sp-6=64 sp-7=80 sp-8=96 sp-9=128"
  exit 1
fi

print_separator

COUNT=0
if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | wc -l | tr -d ' ')
fi

if [[ "$COUNT" -gt "$BASELINE" ]]; then
  print_error "Spacing-tokens FAILED — ${COUNT} raw px spacing value(s), baseline ${BASELINE}:"
  echo ""
  echo "$VIOLATIONS" | sed "s|${ROOT}/||" | head -40
  [[ "$COUNT" -gt 40 ]] && echo "  … i $((COUNT - 40)) więcej"
  echo ""
  echo "Fix: weź stopień ze skali --space-* (main/src/UI/styles/tokens.css)."
  echo "Skala idzie co 2px do 16, co 4px do 48, co 8px do 96, potem co 16px."
  echo "Wartość spoza skali, która jest korektą optyczną: /* optical: powód */"
  exit 1
fi

if [[ "$COUNT" -lt "$BASELINE" ]]; then
  print_warning "Spacing-tokens: ${COUNT} < baseline ${BASELINE} — ZACIŚNIJ baseline w tym pliku"
  exit 0
fi

print_success "Spacing-tokens passed — every spacing value comes from the scale"
exit 0
