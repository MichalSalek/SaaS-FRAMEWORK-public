#!/bin/bash

# Handler ↔ HTTP Methods SSOT Consistency Audit
#
# Verifies that every API handler's DECLARED HTTP method matches the method in
# http-methods.config.ts (SSOT). Reads ALL THREE declaration styles so no
# method-bearing handler is silently dropped:
#   - `method: 'post'`             (defineHandler composer — the CQRS handlers)
#   - `contestedHTTPMethod: 'get'` (RAW handlers calling the middleware inline)
#   - `allowedMethods: ['GET']`    (withPublicHandler / withRawSecretHandler)
# Multi/dual declarations (>1 distinct method, or a ternary like
# `contestedHTTPMethod: isPost ? 'post' : 'get'`) are intentional multi-method
# routers → skipped (logged ⊘), not compared.
#
# SILENT-DROP GUARD: a handler-shaped file (defineHandler / contestedHTTPMethod /
# allowedMethods / with*Handler / HTTPRequestHandlerMiddleware) that yields NO
# recognizable method is a FAILURE (UNRESOLVED) — that is exactly how a
# non-literal declaration (`method: HTTPMethod.POST`) would slip past unverified.
#
# CATCHES: GET/POST drift between the http-methods.config registry and the actual
# handler. Runtime already enforces 405 (request.middleware) — this guards the
# DOC-SSOT (http-methods.config, also consumed by endpoint-completeness.sh) from
# drifting silently away from the handlers it claims to describe.
#
# HISTORY: previously grepped only `contestedHTTPMethod:`, so it saw ~0 of the 145
# `method:`-style handlers (FWE Wave J revival); then missed `allowedMethods:` and
# ternary RAW handlers (FWE Wave J hardening — adversarial review).

source "$(dirname "$0")/_utils.sh"

print_boxed_header "HANDLER METHOD CONSISTENCY"

PROJECT_ROOT=$(get_project_root)
HANDLERS_DIR="$PROJECT_ROOT/web-1/src/pages/api/v1"
HTTP_METHODS_FILE="$PROJECT_ROOT/.shared-kernel/domain/http/http-methods.config.ts"

MISMATCHES=0
CHECKED=0
ORPHANS=0
MULTI=0
UNRESOLVED=0

# Baseline: handlers whose event has no http-methods.config entry yet.
# This number can ONLY decrease (as entries are added). Increase = FAIL.
BASELINE_ORPHANS=0

# Build a lookup: LEAF_EVENT_KEY → HTTP_METHOD from http-methods.config.ts.
# Keyed by leaf event name (e.g., SEND_LOG). Leaf-uniqueness across all domains
# VERIFIED 2026-06-17 (FWE Wave J census: zero collisions) — re-keying to DOMAIN.EVENT
# would solve a non-problem, so leaf keying stays. If a future collision appears,
# upgrade BOTH this lookup and http-methods.config.ts to DOMAIN.EVENT keys.
declare -A METHOD_MAP
while IFS= read -r line; do
    key=$(echo "$line" | grep -oP "^\s*\K[A-Z_]+" | head -1)
    method=$(echo "$line" | grep -oP "'(GET|POST|PATCH|DELETE)'" | tr -d "'" | head -1)
    if [[ -n "$key" && -n "$method" ]]; then
        METHOD_MAP["$key"]=$(echo "$method" | tr '[:upper:]' '[:lower:]')
    fi
done < <(grep -E "^\s+[A-Z_]+:.*'(GET|POST|PATCH|DELETE)'" "$HTTP_METHODS_FILE")

echo "  Loaded ${#METHOD_MAP[@]} entries from http-methods.config.ts"

# Scan all handlers
while IFS= read -r handler_file; do
    rel_path=${handler_file#$PROJECT_ROOT/}

    # Gather declared methods from all three styles (lowercased, de-duplicated).
    lits=$(grep -oP "(method|contestedHTTPMethod):\s*'\K(get|post|patch|delete)" "$handler_file" 2>/dev/null)
    allowed=$(grep -oP "allowedMethods:\s*\[\K[^]]*" "$handler_file" 2>/dev/null \
        | grep -oP "(GET|POST|PATCH|DELETE)" | tr '[:upper:]' '[:lower:]')
    methods=$(printf '%s\n%s\n' "$lits" "$allowed" | grep -E '^(get|post|patch|delete)$' | sort -u)
    mcount=$(printf '%s\n' "$methods" | grep -cE '^(get|post|patch|delete)$')

    # Ternary / conditional method (e.g. `contestedHTTPMethod: isPost ? 'post' : 'get'`)
    # = genuine dual-method router → treat as multi-method.
    has_ternary=$(grep -cP "(method|contestedHTTPMethod):\s*[A-Za-z_][A-Za-z0-9_.]*\s*\?" "$handler_file" 2>/dev/null)

    # Multi/dual-method files (intentional: salon-staff index router,
    # newsletter-unsubscribe GET+POST) declare several methods and branch
    # internally — no single SSOT method to compare against.
    if [[ "$has_ternary" -gt 0 || "$mcount" -gt 1 ]]; then
        MULTI=$((MULTI + 1))
        echo -e "  ${BLUE}⊘ ${rel_path} — multi/dual-method, skipped${NC}"
        continue
    fi

    if [[ "$mcount" -eq 0 ]]; then
        # No recognizable method. If the file is handler-shaped, that is a silent-drop
        # risk (e.g. method declared via a variable/enum the regex can't read) → FAIL.
        is_handler=$(grep -cP "defineHandler|contestedHTTPMethod|allowedMethods|withPublicHandler|withRawSecretHandler|HTTPRequestHandlerMiddleware" "$handler_file" 2>/dev/null)
        if [[ "$is_handler" -gt 0 ]]; then
            UNRESOLVED=$((UNRESOLVED + 1))
            echo -e "  ${RED}✗ UNRESOLVED METHOD: ${rel_path}${NC}"
            echo -e "    handler-shaped but no readable method (literal / allowedMethods / ternary)"
        fi
        continue
    fi

    handler_method="$methods"

    # Extract the handler's CQRS event (first COMMANDS/QUERIES/CONFIRMATIONS reference —
    # that is the `eventName`; INFO references are ignored). Handles multiline (prettier
    # split) and both 3-segment (COMMANDS/QUERIES.DOMAIN.EVENT) and 2-segment
    # (CONFIRMATIONS.EVENT) shapes. Leaf = last UPPER_SNAKE segment. Webhooks / internal
    # S2S routes with only INFO events (stripe, track-crawler) have no C/Q/CONF event →
    # naturally skipped (out of the CQRS method registry's scope).
    event_full=$(tr '\n' ' ' < "$handler_file" | grep -oP "APP_EVENTS\.(COMMANDS|QUERIES|CONFIRMATIONS)\.[A-Z_.]+" | head -1)
    event_key=$(echo "$event_full" | grep -oP '[A-Z_]+' | tail -1)
    [[ -z "$event_key" ]] && continue

    CHECKED=$((CHECKED + 1))

    # Lookup in SSOT
    ssot_method="${METHOD_MAP[$event_key]}"

    if [[ -z "$ssot_method" ]]; then
        ORPHANS=$((ORPHANS + 1))
        echo -e "  ${YELLOW}⚠ ${event_key} — not in http-methods.config${NC}"
    elif [[ "$handler_method" != "$ssot_method" ]]; then
        MISMATCHES=$((MISMATCHES + 1))
        echo -e "  ${RED}✗ MISMATCH: ${event_key}${NC}"
        echo -e "    handler: ${handler_method}  |  SSOT: ${ssot_method}"
        echo -e "    file: ${rel_path}"
    fi
done < <(find "$HANDLERS_DIR" -name "*.ts" -type f)

echo ""
echo "  Checked: $CHECKED handlers ($MULTI multi-method skipped)"
echo "  Mismatches: $MISMATCHES"
echo "  Missing from SSOT: $ORPHANS"
echo "  Unresolved (handler, unreadable method): $UNRESOLVED"

if [[ $UNRESOLVED -gt 0 ]]; then
    print_error "Handler(s) with an unreadable method declaration ($UNRESOLVED)"
    echo -e "${YELLOW}   Fix: declare the method as a string literal — 'method: \"post\"',${NC}"
    echo -e "${YELLOW}   'contestedHTTPMethod: \"get\"', or 'allowedMethods: [\"GET\"]' — so it can be audited${NC}"
    exit 1
fi

if [[ $MISMATCHES -gt 0 ]]; then
    print_error "Handler/SSOT method mismatch detected ($MISMATCHES)"
    echo -e "${YELLOW}   Fix: Update http-methods.config.ts OR the handler's declared method${NC}"
    exit 1
fi

if [[ $ORPHANS -gt $BASELINE_ORPHANS ]]; then
    print_error "New handlers without http-methods.config entry (was $BASELINE_ORPHANS, now $ORPHANS)"
    echo -e "${YELLOW}   Fix: Add missing entries to .shared-kernel/domain/http/http-methods.config.ts${NC}"
    exit 1
elif [[ $ORPHANS -gt 0 ]]; then
    echo -e "  ${YELLOW}⚠ $ORPHANS orphans (baseline: $BASELINE_ORPHANS) — add to http-methods.config over time${NC}"
fi

print_success "All $CHECKED handlers consistent (0 mismatches, $ORPHANS orphans, $MULTI multi-method, $UNRESOLVED unresolved)"
exit 0
