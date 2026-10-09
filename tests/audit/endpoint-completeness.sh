#!/bin/bash

# Endpoint Completeness Cross-Check Audit
#
# For every API route in routing.config.ts, verifies that ALL required
# pieces exist: event, http-method, handler file, CQRS scope (permissions seed).
#
# Makes the "Add New Feature Playbook" ENFORCED, not just recommended.
#
# CQRS scope check (LSAT): per CLAUDE.md, every event in CQRS MUST have a permission
# scope (role sets: .shared-kernel/application/role-permissions.ts, re-exported by
# permissions.config.ts). Since permissions.seed.ts builds from cqrs.config.EVENTS
# (Object.values of COMMANDS/QUERIES), a route whose event lives ONLY in
# APP_EVENTS.INFO (logging) — without a COMMANDS/QUERIES entry — will never get a
# permission seeded → endpoint effectively unreachable. This 4th check catches
# that gap (the orphan route → orphan permission anti-pattern).

source "$(dirname "$0")/_utils.sh"

print_boxed_header "ENDPOINT COMPLETENESS"

PROJECT_ROOT=$(get_project_root)
ROUTING_FILE="$PROJECT_ROOT/.shared-kernel/domain/routing/routing.config.ts"
EVENTS_FILE="$PROJECT_ROOT/.shared-kernel/domain/events/app-events.const.ts"
HTTP_METHODS_FILE="$PROJECT_ROOT/.shared-kernel/domain/http/http-methods.config.ts"
HANDLERS_DIR="$PROJECT_ROOT/web-1/src/pages/api/v1"
MODELS_DIR="$PROJECT_ROOT/.shared-kernel/models"

MISSING=0
CHECKED=0

# Baseline: routes that predate full wiring enforcement.
# This number can ONLY decrease. Increase = FAIL (new route without full wiring).
BASELINE_INCOMPLETE=0

# Extract API route keys (lines with ${API_VER})
declare -a ROUTE_KEYS
while IFS= read -r line; do
    key=$(echo "$line" | grep -oP "^\s*\K[A-Z_]+" | head -1)
    [[ -n "$key" ]] && ROUTE_KEYS+=("$key")
done < <(grep 'API_VER' "$ROUTING_FILE" | grep -v "^[[:space:]]*//" | grep -v "DEV_LOGIN")

echo "  Found ${#ROUTE_KEYS[@]} API routes in routing.config.ts"
echo ""

# Build lookup sets for fast checking
EVENTS_CONTENT=$(cat "$EVENTS_FILE")
HTTP_METHODS_CONTENT=$(cat "$HTTP_METHODS_FILE")

# CQRS scope = APP_EVENTS.COMMANDS + APP_EVENTS.QUERIES + APP_EVENTS.CONFIRMATIONS blocks
# (excluding INFO). permissions.seed.ts iterates Object.values of these blocks → events
# here become DB-seeded permissions. INFO events (logging) live in APP_EVENTS.INFO and
# have no permission wiring. Routes whose key is only in INFO = unreachable endpoint.
# CONFIRMATIONS = GET-as-Command from emailed links (see app-events.const.ts CONFIRMATIONS).
# Order-independent: scope is derived from the NAME of the current top-level
# block (2-space indent), not from the order blocks appear in the file. The old
# version flipped a flag on COMMANDS/INFO/CONFIRMATIONS lines and only worked
# because CONFIRMATIONS happened to sit after INFO — reordering app-events.const.ts
# would silently corrupt the scope.
CQRS_SCOPE_CONTENT=$(awk '
    /^  [A-Z_]+:[[:space:]]*\{/ {
        section=$1
        sub(/:.*/, "", section)
        in_scope = (section == "COMMANDS" || section == "QUERIES" || section == "CONFIRMATIONS") ? 1 : 0
    }
    in_scope { print }
' "$EVENTS_FILE")

# Build handler event map (event → file exists)
# NOTE: Uses leaf event name only (e.g., SEND_LOG not ADMIN.SEND_LOG).
# Safe while event names are unique across domains.
# If collision occurs, upgrade to DOMAIN.EVENT matching.
declare -A HANDLER_EVENTS
while IFS= read -r handler_file; do
    # Extract from COMMANDS/QUERIES: APP_EVENTS.GROUP.DOMAIN.EVENT (DOMAIN.EVENT leaf)
    # Extract from CONFIRMATIONS:    APP_EVENTS.CONFIRMATIONS.EVENT (flat — direct leaf)
    event_full=$(grep -oP "APP_EVENTS\.(COMMANDS|QUERIES)\.([A-Z_]+)\.([A-Z_]+)" "$handler_file" | head -1 | sed 's/APP_EVENTS\.\(COMMANDS\|QUERIES\)\.//')
    if [[ -z "$event_full" ]]; then
        # Multiline: prettier may split eventName onto next line
        event_full=$(tr '\n' ' ' < "$handler_file" | grep -oP "APP_EVENTS\.(COMMANDS|QUERIES)\.([A-Z_]+)\.([A-Z_]+)" | head -1 | sed 's/APP_EVENTS\.\(COMMANDS\|QUERIES\)\.//')
    fi
    if [[ -z "$event_full" ]]; then
        # CONFIRMATIONS namespace (flat — no DOMAIN level)
        event_full=$(grep -oP "APP_EVENTS\.CONFIRMATIONS\.([A-Z_]+)" "$handler_file" | head -1 | sed 's/APP_EVENTS\.CONFIRMATIONS\.//')
    fi
    if [[ -z "$event_full" ]]; then
        # Multiline CONFIRMATIONS
        event_full=$(tr '\n' ' ' < "$handler_file" | grep -oP "APP_EVENTS\.CONFIRMATIONS\.([A-Z_]+)" | head -1 | sed 's/APP_EVENTS\.CONFIRMATIONS\.//')
    fi
    event_key=$(echo "$event_full" | grep -oP '[A-Z_]+$')
    [[ -n "$event_key" ]] && HANDLER_EVENTS["$event_key"]=1
done < <(find "$HANDLERS_DIR" -name "*.ts" -type f)

# Route key → handler event aliases (routing.config uses different name from handler eventName)
declare -A ROUTE_ALIASES
ROUTE_ALIASES["USER_DELETE_SELF"]="USER_REQUEST_DELETE"
ROUTE_ALIASES["USER_CHANGE_EMAIL"]="USER_REQUEST_EMAIL_CHANGE"

# Known exceptions: routes that exist for special purposes
declare -A EXCEPTIONS
EXCEPTIONS["SALON_STAFF"]=1              # Alias-only route (shared by SALON_STAFF_INVITE + SALON_STAFF_GET_ALL)
EXCEPTIONS["INTERNAL_TRACK_CRAWLER"]=1   # Internal S2S analytics endpoint, raw handler, no CQRS/APP_EVENTS by design

MISSING_EVENTS=()
MISSING_METHODS=()
MISSING_HANDLERS=()
MISSING_CQRS_SCOPE=()

for key in "${ROUTE_KEYS[@]}"; do
    [[ -n "${EXCEPTIONS[$key]}" ]] && continue
    CHECKED=$((CHECKED + 1))

    issues=""

    # 1. Check event exists (anywhere in APP_EVENTS — COMMANDS, QUERIES, or INFO)
    if ! grep -q "'$key'" <<< "$EVENTS_CONTENT"; then
        issues+="event "
        MISSING_EVENTS+=("$key")
    fi

    # 2. Check http-methods.config entry
    if ! grep -qP "^\s+${key}:" <<< "$HTTP_METHODS_CONTENT"; then
        issues+="http-method "
        MISSING_METHODS+=("$key")
    fi

    # 3. Check handler exists (by event name in handler files)
    handler_key="${ROUTE_ALIASES[$key]:-$key}"
    if [[ -z "${HANDLER_EVENTS[$handler_key]}" ]]; then
        issues+="handler "
        MISSING_HANDLERS+=("$key")
    fi

    # 4. LSAT: event in CQRS scope (COMMANDS/QUERIES) → permissions seed coverage.
    # Skipped when event missing from APP_EVENTS entirely (already flagged by #1).
    if ! grep -q "'$key'" <<< "$EVENTS_CONTENT"; then
        :  # already counted in #1
    elif ! grep -q "'$key'" <<< "$CQRS_SCOPE_CONTENT"; then
        issues+="cqrs-scope "
        MISSING_CQRS_SCOPE+=("$key")
    fi

    if [[ -n "$issues" ]]; then
        MISSING=$((MISSING + 1))
        echo -e "  ${RED}✗ ${key}${NC} — missing: ${issues}"
    fi
done

echo ""
echo "  Checked: $CHECKED routes"

if [[ ${#MISSING_EVENTS[@]} -gt 0 ]]; then
    echo -e "\n  ${RED}Missing from APP_EVENTS (${#MISSING_EVENTS[@]}):${NC}"
    for k in "${MISSING_EVENTS[@]}"; do echo "    - $k"; done
fi

if [[ ${#MISSING_METHODS[@]} -gt 0 ]]; then
    echo -e "\n  ${RED}Missing from http-methods.config (${#MISSING_METHODS[@]}):${NC}"
    for k in "${MISSING_METHODS[@]}"; do echo "    - $k"; done
fi

if [[ ${#MISSING_HANDLERS[@]} -gt 0 ]]; then
    echo -e "\n  ${RED}Missing handler (${#MISSING_HANDLERS[@]}):${NC}"
    for k in "${MISSING_HANDLERS[@]}"; do echo "    - $k"; done
fi

if [[ ${#MISSING_CQRS_SCOPE[@]} -gt 0 ]]; then
    echo -e "\n  ${RED}Event NOT in CQRS scope — no permission seeded (${#MISSING_CQRS_SCOPE[@]}):${NC}"
    for k in "${MISSING_CQRS_SCOPE[@]}"; do echo "    - $k (move from APP_EVENTS.INFO to COMMANDS or QUERIES, OR add to EXCEPTIONS)"; done
fi

if [[ $MISSING -gt $BASELINE_INCOMPLETE ]]; then
    echo ""
    print_error "New routes without full wiring (was $BASELINE_INCOMPLETE, now $MISSING)"
    echo -e "${YELLOW}   Every NEW route needs: APP_EVENT + http-methods.config + handler${NC}"
    echo -e "${YELLOW}   If adding a forward-declared route, update BASELINE_INCOMPLETE in this script${NC}"
    exit 1
elif [[ $MISSING -gt 0 ]]; then
    echo -e "\n  ${YELLOW}⚠ $MISSING incomplete routes (baseline: $BASELINE_INCOMPLETE) — wire over time${NC}"
fi

print_success "Endpoint completeness OK ($CHECKED routes, $MISSING incomplete within baseline $BASELINE_INCOMPLETE)"
exit 0
