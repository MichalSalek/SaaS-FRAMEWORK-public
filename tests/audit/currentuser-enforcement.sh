#!/bin/bash
# currentuser-enforcement.sh — Detect identity fields sourced from request body.
# Anti-pattern: body.userId / body.accountId (attacker-controlled).
# Safe pattern:  currentUser.id / currentUser.account_id (session-derived).
set -e
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
HANDLERS_DIR="${ROOT}/web-1/src/pages/api/v1"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$HANDLERS_DIR" "handlerów API v1"

# ── Allowlist: path fragments where body-sourced identity fields are intentional
# (e.g. admin endpoints that operate on other users' accounts).
CURRENTUSER_ALLOWLIST=(
    "admin/"
)

# ── Identity fields that MUST come from currentUser (session), never the request body.
# Single alternation list reused across all three access shapes below.
IDENTITY_FIELDS='userId|user_id|user_ids|accountId|account_id|stylistId|stylist_id|clientId|client_id|createdBy|created_by|created_by_account_id|created_by_user_id'

# ── Patterns that suggest body-sourced identity fields (grep extended regex).
# DECISION (nie usuwaj tego komentarza): IDOR guard rozszerzony z samego dotted-read
# (body.userId) na DWA kolejne kształty wyciągania tożsamości z body:
#   1. dotted     : body.userId / req.body.userId
#   2. destructure: const/let/var { userId } = body / const {userId} = req.body
#   3. bracket    : body['userId'] / req.body["userId"]
# Destructuring jest CELOWO zakotwiczone na RHS = (req.)body z prawej strony, więc
# session-sourced destructuring (const { id } = currentUser, ... = session) NIE jest
# flagowane — łapiemy wyłącznie pola tożsamości pochodzące z ataker-controlled body.
# Pole tożsamości w destrukturyzacji wykrywamy jako słowo (\b...\b) wewnątrz { ... }
# (osobne pole, alias, lub z domyślną wartością), niezależnie od jego pozycji na liście.
DOTTED_PATTERN="(req\.)?body\.($IDENTITY_FIELDS)"
DESTRUCTURE_PATTERN="(const|let|var)[[:space:]]*\{[^}]*\b($IDENTITY_FIELDS)\b[^}]*\}[[:space:]]*=[[:space:]]*(req\.)?body"
BRACKET_PATTERN="(req\.)?body\[[[:space:]]*['\"]($IDENTITY_FIELDS)['\"][[:space:]]*\]"
IDENTITY_PATTERN="(${DOTTED_PATTERN}|${DESTRUCTURE_PATTERN}|${BRACKET_PATTERN})"

print_boxed_header "Security: currentUser enforcement audit"

FAIL=0
CHECKED=0

while IFS= read -r file; do
    rel_path="${file#${ROOT}/}"

    # ── Check allowlist
    skip=0
    for pattern in "${CURRENTUSER_ALLOWLIST[@]}"; do
        if [[ "$rel_path" == *"$pattern"* ]]; then
            skip=1
            break
        fi
    done
    [[ $skip -eq 1 ]] && continue

    CHECKED=$((CHECKED + 1))

    # ── Find body-sourced identity fields, excluding comment lines (// and /*)
    matches=$(grep -nE "$IDENTITY_PATTERN" "$file" 2>/dev/null | grep -vE '^\s*[0-9]+:\s*//' | grep -vE '^\s*[0-9]+:\s*\*' || true)

    if [[ -n "$matches" ]]; then
        FAIL=1
        print_error "IDOR RISK: ${rel_path}"
        echo "$matches" | while IFS= read -r line; do
            echo -e "    ${YELLOW}${line}${NC}"
        done
        echo -e "    ${BLUE}→ Use currentUser from session, not body. See CLAUDE.md Security section${NC}"
        echo ""
    fi
done < <(find "$HANDLERS_DIR" -name "*.ts" -type f 2>/dev/null)

if [[ $FAIL -eq 1 ]]; then
    echo ""
    print_error "CURRENTUSER ENFORCEMENT FAILED: Identity fields must come from session (currentUser), not request body"
    echo ""
    echo "  HOW TO FIX:"
    echo "    1. Replace body.userId/accountId with currentUser.id/account_id"
    echo "    2. If this is an admin endpoint operating on another user, add to CURRENTUSER_ALLOWLIST"
    echo ""
    exit 1
fi

print_success "currentUser enforcement passed — ${CHECKED} handlers checked, no body-sourced identity fields"
exit 0
