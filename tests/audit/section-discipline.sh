#!/usr/bin/env bash
# section-discipline.sh — Enforce <Section> adoption (no new manual full-bleed bands).
#
# INTENT:
#   components/Section is the single source of the LP full-bleed band
#   (width:100vw + margin-left:calc(50% - 50vw) + padding + subtle tone +
#   hairline frame). After the 2026-06 adoption migration NO page styles in
#   main/src/UI/features may hand-roll that breakout — a new occurrence means
#   a section grew its own band again (the drift that caused border-kwiatki
#   and 10 divergent copies of the same plumbing). This audit fails on any
#   breakout declaration outside the allowed structural slots.
#
# RULE (structural, no counters/baselines — nothing here rots):
#   A line containing `calc(50% - 50vw)` / `calc(-50vw + 50%)` in
#   main/src/UI/features/**/*.module.css is legal ONLY when:
#     1. its CSS block selector is `.page` or starts with `.hero`
#        (page shells / heroes are deliberately manual — custom geometry), OR
#     2. an explanatory opt-out comment `section-discipline-allow: <reason>`
#        appears inside the block or up to 3 lines above the declaration.
#        New exceptions live IN the code next to the declaration (visible in
#        review), never in a central list.
#
# SCOPE: features/** only. Excluded:
#   - features/playground/** (experimental variants)
#   - features/shared/**     (shared molecules legitimately own their bands,
#                             e.g. ReviewsSection — same status as components/)
#   components/ and layouts/ are not scanned: molecules (Section, FinalCtaBand,
#   LpHero) own the canonical breakout by design.
#
# EXIT: 0 if no violations, 1 if found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
FEATURES_DIR="${ROOT}/main/src/UI/features"

print_boxed_header "Section discipline: no manual full-bleed bands" "📐"

if [[ ! -d "$FEATURES_DIR" ]]; then
  print_info "No features dir — nothing to audit"
  exit 0
fi

declare -a CSS_FILES
mapfile -t CSS_FILES < <(find "$FEATURES_DIR" -name "*.module.css" -type f \
  -not -path "*/playground/*" -not -path "*/shared/*" | sort)

print_header "Scanning ${#CSS_FILES[@]} page stylesheets for manual breakouts"

VIOLATIONS=$(AUDIT_DIR_JS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" node -e '
const fs = require("fs");
const path = require("path");
const { parseBlocks, selectorOf } = require(path.join(process.env.AUDIT_DIR_JS, "_css-blocks.cjs"));
const files = process.argv.slice(1);
const BREAKOUT = /calc\(\s*50%\s*-\s*50vw\s*\)|calc\(\s*-50vw\s*\+\s*50%\s*\)/;
const ALLOW = /section-discipline-allow:/;
const out = [];

// Parser ZNAKOWY ze wspolnego modulu. Liczenie klamer per LINIA nie tylko gubilo
// naruszenia w blokach jednoliniowych — tutaj dawalo CZERWIEN Z NIEWLASCIWEGO
// POWODU: selektor takiego bloku nigdy nie trafial na stos, wiec dozwolony slot
// `.page`/`.hero` nie mial jak sie dopasowac i legalny breakout hero byl zglaszany.
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  const blocks = parseBlocks(text);
  const lineOfIdx = idx => text.slice(0, idx).split("\n").length;
  const re = new RegExp(BREAKOUT.source, "g");
  let m;
  while ((m = re.exec(text))) {
    const idx = m.index;
    // Blok NAJGLEBSZY zawierajacy to wystapienie — po nim idziemy w gore po
    // przodkach, szukajac pierwszego naglowka, ktory nie jest @-regula.
    let inner = null;
    for (const b of blocks) {
      const end = b.bodyStart + b.body.length;
      if (idx >= b.bodyStart && idx < end) {
        if (!inner || b.bodyStart > inner.bodyStart) inner = b;
      }
    }
    if (!inner) continue;
    const chain = [...inner.ancestors, inner].map(selectorOf);
    const sel = [...chain].reverse().find(h => h && !h.startsWith("@")) || "";
    const shellOk = /(^|,)\s*\.(page|hero)/.test(sel);
    const ln = lineOfIdx(idx);
    // `head` to tekst od konca poprzedniej reguly do klamry, wiec zawiera
    // komentarz stojacy NAD blokiem — tam wlasnie zyje wiekszosc wyjatkow.
    // Oryginal lapal to stanem trzymanym az do zamkniecia bloku; okno N linii
    // by nie wystarczylo, bo escape bywa rozbity na trzy linie.
    const nearAllow =
      ALLOW.test(inner.body) ||
      ALLOW.test(inner.head) ||
      inner.ancestors.some(a => ALLOW.test(a.head) || ALLOW.test(a.body)) ||
      lines.slice(Math.max(0, ln - 4), ln).some(l => ALLOW.test(l));
    if (!shellOk && !nearAllow) {
      out.push(`${file}:${ln}  [${sel || "?"}]`);
    }
  }
}
process.stdout.write(out.join("\n"));
' "${CSS_FILES[@]}")

print_separator

if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | wc -l | tr -d ' ')
  print_error "Section discipline FAILED — ${COUNT} manual breakout(s) outside .page/.hero:"
  echo ""
  echo "$VIOLATIONS" | sed "s|${ROOT}/||"
  echo ""
  echo "Fix (pick one):"
  echo "  1. Use the <Section> composition (components/Section) instead of"
  echo "     hand-rolling width:100vw + margin-left:calc(50% - 50vw)."
  echo "  2. If the band is structurally un-migratable (asymmetric padding,"
  echo "     grid-band, half-bleed), add a comment next to the declaration:"
  echo "     /* section-discipline-allow: <reason> */"
  exit 1
fi

print_success "Section discipline passed — no manual full-bleed bands outside shells"
exit 0
