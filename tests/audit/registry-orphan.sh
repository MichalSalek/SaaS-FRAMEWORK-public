#!/bin/bash

# REGISTRY ORPHAN — REVERSE-PARITY AUDIT (API_HTTP_METHODS → ROUTES_API)
# In run-all (npm run audit:all / git:push).
#
# The API operation key is a PURE-EQUALITY join across registries (CLAUDE.md,
# standaryzacja P-pełny 2026-07-15): the SAME key must exist in ROUTES_API (path),
# API_HTTP_METHODS (method) and the DTO registry. endpoint-completeness.sh guards
# the FORWARD direction (route → method/event/handler). This audit guards the
# REVERSE: a key in API_HTTP_METHODS with NO corresponding ROUTES_API route is a
# PHANTOM entry — dead registry weight that tooling (docs API, codegen, method
# audits) would join against nothing.
#
# EXPLICIT ALIASES (an op sharing another op's endpoint, 1-route/N-ops) are the
# only legal exception. The alias registry lives in
# main/src/application/http/http.endpoints.ts (ROUTE_ALIASES); the map below
# mirrors it and is cross-checked against that file so the two cannot drift.
#
# Baseline: 0 orphans (verified 2026-07-16 — only the 2 SALON_STAFF aliases).

set -u

source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)
HTTP_METHODS_FILE="$PROJECT_ROOT/.shared-kernel/domain/http/http-methods.config.ts"
ROUTING_FILE="$PROJECT_ROOT/.shared-kernel/domain/routing/routing.config.ts"
ALIAS_REGISTRY_FILE="$PROJECT_ROOT/main/src/application/http/http.endpoints.ts"

print_boxed_header "REGISTRY ORPHAN (methods → routes)"

for f in "$HTTP_METHODS_FILE" "$ROUTING_FILE" "$ALIAS_REGISTRY_FILE"; do
    if [[ ! -f "$f" ]]; then
        print_error "required file not found: $f"
        exit 1
    fi
done

# Explicit aliases: API_HTTP_METHODS key → ROUTES_API key it rides on.
# MUST mirror ROUTE_ALIASES in main/src/application/http/http.endpoints.ts.
declare -A ALIASES
ALIASES["SALON_STAFF_INVITE"]="SALON_STAFF"
ALIASES["SALON_STAFF_GET_ALL"]="SALON_STAFF"
ALIASES["USER_LOGOUT"]="SESSION_DELETE_ALL"   # logout = Better Auth; no own route/method entry

# ─── Extract keys from both registries (block-scoped, comment-proof) ─────────
METHOD_KEYS=$(awk '/^export const API_HTTP_METHODS/{f=1;next} /^\} as const\)/{f=0} f' "$HTTP_METHODS_FILE" \
    | grep -oP "^\s+\K[A-Z][A-Z_0-9]*(?=:\s*')" | sort -u)
ROUTE_KEYS=$(awk '/^export const ROUTES_API = Object.freeze\(\{/{f=1;next} /^\} as const\);/{f=0} f' "$ROUTING_FILE" \
    | grep -oP "^\s+\K[A-Z][A-Z_0-9]*(?=:)" | sort -u)

METHOD_COUNT=$(echo "$METHOD_KEYS" | grep -c . || true)
ROUTE_COUNT=$(echo "$ROUTE_KEYS" | grep -c . || true)

if [[ "$METHOD_COUNT" -eq 0 || "$ROUTE_COUNT" -eq 0 ]]; then
    print_error "extraction failed (methods=$METHOD_COUNT, routes=$ROUTE_COUNT) — registry block markers changed?"
    exit 1
fi

echo "  API_HTTP_METHODS keys: $METHOD_COUNT"
echo "  ROUTES_API keys:       $ROUTE_COUNT"
echo ""

# ─── Check 1: alias map here mirrors ROUTE_ALIASES in http.endpoints.ts ──────
ALIAS_DRIFT=0
for key in "${!ALIASES[@]}"; do
    if ! grep -qP "^\s*${key}:\s*'${ALIASES[$key]}'" "$ALIAS_REGISTRY_FILE"; then
        ALIAS_DRIFT=$((ALIAS_DRIFT + 1))
        print_error "alias drift: ${key} → ${ALIASES[$key]} not found in ROUTE_ALIASES (http.endpoints.ts)"
    fi
done
if [[ $ALIAS_DRIFT -eq 0 ]]; then
    print_success "Alias map mirrors ROUTE_ALIASES in http.endpoints.ts (${#ALIASES[@]} aliases)"
fi

# ─── Check 2: every method key resolves to a route (directly or via alias) ───
ORPHANS=()
ALIASED=0
while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    if grep -qx "$key" <<< "$ROUTE_KEYS"; then
        continue
    fi
    target="${ALIASES[$key]:-}"
    if [[ -n "$target" ]] && grep -qx "$target" <<< "$ROUTE_KEYS"; then
        ALIASED=$((ALIASED + 1))
        echo -e "  ${BLUE}⊘ ${key} → alias na trasę ${target}${NC}"
        continue
    fi
    ORPHANS+=("$key")
done <<< "$METHOD_KEYS"

if [[ ${#ORPHANS[@]} -gt 0 ]]; then
    echo ""
    print_error "Phantom entries in API_HTTP_METHODS — no ROUTES_API route (${#ORPHANS[@]}):"
    for k in "${ORPHANS[@]}"; do
        echo -e "    ${RED}- $k${NC}"
    done
    echo -e "${YELLOW}   Fix: add the route to ROUTES_API (same key — pure equality), remove the dead${NC}"
    echo -e "${YELLOW}   method entry, or register an explicit alias in http.endpoints.ts ROUTE_ALIASES${NC}"
    echo -e "${YELLOW}   AND in the ALIASES map of this audit.${NC}"
    exit 1
fi

if [[ $ALIAS_DRIFT -gt 0 ]]; then
    echo ""
    print_error "registry-orphan FAILED — alias registry drift (see above)"
    exit 1
fi

print_success "Registry orphan check OK ($METHOD_COUNT method keys: all resolve to routes, $ALIASED via explicit alias)"
exit 0
