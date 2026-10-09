#!/usr/bin/env bash
# navigation-transition-ssot.sh — NVT: FSM store = SSOT stanu przejść.
#
# INTENT:
#   NVT skasował navDirection.store (lastHookNavTs, openPopstateTransition,
#   historyIndex) i rozproszone zapisy data-nav-direction z dwóch miejsc.
#   Stan przejścia żyje WYŁĄCZNIE w navigation.store; DOM-atrybuty
#   html[data-nav-*] pisze WYŁĄCZNIE NavigationTransitionController.
#   Odtworzenie któregokolwiek reliktu = drugi kanał prawdy = race/flicker.
#
# RULE (structural, no baselines):
#   W main/src ZERO wystąpień:
#     1. reliktów: `lastHookNavTs`, `openPopstateTransition`,
#        `useNavDirectionStore`, `navDirection.store`,
#     2. JS-owych ZAPISÓW kierunku/fazy poza kontrolerem:
#        `dataset['navDirection']` / `dataset.navDirection` /
#        `dataset['navPhase']` / `dataset.navPhase` /
#        `dataset['navPolicy']` / `dataset.navPolicy` /
#        `setAttribute('data-nav-` —
#        allowlist: NavigationTransitionController.composition.tsx + *.test.*.
#   CSS może CZYTAĆ selektory [data-nav-*] dowolnie (to konsument, nie writer).
#
# EXIT: 0 if no violations, 1 if found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC="${ROOT}/main/src"
OWNER="UI/layouts/NavigationTransitionController.composition.tsx"

print_header "NVT: navigation transition SSOT"

VIOLATIONS=""

# Comment-skip: only full comment lines (`//` / `*` / `/*` after indent) are
# excluded — trailing-comment tricks stay visible (FWE brand-literals lesson).
COMMENT_LINE='^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)'

# 1. Relics of the pre-NVT dual-channel system (CODE lines).
HITS=$(grep -rn "lastHookNavTs\|openPopstateTransition\|useNavDirectionStore\|navDirection\.store" \
  "$SRC" --include='*.ts' --include='*.tsx' 2>/dev/null |
  grep -vE "$COMMENT_LINE" || true)
if [[ -n "$HITS" ]]; then
  VIOLATIONS+="${HITS}"$'\n'
fi

# 2. nav-attr WRITES outside the controller (tests may stub them).
HITS=$(grep -rn "dataset\[.navDirection.\]\|dataset\.navDirection\|dataset\[.navPhase.\]\|dataset\.navPhase\|dataset\[.navPolicy.\]\|dataset\.navPolicy\|setAttribute(.data-nav-" \
  "$SRC" --include='*.ts' --include='*.tsx' 2>/dev/null |
  grep -v "/${OWNER}:" |
  grep -v '\.test\.' |
  grep -vE "$COMMENT_LINE" || true)
if [[ -n "$HITS" ]]; then
  VIOLATIONS+="${HITS}"$'\n'
fi

VIOLATIONS=$(echo "$VIOLATIONS" | grep -v '^$' || true)

if [[ -n "$VIOLATIONS" ]]; then
  print_error "Navigation-transition SSOT violation (relic or out-of-controller write):"
  echo "$VIOLATIONS"
  echo
  print_info "State lives in navigation.store; html[data-nav-*] is written only by the controller."
  exit 1
fi

print_success "Navigation transition state has a single owner"
exit 0
