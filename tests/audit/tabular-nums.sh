#!/usr/bin/env bash
# tabular-nums.sh — `tabular-nums` is an exception with a stated reason, never a reflex.
#
# RULE: every place that switches tabular figures on under main/src must carry
# `tnum-allow: <reason>` in a comment on the SAME line or within the two lines
# above it. A bare marker with no reason does not count.
#   CSS      — the value token `tabular-nums` (any `font-variant-numeric`
#              shorthand) or a quoted `tnum` (`font-feature-settings`). Matching
#              the TOKEN, not `property: value` on one line, keeps a declaration
#              that the formatter broke across lines visible.
#   TS / TSX — an inline `fontVariantNumeric` / `fontFeatureSettings` style value.
#              Only the property form: a registry description that merely names
#              the keyword in a sentence is prose, not a declaration.
#
# Why: in this product's typefaces the feature widens the period, comma, colon
# and semicolon to the width of a digit (measured S126: 25 → 64 units) and
# narrows `%`. The property is INHERITED, so one declaration on a container
# spaces out every date, time, price and e-mail under it ("14 : 32",
# "example . com"). S126 census: 110 declarations, 7 had a reason to exist
# (digits that change in place, or a column of integers); 103 were removed.
# The canon lives in a DECISION comment in main/src/UI/styles/global.css and in
# DESIGN.md §Style Policy 15.
#
# Scan root: main/src (.css, .ts, .tsx; tests excluded), comments stripped
# before matching so prose about the rule is not a violation. Presence floor:
# the DECISION anchor must exist and still name the marker, and the scan must
# see CSS files at all.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/main/src"
ANCHOR="${SRC_DIR}/UI/styles/global.css"

print_boxed_header "Tabular figures: only with a stated reason" "🔢"

require_source_dir "${SRC_DIR}" "main/src sources" "css"

if [[ ! -f "${ANCHOR}" ]]; then
  print_error "Anchor missing: ${ANCHOR#"${ROOT}/"}"
  print_info "The DECISION explaining this rule moved or was deleted — restore it before trusting this guard."
  exit 1
fi
if ! grep -q 'tnum-allow' "${ANCHOR}"; then
  print_error "${ANCHOR#"${ROOT}/"} no longer documents the tnum-allow rule (DECISION comment gone)"
  exit 1
fi

print_header "Scanning main/src for tabular figures without a reason"

mapfile -t CSS_FILES < <(find "${SRC_DIR}" -type f -name '*.css' | sort)
mapfile -t TS_FILES < <(find "${SRC_DIR}" -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -name '*.test.ts' ! -name '*.test.tsx' ! -path '*/READONLY-shared-kernel/*' | sort)

require_scanned "${#CSS_FILES[@]}" "CSS files under main/src"

# Match sites in CODE (comments blanked, line numbers preserved).
HITS="$(
  grep_code_stripped 'tabular-nums|["\x27]tnum["\x27]' "${CSS_FILES[@]}" || true
  grep_code_stripped '(fontVariantNumeric\s*:\s*["\x27`][^"\x27`]*tabular-nums|fontFeatureSettings\s*:\s*["\x27`][^`]*tnum)' "${TS_FILES[@]}" || true
)"

VIOLATIONS=0
ALLOWED=0

while IFS= read -r hit; do
  [[ -z "$hit" ]] && continue
  file="${hit%%:*}"
  rest="${hit#*:}"
  line="${rest%%:*}"
  # The reason sits in a comment, which the stripped view no longer shows:
  # read the raw lines (the match and the two above it, for a declaration the
  # formatter broke after the colon).
  prev=$((line > 2 ? line - 2 : 1))
  context="$(sed -n "${prev},${line}p" "$file")"
  if grep -qE 'tnum-allow:[[:space:]]*[^[:space:]*/]' <<<"$context"; then
    ALLOWED=$((ALLOWED + 1))
    continue
  fi
  print_error "${file#"${ROOT}/"}:${line} — tabular figures without a tnum-allow reason"
  VIOLATIONS=$((VIOLATIONS + 1))
done <<<"$HITS"

if [[ "${VIOLATIONS}" -gt 0 ]]; then
  print_separator
  print_error "${VIOLATIONS} declaration(s) switch tabular figures on without a reason"
  print_info "The feature widens . , : ; to a digit's width and is inherited: remove it unless the text is"
  print_info "digits only AND changes in place (or is a column of integers)."
  print_info "Legitimate use: /* tnum-allow: <reason> */ on the same line or the line above."
  exit 1
fi

print_success "${ALLOWED} documented use(s) of tabular figures, none without a reason (${#CSS_FILES[@]} CSS + ${#TS_FILES[@]} TS files scanned)"
exit 0
