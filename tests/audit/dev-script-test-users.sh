#!/usr/bin/env bash
# dev-script-test-users.sh — Guard: test-user e-mails hardcoded in dev/QA scripts
# must exist in the kernel SSOT.
#
# INTENT:
#   .shared-kernel/config/test-users.config.ts (TEST_USERS_CONFIG) is the SSOT for
#   seeded test/demo accounts. Scripts under scripts/ are bash/CJS — they CANNOT
#   import the TS kernel, so they carry literal copies (documented as such in
#   scripts/qa-authed-screenshot.cjs and scripts/dev/preflight.sh). When an address
#   changes in the kernel, those copies rot SILENTLY:
#     • preflight.sh falls back to "any stylist" → the canary still passes, so the
#       drift is invisible until a check misfires on the wrong account,
#     • qa-authed-screenshot.cjs mints a session for a user that no longer exists.
#   This ratchet fails the moment a script names a *@example.com account the kernel
#   does not define.
#
# WHAT IT CHECKS:
#   Every `<something>@example.com` literal in scripts/**/*.{sh,cjs,mjs,js} must
#   appear in TEST_USERS_CONFIG. Comment lines are scanned too — a stale address in
#   a doc-comment misleads the next agent exactly like a stale one in code.
#
# ESCAPE: append `test-user-allow: <reason>` on the same line (inline, no central
#   allowlist) for a literal that intentionally has no kernel counterpart.
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SSOT="${ROOT}/.shared-kernel/config/test-users.config.ts"

print_boxed_header "Dev-script test users: kernel SSOT enforcement" "🧪"

if [[ ! -f "$SSOT" ]]; then
    print_error "SSOT not found: .shared-kernel/config/test-users.config.ts"
    exit 1
fi

# Known addresses from the kernel SSOT.
# Adres musi zaczynać i kończyć się alfanumerycznie — w bashu `${VAR:-adres}`
# doklejałby wiodące '-' do trafienia.
ADDR_RE='[A-Za-z0-9]([A-Za-z0-9._+-]*[A-Za-z0-9])?@example\.com'
known=$(grep -oE "$ADDR_RE" "$SSOT" | sort -u)
if [[ -z "$known" ]]; then
    print_error "No test-user e-mails parsed from the SSOT — parser or file shape changed"
    exit 1
fi
print_info "SSOT accounts: $(count_items "$known")"

violations=0
while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    file="${hit%%:*}"; rest="${hit#*:}"
    line_no="${rest%%:*}"; line="${rest#*:}"
    [[ "$line" == *"test-user-allow:"* ]] && continue
    # Wzorzec SQL LIKE ('temp-%@example.com') to zapytanie, nie konto z SSOT.
    [[ "$line" == *"%@example.com"* ]] && continue
    while IFS= read -r addr; do
        [[ -z "$addr" ]] && continue
        # `--` : adres zaczynający się od '-' byłby wzięty za opcję grepa.
        if ! grep -qxF -- "$addr" <<<"$known"; then
            print_error "${file#"$ROOT"/}:${line_no} — '${addr}' is not defined in TEST_USERS_CONFIG"
            violations=$((violations + 1))
        fi
    done < <(grep -oE "$ADDR_RE" <<<"$line" | sort -u)
done < <(grep -rnE "$ADDR_RE" "${ROOT}/scripts" \
    --include='*.sh' --include='*.cjs' --include='*.mjs' --include='*.js' 2>/dev/null || true)

if [[ "$violations" -gt 0 ]]; then
    print_separator
    print_error "Test-user drift: ${violations} literal(s) in scripts/ have no kernel counterpart"
    print_info "FIX: align the script with .shared-kernel/config/test-users.config.ts, or append 'test-user-allow: <reason>' on that line"
    exit 1
fi

print_success "All test-user literals in scripts/ match the kernel SSOT"
exit 0
