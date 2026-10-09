#!/usr/bin/env bash
# main-content-parity.sh — NVT: każdy layout contentowy ma #main-content + shell.
#
# INTENT:
#   Kontrakt scroll/focus/a11y NVT (O3/O8/O9/O12/O21) wisi na dwóch hakach:
#   `#main-content` (scroll reset, focus po nawigacji, aria-busy, skip-link)
#   i `NavigationContentShellComposition` (animowany content, chrome poza).
#   Layout, który renderuje treść użytkownika BEZ któregoś z nich, wypada
#   z kontraktu po cichu: nawigacja nie animuje się (no-shell → instant),
#   focus ląduje w fallbacku, skip-link wisi. Redirect-shelle (puste divy
#   aria-hidden na czas replace()) są ŚWIADOMIE poza kontraktem.
#
# RULE (structural, no baselines):
#   1. Każdy layout z listy LAYOUTS zawiera >=1 `id='main-content'`
#      ORAZ >=1 `NavigationContentShellComposition`.
#   2. Nikt POZA katalogiem UI/layouts nie deklaruje własnego
#      `id='main-content'` (jeden właściciel per ekran; duplikat id
#      łamie skip-link i focus target).
#
# EXIT: 0 if no violations, 1 if found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC="${ROOT}/main/src"
LAYOUTS=(
  "UI/layouts/AppLayout.composition.tsx"
  "UI/layouts/PublicLayout.composition.tsx"
  "UI/layouts/AdminLayout.composition.tsx"
  "UI/layouts/AccountWebLayout.composition.tsx"
)

print_header "NVT: #main-content + content-shell parity"

FAILED=0

for REL in "${LAYOUTS[@]}"; do
  FILE="${SRC}/${REL}"
  if [[ ! -f "$FILE" ]]; then
    print_error "Layout missing: ${REL} (update LAYOUTS list if renamed)"
    FAILED=1
    continue
  fi
  if ! grep -q "id='main-content'" "$FILE"; then
    print_error "${REL}: no id='main-content' — scroll/focus/skip-link contract broken"
    FAILED=1
  fi
  if ! grep -q "NavigationContentShellComposition" "$FILE"; then
    print_error "${REL}: no NavigationContentShellComposition — navigation renders instant (no-shell fallback)"
    FAILED=1
  fi
done

# 2. #main-content uniqueness: only layout files may declare it.
STRAYS=$(grep -rln "id='main-content'" "$SRC" \
  --include='*.tsx' 2>/dev/null | grep -v "/UI/layouts/" || true)
if [[ -n "$STRAYS" ]]; then
  print_error "id='main-content' declared outside UI/layouts (duplicate focus/skip-link target):"
  echo "$STRAYS"
  FAILED=1
fi

if [[ $FAILED -ne 0 ]]; then
  echo
  print_info "NVT contract: content layouts own exactly one #main-content wrapping the shell."
  exit 1
fi

print_success "All content layouts expose #main-content + NavigationContentShell"
exit 0
