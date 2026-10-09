#!/usr/bin/env bash
# no-view-transition-api.sh — NVT: View Transitions API jest ZAKAZANE we froncie.
#
# INTENT:
#   NVT (PLAN_NAVIGATION_TRANSITIONS, 2026-07-08) zastąpił document.startViewTransition
#   + globalne ::view-transition-* CSS jednym FSM-owym kanałem animacji
#   (navigation.store + NavigationTransitionController + NavigationContentShell).
#   VT API animowało CAŁY dokument (root snapshot łapał fixed chrome: AppBar,
#   tabbar, drawer), wymagało flushSync w nav-callbacku i miało drugi kanał na
#   popstate — dokładnie ten dług, który NVT skasował. Powrót JAKIEGOKOLWIEK
#   użycia VT = regresja architektury przejść.
#
# RULE (structural, no baselines):
#   W main/src ZERO wystąpień:
#     1. `startViewTransition` (JS/TS — także optional-chained),
#     2. `::view-transition` (CSS pseudo-elementy old/new/root),
#     3. `flushSync` w plikach nawigacyjnych (layouts/ + application/routing/ +
#        application/stores/) — wymuszanie sync-renderu w nav-path było
#        artefaktem VT snapshotów.
#
# EXIT: 0 if no violations, 1 if found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC="${ROOT}/main/src"

print_header "NVT: no View Transitions API"

VIOLATIONS=""

# Comment-skip: only full comment lines (`//` / `*` / `/*` after indent) are
# excluded — trailing-comment tricks stay visible (FWE brand-literals lesson).
COMMENT_LINE='^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)'

# 1. startViewTransition anywhere in main/src (CODE lines).
HITS=$(grep -rn "startViewTransition" "$SRC" \
  --include='*.ts' --include='*.tsx' 2>/dev/null |
  grep -vE "$COMMENT_LINE" || true)
if [[ -n "$HITS" ]]; then
  VIOLATIONS+="${HITS}"$'\n'
fi

# 2. ::view-transition pseudo-elements in any stylesheet.
HITS=$(grep -rn "::view-transition" "$SRC" --include='*.css' 2>/dev/null || true)
if [[ -n "$HITS" ]]; then
  VIOLATIONS+="${HITS}"$'\n'
fi

# 3. flushSync in navigation-owned directories (CODE lines).
for DIR in "UI/layouts" "application/routing" "application/stores"; do
  HITS=$(grep -rn "flushSync" "${SRC}/${DIR}" \
    --include='*.ts' --include='*.tsx' 2>/dev/null |
    grep -v '\.test\.' | grep -vE "$COMMENT_LINE" || true)
  if [[ -n "$HITS" ]]; then
    VIOLATIONS+="${HITS}"$'\n'
  fi
done

VIOLATIONS=$(echo "$VIOLATIONS" | grep -v '^$' || true)

if [[ -n "$VIOLATIONS" ]]; then
  print_error "View Transitions API / flushSync-in-nav found (NVT forbids it):"
  echo "$VIOLATIONS"
  echo
  print_info "Transitions go through navigation.store + NavigationTransitionController."
  exit 1
fi

print_success "No View Transitions API usage in main/src"
exit 0
