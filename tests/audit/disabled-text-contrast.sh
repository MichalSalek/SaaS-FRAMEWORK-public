#!/usr/bin/env bash
# disabled-text-contrast.sh — Keep --color-text-disabled OFF readable text (WCAG AA).
#
# INTENT:
#   --color-text-disabled (#aaa light / #444 dark) renders at ~2:1 contrast — it
#   FAILS WCAG AA for text and is WCAG-exempt ONLY on genuinely disabled UI.
#   S29 fixed `::placeholder` uses but left ~44 informational-text uses (empty
#   states, metadata, dates, counts, labels, hints, breadcrumbs) painting
#   readable copy at a failing ratio. S31/S32 swept them to --color-text-muted
#   (#6e6e6e / #909090 ≈ 5:1, AA-safe). This audit stops the regression: any new
#   `color: var(--color-text-disabled)` on text must be either genuinely-disabled
#   UI or carry an explicit opt-out comment.
#
# RULE (structural, no counters/baselines):
#   A `color: var(--color-text-disabled)` declaration in main/src/UI/**/*.module.css
#   is a VIOLATION unless:
#     1. an enclosing selector marks genuinely-disabled UI
#        (:disabled / [disabled] / [aria-disabled / a `disabled`/`Disabled`
#        class), OR
#     2. an explanatory opt-out comment `text-disabled-allow: <reason>` appears
#        in the block or up to 3 lines above (decorative separators, icon
#        affordances, semantic null/unknown dimming live IN the code next to the
#        declaration, never in a central list).
#
#   Readable, de-emphasized text uses --color-text-muted (the AA-safe token).
#
#   ONLY the `color:` property is checked. `background: color-mix(... )` tints,
#   scrollbar thumbs, skeleton fills and scoped `--color-text-disabled:` token
#   redefinitions are NOT text and are left alone.
#
# SCOPE: main/src/UI/**/*.module.css (features + components + layouts).
#   Excluded: features/playground/** (experimental).
#
# EXIT: 0 if no violations, 1 if found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
UI_DIR="${ROOT}/main/src/UI"

print_boxed_header "Disabled-text contrast: --color-text-disabled off readable text" "🔅"

if [[ ! -d "$UI_DIR" ]]; then
  print_info "No UI dir — nothing to audit"
  exit 0
fi

declare -a CSS_FILES
mapfile -t CSS_FILES < <(find "$UI_DIR" -name "*.module.css" -type f \
  -not -path "*/playground/*" | sort)

print_header "Scanning ${#CSS_FILES[@]} stylesheets for disabled-token text color"

VIOLATIONS=$(AUDIT_DIR_JS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" node -e '
const fs = require("fs");
const path = require("path");
const { parseBlocks, selectorOf } = require(path.join(process.env.AUDIT_DIR_JS, "_css-blocks.cjs"));
const files = process.argv.slice(1);
const ALLOW = /text-disabled-allow:/;
// `color: var(--color-text-disabled)` as a TEXT color (not background, not a
// `--color-text-disabled:` redefinition, not color-mix tint).
const TEXT_DISABLED = /(^|[;{\s])color:\s*var\(--color-text-disabled\)/;
// DECISION (nie usuwaj tego komentarza): the broad bare-substring `disabled`/`Disabled`
//   exemption is INTENTIONAL and is NOT anchored to `:disabled`/`[disabled]` pseudos.
//   This codebase styles disabled STATE via CLASSES, not just pseudos — real ones today:
//   .disabled, .isDisabled, .footerDisabled, .statusDisabled, .bulkBarDisabled,
//   .stylistRowDisabled. A pseudo-only anchor would FALSE-POSITIVE on legit class-based
//   disabled UI. Accepted theoretical gap: a non-state selector merely MENTIONING the
//   word (e.g. a hypothetical `.disabledNote` that is readable copy, not a state) would
//   be wrongly exempted — none exist today (verified: every `*disabled*` class in
//   main/src/UI/**/*.module.css is a genuine disabled-state class). Keep the substring
//   match; if such a non-state word ever appears, exclude it here explicitly.
const DISABLED_SEL = /:disabled|\[disabled|\[aria-disabled|aria-disabled|disabled|Disabled/;
const out = [];

// Parser ZNAKOWY ze wspolnego modulu. Poprzednia wersja liczyla klamry per LINIA,
// wiec blok zapisany w JEDNEJ linii mial `opens === closes` i byl dla straznika
// CALKOWICIE niewidzialny — falszywa zielen nad realnym naruszeniem.
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (const blk of parseBlocks(text)) {
    const sel = selectorOf(blk);
    const body = blk.body;
    if (!TEXT_DISABLED.test(body)) continue;
    // genuinely-disabled UI anywhere on the selector stack → exempt
    const disabledUi =
      DISABLED_SEL.test(sel) || blk.ancestors.some(a => DISABLED_SEL.test(selectorOf(a)));
    // `head` niesie komentarz stojacy NAD blokiem — pewniejsze niz okno N linii,
    // ktore gubi escape rozbity na kilka linii.
    const allowNear =
      ALLOW.test(body) ||
      ALLOW.test(blk.head) ||
      blk.ancestors.some(a => ALLOW.test(a.head)) ||
      lines.slice(Math.max(0, blk.start - 4), blk.start).some(l => ALLOW.test(l));
    if (!disabledUi && !allowNear) {
      out.push(`${file}:${blk.start}  [${sel || "?"}]`);
    }
  }
}
process.stdout.write(out.join("\n"));
' "${CSS_FILES[@]}")

print_separator

if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | wc -l | tr -d ' ')
  print_error "Disabled-text contrast FAILED — ${COUNT} readable-text use(s) of --color-text-disabled:"
  echo ""
  echo "$VIOLATIONS" | sed "s|${ROOT}/||"
  echo ""
  echo "Fix (pick one):"
  echo "  1. Readable de-emphasized text → use var(--color-text-muted) (AA-safe)."
  echo "  2. Genuinely-disabled UI → put it on a :disabled / [disabled] selector."
  echo "  3. Decorative separator / icon / null-state dim → add a comment in or"
  echo "     above the block: /* text-disabled-allow: <reason> */"
  exit 1
fi

print_success "Disabled-text contrast passed — no readable text on --color-text-disabled"
exit 0
