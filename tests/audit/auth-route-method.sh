#!/bin/bash

# AUTH ZONE — ROUTE METHOD AUDIT (pages/api/auth/*)
# In run-all (npm run audit:all / git:push).
#
# WHY A SEPARATE AUDIT: the auth zone (`/api/auth/*`, NOT `/api/v1/*`) falls
# outside BOTH method guards — endpoint-completeness.sh filters routes by
# `${API_VER}` (DEV_LOGIN + AUTH_EXCHANGE_CODE are path literals without it),
# and handler-method-consistency.sh scans only `pages/api/v1` AND keys its SSOT
# lookup on CQRS event names, which auth-zone handlers do not carry. Extending
# that script would mean a second, event-less keying mechanism inside it —
# a dedicated allowlist audit is cleaner.
#
# RULE:
#   1. Every handler file under web-1/src/pages/api/auth/** must have an entry
#      in EXPECTED below (new auth route without a registered expected method = FAIL).
#   2. For single-method entries, the method(s) DECLARED in the file
#      (`method:` / `contestedHTTPMethod:` / `allowedMethods: []` — same three
#      styles handler-method-consistency reads) must equal the expected method.
#   3. `MULTI` entries (Better Auth catch-all) are method-agnostic by design → skipped.
#
# Expected methods verified in handlers 2026-07-16:
#   dev-login          → POST (contestedHTTPMethod:'post' + allowedMethods:['POST'])
#   exchange-code      → POST (allowedMethods:['POST'] + req.method guard)
#   native-oauth-start → GET  (allowedMethods:['GET'] + req.method guard)

set -u

source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)
AUTH_DIR="$PROJECT_ROOT/web-1/src/pages/api/auth"

print_boxed_header "AUTH ZONE — ROUTE METHOD"

if [[ ! -d "$AUTH_DIR" ]]; then
    print_error "auth handlers directory not found at $AUTH_DIR"
    exit 1
fi

# Allowlist: path relative to pages/api/auth → expected method (lowercase) or MULTI.
declare -A EXPECTED
EXPECTED["dev-login/index.ts"]="post"
EXPECTED["exchange-code/index.ts"]="post"
EXPECTED["native-oauth-start/[provider].ts"]="get"
EXPECTED["[...all].ts"]="MULTI"   # Better Auth catch-all — multi-method router by design

FAILURES=0
CHECKED=0
SKIPPED=0

while IFS= read -r handler_file; do
    rel="${handler_file#$AUTH_DIR/}"

    expected="${EXPECTED[$rel]:-}"
    if [[ -z "$expected" ]]; then
        FAILURES=$((FAILURES + 1))
        print_error "unregistered auth route: web-1/src/pages/api/auth/$rel"
        echo -e "${YELLOW}   New auth-zone handler must be added to EXPECTED in this audit${NC}"
        echo -e "${YELLOW}   (with its intended method) — the auth zone has no other method SSOT.${NC}"
        continue
    fi

    if [[ "$expected" == "MULTI" ]]; then
        SKIPPED=$((SKIPPED + 1))
        echo -e "  ${BLUE}⊘ ${rel} — multi-method by design, skipped${NC}"
        continue
    fi

    CHECKED=$((CHECKED + 1))

    # Gather declared methods from all three styles (lowercased, de-duplicated).
    lits=$(grep -oP "(method|contestedHTTPMethod):\s*'\K(get|post|patch|delete)" "$handler_file" 2>/dev/null || true)
    allowed=$(grep -oP "allowedMethods:\s*\[\K[^]]*" "$handler_file" 2>/dev/null \
        | grep -oP "(GET|POST|PATCH|DELETE)" | tr '[:upper:]' '[:lower:]' || true)
    methods=$(printf '%s\n%s\n' "$lits" "$allowed" | grep -E '^(get|post|patch|delete)$' | sort -u)
    mcount=$(printf '%s\n' "$methods" | grep -cE '^(get|post|patch|delete)$' || true)

    if [[ "$mcount" -eq 0 ]]; then
        FAILURES=$((FAILURES + 1))
        print_error "no readable method declaration: $rel (expected: $expected)"
        echo -e "${YELLOW}   Declare it as a literal — method:'...', contestedHTTPMethod:'...' or allowedMethods:['...']${NC}"
    elif [[ "$mcount" -gt 1 ]]; then
        FAILURES=$((FAILURES + 1))
        print_error "multiple distinct methods declared in $rel: $(echo "$methods" | tr '\n' ' ')(expected single: $expected)"
    elif [[ "$methods" != "$expected" ]]; then
        FAILURES=$((FAILURES + 1))
        print_error "method mismatch: $rel declares '$methods', expected '$expected'"
        echo -e "${YELLOW}   Fix the handler OR update EXPECTED here (deliberate change only)${NC}"
    else
        print_success "$rel — $expected"
    fi
done < <(find "$AUTH_DIR" -name "*.ts" -type f | sort)

echo ""
echo "  Checked: $CHECKED handlers ($SKIPPED multi-method skipped)"

if [[ $FAILURES -gt 0 ]]; then
    print_error "Auth-zone method audit FAILED ($FAILURES issue(s))"
    exit 1
fi

print_success "Auth-zone route methods consistent ($CHECKED checked, $SKIPPED skipped)"
exit 0
