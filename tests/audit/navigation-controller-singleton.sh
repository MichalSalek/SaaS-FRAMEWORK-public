#!/usr/bin/env bash
# navigation-controller-singleton.sh — NVT: JEDEN subskrybent router events.
#
# INTENT:
#   Przed NVT dwa miejsca (useNativeRouter VT + NativeBackBridge popstate)
#   pisały DOM/otwierały animacje na tych samych eventach — stąd anty-double
#   guardy (lastHookNavTs) i flicker. Kontrakt NVT (O18): WYŁĄCZNIE
#   NavigationTransitionController subskrybuje routeChangeStart/Complete/Error
#   i woła router.beforePopState. Każdy nowy subskrybent = drugi kanał animacji
#   / drugi popstate-writer = powrót klasy bugów.
#
# RULE (structural, no baselines):
#   W main/src poza allowlistą ZERO wystąpień:
#     - `routeChangeStart` / `routeChangeComplete` / `routeChangeError`
#       (subskrypcje router.events)
#     - `beforePopState`
#   Allowlist:
#     - UI/layouts/NavigationTransitionController.composition.tsx (właściciel)
#     - pliki *.test.* (testy emitują eventy na mocku routera)
#
# EXIT: 0 if no violations, 1 if found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC="${ROOT}/main/src"
OWNER="UI/layouts/NavigationTransitionController.composition.tsx"

print_header "NVT: navigation controller singleton"

# Comment-skip: only full comment lines (`//` / `*` / `/*` after indent) are
# excluded — trailing-comment tricks stay visible (FWE brand-literals lesson).
COMMENT_LINE='^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)'

HITS=$(grep -rn "routeChangeStart\|routeChangeComplete\|routeChangeError\|beforePopState" \
  "$SRC" --include='*.ts' --include='*.tsx' 2>/dev/null |
  grep -v "/${OWNER}:" |
  grep -v '\.test\.' |
  grep -vE "$COMMENT_LINE" || true)

if [[ -n "$HITS" ]]; then
  print_error "Router-event subscription outside NavigationTransitionController:"
  echo "$HITS"
  echo
  print_info "O18: only the controller may subscribe to routeChange*/beforePopState."
  exit 1
fi

print_success "Single router-events subscriber (NavigationTransitionController)"
exit 0
