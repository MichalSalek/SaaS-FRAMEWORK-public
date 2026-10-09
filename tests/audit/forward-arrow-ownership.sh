#!/usr/bin/env bash
# forward-arrow-ownership.sh — the forward arrow belongs to the button, never to its caller.
#
# RULE: a labelled button primitive (ButtonAtom, LinkButtonAtom: every exported
# component of main/src/UI/components/Button that takes a `direction` prop,
# DISCOVERED, not listed) must not be handed a forward glyph (ArrowRight,
# CaretRight and their framed siblings from Phosphor) through `icon=`, and must
# not draw one inside its label. The arrow is written `direction='forward'` and
# the primitive draws it after the label, in its own size, weight and gap.
# An icon-only button (no label) may be a bare arrow: nothing can sit on the
# wrong side of nothing.
#
# Why: until S126 the arrow was an `icon` plus a second prop saying which side.
# Eight forward CTAs forgot the second prop and rendered „→ Zatwierdź” (owner:
# „zwykły bug”); two more drew the arrow by hand inside the label with their own
# size and no gap. One prop that cannot be half-written removes the class.
#
# How: an AST scan (tests/audit/lib/forward-arrow-scan.cjs, TypeScript parser),
# so a prop broken across lines, an aliased import, a ternary inside the prop,
# a comment or a string quoting the wrong form all behave correctly.
#
# Scan root: main/src (.tsx, tests excluded). Presence floor: `direction='forward'`
# CALL SITES (not files). Escape: `// forward-arrow-allow: <reason>` in the file.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_REL="main/src"
BUTTON_REL="main/src/UI/components/Button"
SCANNER="$(cd "$(dirname "$0")" && pwd)/lib/forward-arrow-scan.cjs"

print_boxed_header "Forward arrow: drawn by the button primitive" "➡️"

require_source_dir "${ROOT}/${SRC_REL}" "main/src sources" "tsx"

if [[ ! -d "${ROOT}/${BUTTON_REL}" ]]; then
  print_error "Anchor missing: ${BUTTON_REL}"
  print_info "The button primitives moved — update this guard's anchor before trusting it."
  exit 1
fi
if [[ ! -f "${SCANNER}" ]]; then
  print_error "Scanner missing: ${SCANNER}"
  exit 1
fi

print_header "Scanning ${SRC_REL} for forward arrows placed by hand"

if ! SCAN="$(cd "${ROOT}" && node "${SCANNER}" "${SRC_REL}" "${BUTTON_REL}" 2>&1)"; then
  print_error "Scanner crashed — the guard does NOT guess a verdict"
  printf '%s\n' "${SCAN}" | sed 's/^/      /'
  exit 1
fi

PRIMITIVES="$(awk -F'\t' '$1 == "PRIMITIVE" { print $2 }' <<<"${SCAN}" | paste -sd' ' -)"
if [[ -z "${PRIMITIVES}" ]]; then
  print_error "No button primitive with a \`direction\` prop found in ${BUTTON_REL}"
  print_info "The prop was renamed or removed — this guard would be watching nothing."
  exit 1
fi

SITES="$(awk -F'\t' '$1 == "SITE"' <<<"${SCAN}" | wc -l | tr -d ' ')"
require_scanned "${SITES}" "direction='forward' call sites in ${SRC_REL}"

VIOLATIONS=0
ALLOWED=0

while IFS=$'\t' read -r kind file line tag glyph where; do
  [[ "${kind}" == "HIT" ]] || continue
  if grep -qE 'forward-arrow-allow:[[:space:]]*[^[:space:]*/]' "${ROOT}/${file}"; then
    ALLOWED=$((ALLOWED + 1))
    continue
  fi
  print_error "${file}:${line} — <${tag}> gets ${glyph} by hand (${where})"
  VIOLATIONS=$((VIOLATIONS + 1))
done <<<"${SCAN}"

if [[ "${VIOLATIONS}" -gt 0 ]]; then
  print_separator
  print_error "${VIOLATIONS} labelled button(s) carry a hand-placed forward arrow"
  print_info "Fix: remove the glyph and write direction='forward' on the button."
  print_info "Deliberate exception: // forward-arrow-allow: <reason>  (the reason is mandatory)"
  exit 1
fi

print_success "${SITES} forward call site(s) on ${PRIMITIVES}; no hand-placed arrow (${ALLOWED} documented exception(s))"
exit 0
