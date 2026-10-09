#!/usr/bin/env bash
# stripe-ui-mode.sh — Guard: every Stripe Checkout `ui_mode` assignment is 'custom'.
#
# INTENT:
#   SPE renders the embedded Payment Element with Checkout Session `ui_mode:'custom'`
#   (SDK stripe 20.2.0 — UiMode = 'custom'|'embedded'|'hosted'). 'custom' = WE render
#   the surrounding UI (native feel), only the payment inputs are iframed. The Stripe
#   docs / older SDKs push 'embedded' (whole UI in an iframe = browser-smell) and a
#   non-existent 'elements' — both are recurring drift magnets (turbo-review S57 found
#   a 'ui_mode:'elements'' comment-drift in the kernel). This ratchet fails the moment
#   any `ui_mode:` assignment carries a value other than 'custom', in code OR comments.
#
# WHAT IT CHECKS (hard fail):
#   Any `ui_mode: '<x>'` (with x != custom) in web-1/src, main/src, or .shared-kernel
#   (excl READONLY copies — the source kernel is authoritative; node_modules/.next).
#   The check matches the ASSIGNMENT form `ui_mode:'value'`, so prose that merely
#   mentions 'embedded'/'elements' away from a `ui_mode:` colon is not a false hit.
#
# EXIT: 0 if PASS (all ui_mode == 'custom'), 1 if a non-custom ui_mode is found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"

print_boxed_header "Stripe ui_mode: every Checkout ui_mode is 'custom'" "💳"

# All `ui_mode:` assignments across the SPE surface (source kernel, not READONLY copies).
HITS=$(grep -rnE "ui_mode[[:space:]]*:[[:space:]]*['\"]" \
  "${ROOT}/web-1/src" "${ROOT}/main/src" "${ROOT}/.shared-kernel" \
  --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -v '/READONLY-shared-kernel/' \
  | grep -v '/node_modules/' \
  | grep -v '/.next/' || true)

# Violations = an assignment whose value is NOT 'custom'.
VIOLATIONS=$(echo "$HITS" \
  | grep -vE "ui_mode[[:space:]]*:[[:space:]]*['\"]custom['\"]" || true)
VIOLATIONS=$(echo "$VIOLATIONS" | grep -v '^$' || true)

if [[ -z "$HITS" ]]; then
  print_info "No ui_mode assignments found (SPE surface absent?)."
fi

print_separator
if [[ -n "$VIOLATIONS" ]]; then
  echo ""
  print_error "stripe-ui-mode audit FAILED — non-'custom' ui_mode (use 'custom'; NOT 'embedded'/'elements'):"
  echo "$VIOLATIONS" | while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    print_error "  ${line#"$ROOT"/}"
  done
  exit 1
fi
print_success "stripe-ui-mode audit PASSED — all Checkout ui_mode assignments are 'custom'"
exit 0
