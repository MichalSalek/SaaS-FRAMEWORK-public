#!/usr/bin/env bash
# layout-consistency.sh — Guard the single "who mounts the layout" pattern.
#
# INTENT (FDX FAZA 4 / W4.3 — closed decision):
#   In this Pages-Router frontend the FEATURE COMPONENT carries its own layout.
#   A page-shell (src/pages/**) is a THIN delegator: it owns data fetching
#   (getStaticProps), SEO (<PublicSeoHead>) and structured data (<JsonLd>),
#   then renders ONE feature component. The layout primitive (AppLayout /
#   PublicLayout / AdminLayout / AdminPageLayout) is mounted INSIDE that feature
#   component — never in the shell. This is the documented canon
#   (main/src/UI/UI_ARCHITECTURE.md §Layout — "who carries the layout").
#
#   The Next.js per-page `Page.getLayout = ...` convention is deliberately NOT
#   used (it splits layout ownership between _app.tsx and every page, and our
#   _app.tsx provider tree is already the single composition root).
#
# WHAT IT CHECKS:
#   1. No file under main/src/pages/** imports a layout primitive. If a shell
#      re-imports AppLayout/PublicLayout/AdminLayout/AdminPageLayout it has
#      re-grown the page-carries-layout deviation we just unified away — the
#      layout belongs in the feature component it renders.
#   2. No `getLayout` per-page-layout pattern anywhere in main/src (pages or
#      features) — the forbidden Next.js convention.
#
# WHY STRUCTURAL (nothing here rots):
#   No counters, no baselines. The rule is "pages don't import layouts" and
#   "getLayout doesn't exist". A new violation = a new import line or a new
#   getLayout assignment, both visible in review.
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
PAGES_DIR="${ROOT}/main/src/pages"
MAIN_SRC="${ROOT}/main/src"

print_boxed_header "Layout consistency: feature carries the layout" "🧱"

if [[ ! -d "$PAGES_DIR" ]]; then
  print_info "No pages dir — nothing to audit"
  exit 0
fi

VIOLATIONS=0

# ─── CHECK 1: page-shells must NOT import a layout primitive ──────────────────

print_header "Check 1: no layout import inside page-shells (src/pages/**)"

# Layout primitives that belong in feature components, never in a thin shell.
# Matches imports like:
#   import { PublicLayoutComposition } from '.../layouts/PublicLayout.composition';
#   import { AppLayoutComposition } from '.../layouts/AppLayout.composition';
# DECISION (nie usuwaj tego komentarza): the exported symbols are suffixed
# (AppLayoutComposition, PublicLayoutComposition, AdminLayoutComposition,
# AdminPageLayoutComposition) — the old `\b…\b` end-anchor missed them. Use a
# `\w*` tail so the bare and suffixed names both match. Non-primitive layouts/
# exports (e.g. NativeBackBridgeComposition in _app.tsx) stay un-matched.
LAYOUT_IMPORT_RE="import[[:space:]].*\{[^}]*\b(AppLayout|PublicLayout|AdminLayout|AdminPageLayout)\w*[^}]*\}[[:space:]]*from[[:space:]].*layouts/"

# Allowlist — page-shell paths (relative to ROOT) permitted to mount a layout
# directly. Empty by design: after the W4.3 unification every shell delegates
# layout ownership to its feature component. Add an entry here ONLY with a
# DECISION comment in the file explaining why the shell must own the layout.
SHELL_LAYOUT_ALLOWLIST=()

CHECK1_HITS=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"

  SKIP=0
  for allowed in "${SHELL_LAYOUT_ALLOWLIST[@]+"${SHELL_LAYOUT_ALLOWLIST[@]}"}"; do
    if [[ "$REL_PATH" == "$allowed" ]]; then
      SKIP=1
      break
    fi
  done
  [[ "$SKIP" -eq 1 ]] && continue

  if grep -qP "$LAYOUT_IMPORT_RE" "$file" 2>/dev/null; then
    LINES=$(grep -nP "$LAYOUT_IMPORT_RE" "$file" | cut -d: -f1 | sort -u | tr '\n' ',' | sed 's/,$//')
    CHECK1_HITS="${CHECK1_HITS}${REL_PATH}:${LINES}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION — page-shell imports a layout: ${REL_PATH} (line ${LINES})"
    print_info  "  Fix: move <Layout> into the feature component this shell renders;"
    print_info  "       the shell keeps only getStaticProps + <PublicSeoHead> + <JsonLd>."
  fi
# DECISION (nie usuwaj tego komentarza): anchored /out/ /dist/ — bare "out"/"dist"
# are unanchored substrings that silently eat any path containing routing/layouts/
# logout/about (e.g. pages/app/checkout/, routing/). Anchored form matches only
# real build-output dirs, same as sibling audits.
done < <(find "$PAGES_DIR" -type f \( -name "*.tsx" -o -name "*.ts" \) -print0 2>/dev/null \
  | grep -zv "node_modules\|\.next\|/out/\|/dist/")

if [[ -z "$CHECK1_HITS" ]]; then
  print_success "No page-shell imports a layout primitive — feature components carry layout"
fi

print_separator

# ─── CHECK 2: no getLayout per-page-layout convention ────────────────────────

print_header "Check 2: no Next.js getLayout per-page-layout pattern"

# Matches:
#   SomePage.getLayout = ...
#   getLayout?: (page: ReactElement) => ...
#   NextPageWithLayout / { getLayout } typings
GETLAYOUT_RE="\bgetLayout\b"

CHECK2_HITS=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"

  if grep -qP "$GETLAYOUT_RE" "$file" 2>/dev/null; then
    LINES=$(grep -nP "$GETLAYOUT_RE" "$file" | cut -d: -f1 | sort -u | tr '\n' ',' | sed 's/,$//')
    CHECK2_HITS="${CHECK2_HITS}${REL_PATH}:${LINES}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION — getLayout pattern found: ${REL_PATH} (line ${LINES})"
    print_info  "  Fix: the feature component renders its own <Layout> directly."
    print_info  "       getLayout (split _app.tsx/page ownership) is not used here."
  fi
# DECISION (nie usuwaj tego komentarza): anchored /out/ /dist/ (patrz Check 1).
done < <(find "$MAIN_SRC" -type f \( -name "*.tsx" -o -name "*.ts" \) -print0 2>/dev/null \
  | grep -zv "node_modules\|\.next\|/out/\|/dist/")

if [[ -z "$CHECK2_HITS" ]]; then
  print_success "No getLayout per-page-layout pattern found"
fi

print_separator

# ─── Result ──────────────────────────────────────────────────────────────────

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "layout-consistency audit FAILED — ${VIOLATIONS} violation(s) found"
  echo ""
  exit 1
fi

print_success "layout-consistency audit PASSED — one consistent 'who carries the layout' pattern"
exit 0
