#!/usr/bin/env bash
# no-split-bg.sh — Guard against two-color section/card background splits.
#
# INTENT:
#   Owner 2026-08-19: pionowy (albo lustrzany lewy) pas drugiego koloru
#   na % szerokości hero/sekcji („dzielone tło") ucina copy, wychodzi
#   krzywo na różnych viewportach i czyta się jak AI slop. Sweep zdjął
#   home / pricing / help-center / legal / style-detail. Ten ratchet
#   nie pozwala wzorcowi wrócić.
#
# SIGNATURE (to, co agent kopiował jako „W6 backdrop"):
#   inset: 0 0 0 auto  (albo 0 auto 0 0)  +  width: <liczba>%  +  background
#   = pełnej wysokości pas koloru przyklejony do jednej krawędzi.
#
# KEEP (nie łapie):
#   Foto-panel (width: min(42vw, …) — ForClients FinalCta).
#   Progress fill (width: var(--limit-pct)).
#   Skeleton lines (width: 40% BEZ inset-pin do krawędzi).
#   Pełne ink/gold bandy (jednolity kolor całej sekcji — taste-owner #1).
#
# ESCAPE: `split-bg-allow: <reason>` w bloku albo do 3 linii nad nim.
#
# EXIT: 0 if PASS, 1 if any hit.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
UI_DIR="${ROOT}/main/src/UI"

print_boxed_header "No split two-color section backgrounds" "▦"

if [[ ! -d "$UI_DIR" ]]; then
  print_success "No main/src/UI — nothing to scan"
  exit 0
fi

declare -a CSS_FILES
mapfile -t CSS_FILES < <(find "$UI_DIR" -name "*.css" -type f \
  -not -path "*/playground/*" | sort)

print_header "Scanning ${#CSS_FILES[@]} UI stylesheets for %-width color splits"

VIOLATIONS=$(AUDIT_DIR_JS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" node -e '
const fs = require("fs");
const path = require("path");
const { parseBlocks, selectorOf } = require(path.join(process.env.AUDIT_DIR_JS, "_css-blocks.cjs"));
const files = process.argv.slice(1);
const ALLOW = /split-bg-allow:/;
const out = [];

const isSidePinnedPercentBand = (body) => {
  const insetPin =
    /inset:\s*0\s+0\s+0\s+auto(\b|;)/.test(body) ||
    /inset:\s*0\s+auto\s+0\s+0(\b|;)/.test(body);
  // Literal percentage only — var()/min()/clamp() are layout or progress.
  const percentWidth = /width:\s*\d+(\.\d+)?%(\b|;)/.test(body);
  const hasFill = /background(-color)?:/.test(body);
  return insetPin && percentWidth && hasFill;
};

// Parser ZNAKOWY ze wspolnego modulu — liczenie klamer per LINIA czynilo blok
// zapisany w jednej linii niewidzialnym dla straznika (falszywa zielen).
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (const blk of parseBlocks(text)) {
    const body = blk.body;
    // `head` niesie komentarz stojacy NAD blokiem — pewniejsze niz okno N linii.
    const allowNear =
      ALLOW.test(body) ||
      ALLOW.test(blk.head) ||
      blk.ancestors.some(a => ALLOW.test(a.head)) ||
      lines.slice(Math.max(0, blk.start - 4), blk.start).some(l => ALLOW.test(l));
    if (isSidePinnedPercentBand(body) && !allowNear) {
      out.push(`${file}:${blk.start}  [${selectorOf(blk) || "?"}]`);
    }
  }
}
process.stdout.write(out.join("\n"));
' "${CSS_FILES[@]}")

print_separator

if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | wc -l | tr -d ' ')
  print_error "No-split-bg FAILED — ${COUNT} two-color %-width band(s):"
  echo ""
  echo "$VIOLATIONS" | sed "s|${ROOT}/||"
  echo ""
  echo "Fix: drop the side band. Section/card keeps ONE solid background"
  echo "+ full hairline. Ink/gold full-bleed bands (whole section one color) stay."
  echo "Justified exception: /* split-bg-allow: <reason> */"
  exit 1
fi

print_success "No-split-bg passed — no %-width two-color section bands"
exit 0
