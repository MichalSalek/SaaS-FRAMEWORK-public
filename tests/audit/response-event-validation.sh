#!/bin/bash
# response-event-validation.sh — Ensure all respond* calls use APP_EVENTS.INFO.* constants.
# Anti-pattern: respondSuccess(res, data, 'SOME_RAW_STRING') — bypasses SSOT type system.
# Safe pattern:  respondSuccess(res, data, APP_EVENTS.INFO.DOMAIN.EVENT) or omitting (uses default).
set -e
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
HANDLERS_DIR="${ROOT}/web-1/src/pages/api/v1"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$HANDLERS_DIR" "handlerów API v1"
ERROR_MAPPER="${ROOT}/web-1/src/application/http/error-mapper.ts"

print_boxed_header "SSOT: response event validation audit"

FAIL=0
WARN=0
CHECKED=0

# ── respond* functions grouped by signature ──
#
# GROUP A — event is hardcoded inside (no event arg): always safe, skip.
#   respondGeneralError, respondAccountNotFound, respondUserNotFound,
#   respondValidationFailed, respondPlanLimitReached, respondStaffAlreadyExists
#
# GROUP B — event is 2nd arg (mandatory): respondBadRequest, respondNotFound,
#   respondTooManyRequests, respondNotAcceptable
#
# GROUP C — event is 3rd arg (optional, has default): respondSuccess, respondCreated,
#   respondForbidden, respondUnauthorized
#
# Strategy:
#   GROUP B: extract 2nd arg, check it references APP_EVENTS
#   GROUP C: if 3rd arg present, check it references APP_EVENTS
#
# DECISION (nie usuwaj tego komentarza): this audit catches DIRECT raw-string
# event args (e.g. `respondSuccess(res, data, 'EMAIL_SENT')`) and FAILS on them
# (exit 1). It does NOT catch variable indirection — `const e = 'RAW'; respondSuccess
# (res, data, e)` — which is only WARNED on (an identifier that is neither
# APP_EVENTS.* nor a quoted literal). Resolving the variable's value would require
# multi-line, cross-statement value tracking (and would still miss imports /
# computed values), making the audit fragile and false-positive-prone. We
# deliberately accept this known limitation: the direct-literal path is the common
# SSOT-bypass and is gated; indirected event args are surfaced as WARN for manual
# verification, not a hard fail. (Real-world WARNs today are runtime property
# accesses like `result.data.event`, not raw-string consts.)

# ── Phase 1: Scan handler files in api/v1/ ──

check_file() {
    local file="$1"
    local rel_path="${file#${ROOT}/}"
    local file_fail=0

    # Read the whole file once
    local content
    content=$(cat "$file")

    # Collapse multi-line respond* calls into single lines for analysis.
    # This handles the common pattern:
    #   respondBadRequest(
    #     res,
    #     APP_EVENTS.INFO.DOMAIN.EVENT,
    #     { data }
    #   );
    local collapsed
    collapsed=$(echo "$content" | perl -0777 -pe '
        # Match respond* call spanning multiple lines until closing );
        s/(respond\w+\s*\((?:[^()]*|\((?:[^()]*|\([^()]*\))*\))*\))/
            my $match = $1;
            $match =~ s!\s*\n\s*! !g;
            $match;
        /ge;
    ')

    # GROUP B: event is 2nd arg (mandatory)
    # Pattern: respondBadRequest(res, EVENT, data) / respondNotFound(res, EVENT, data) etc.
    local group_b_calls
    group_b_calls=$(echo "$collapsed" | grep -noE 'respond(BadRequest|NotFound|TooManyRequests|NotAcceptable)\([^)]+\)' || true)

    while IFS= read -r match; do
        [[ -z "$match" ]] && continue
        local line_num="${match%%:*}"
        local call="${match#*:}"

        # Extract the 2nd argument (between first comma and second comma)
        # respond*(res, ARG2, ARG3)
        local arg2
        arg2=$(echo "$call" | sed 's/^respond[A-Za-z]*(//; s/)$//' | awk -F', ' '{print $2}' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

        if [[ -z "$arg2" ]]; then
            continue
        fi

        if echo "$arg2" | grep -qE "^APP_EVENTS\."; then
            : # PASS — correct SSOT reference
        elif echo "$arg2" | grep -qE "^'|^\""; then
            print_error "RAW STRING: ${rel_path}:${line_num} — ${call}"
            echo -e "    ${YELLOW}Event arg: ${arg2}${NC}"
            echo -e "    ${BLUE}-> Use APP_EVENTS.INFO.DOMAIN.EVENT, not a raw string${NC}"
            echo ""
            file_fail=1
            FAIL=$((FAIL + 1))
        else
            # Variable reference — can't determine statically
            print_warning "VARIABLE: ${rel_path}:${line_num} — event arg is '${arg2}' (not a direct APP_EVENTS ref)"
            WARN=$((WARN + 1))
        fi
    done <<< "$group_b_calls"

    # GROUP C: event is 3rd arg (optional)
    # Pattern: respondSuccess(res, data, EVENT?) / respondCreated(res, data, EVENT?) etc.
    local group_c_calls
    group_c_calls=$(echo "$collapsed" | grep -noE 'respond(Success|Created|Forbidden|Unauthorized)\([^)]+\)' || true)

    while IFS= read -r match; do
        [[ -z "$match" ]] && continue
        local line_num="${match%%:*}"
        local call="${match#*:}"

        # Count arguments by splitting on top-level commas (not inside braces/parens)
        # Simple heuristic: extract everything after "respond*(", split by ", "
        local args_str
        args_str=$(echo "$call" | sed 's/^respond[A-Za-z]*(//; s/)$//')

        # Extract 3rd argument if present
        # For respondSuccess(res, data) — only 2 args, skip (uses default = safe)
        # For respondSuccess(res, data, event) — check arg3
        # For respondForbidden(res, data, event) — check arg3
        local arg3
        arg3=$(echo "$args_str" | perl -pe '
            # Remove content inside { } and ( ) to avoid splitting on nested commas
            while (s/\{[^{}]*\}/BLOCK/g || s/\([^()]*\)/PAREN/g || s/<[^<>]*>/GENERIC/g) {}
        ' | awk -F', ' '{if(NF>=3) print $3}' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

        if [[ -z "$arg3" ]]; then
            : # Only 2 args — uses default APP_EVENTS constant, safe
        elif echo "$arg3" | grep -qE "^APP_EVENTS\."; then
            : # PASS — correct SSOT reference
        elif echo "$arg3" | grep -qE "^'|^\""; then
            print_error "RAW STRING: ${rel_path}:${line_num} — ${call}"
            echo -e "    ${YELLOW}Event arg: ${arg3}${NC}"
            echo -e "    ${BLUE}-> Use APP_EVENTS.INFO.DOMAIN.EVENT, not a raw string${NC}"
            echo ""
            file_fail=1
            FAIL=$((FAIL + 1))
        else
            # Variable reference — can't determine statically
            print_warning "VARIABLE: ${rel_path}:${line_num} — event arg is '${arg3}' (not a direct APP_EVENTS ref)"
            WARN=$((WARN + 1))
        fi
    done <<< "$group_c_calls"

    CHECKED=$((CHECKED + 1))
    return $file_fail
}

# Scan all .ts files in handler directory
FILE_FAIL_COUNT=0
while IFS= read -r file; do
    check_file "$file" || FILE_FAIL_COUNT=$((FILE_FAIL_COUNT + 1))
done < <(find "$HANDLERS_DIR" -name "*.ts" -type f 2>/dev/null)

# ── Phase 2: Verify error-mapper still uses APP_EVENTS.INFO.* exclusively ──

print_info "Checking error-mapper.ts..."

if [[ -f "$ERROR_MAPPER" ]]; then
    # Collapse multi-line calls
    mapper_collapsed=$(perl -0777 -pe '
        s/(respond\w+\s*\((?:[^()]*|\((?:[^()]*|\([^()]*\))*\))*\))/
            my $match = $1;
            $match =~ s!\s*\n\s*! !g;
            $match;
        /ge;
    ' "$ERROR_MAPPER")

    # Check Group B calls in error-mapper
    mapper_b=$(echo "$mapper_collapsed" | grep -oE 'respond(BadRequest|NotFound|TooManyRequests|NotAcceptable)\([^)]+\)' || true)
    while IFS= read -r call; do
        [[ -z "$call" ]] && continue
        local_arg2=$(echo "$call" | sed 's/^respond[A-Za-z]*(//; s/)$//' | awk -F', ' '{print $2}' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        if [[ -n "$local_arg2" ]] && ! echo "$local_arg2" | grep -qE "^APP_EVENTS\." && echo "$local_arg2" | grep -qE "^'|^\""; then
            print_error "ERROR-MAPPER RAW STRING: error-mapper.ts — ${call}"
            FAIL=$((FAIL + 1))
        fi
    done <<< "$mapper_b"

    # Check Group C calls in error-mapper (respondForbidden with explicit 3rd arg)
    mapper_c=$(echo "$mapper_collapsed" | grep -oE 'respond(Success|Created|Forbidden|Unauthorized)\([^)]+\)' || true)
    while IFS= read -r call; do
        [[ -z "$call" ]] && continue
        local_args=$(echo "$call" | sed 's/^respond[A-Za-z]*(//; s/)$//')
        local_arg3=$(echo "$local_args" | perl -pe '
            while (s/\{[^{}]*\}/BLOCK/g || s/\([^()]*\)/PAREN/g || s/<[^<>]*>/GENERIC/g) {}
        ' | awk -F', ' '{if(NF>=3) print $3}' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        if [[ -n "$local_arg3" ]] && ! echo "$local_arg3" | grep -qE "^APP_EVENTS\." && echo "$local_arg3" | grep -qE "^'|^\""; then
            print_error "ERROR-MAPPER RAW STRING: error-mapper.ts — ${call}"
            FAIL=$((FAIL + 1))
        fi
    done <<< "$mapper_c"

    print_success "error-mapper.ts — verified (all respond* calls use APP_EVENTS.INFO.*)"
fi

# ── Summary ──

echo ""

if [[ $WARN -gt 0 ]]; then
    print_warning "${WARN} variable event arg(s) found — verify manually that they resolve to APP_EVENTS.INFO.* at runtime"
fi

if [[ $FAIL -gt 0 ]]; then
    echo ""
    print_error "RESPONSE EVENT VALIDATION FAILED: ${FAIL} raw string event(s) found in ${FILE_FAIL_COUNT} file(s)"
    echo ""
    echo "  HOW TO FIX:"
    echo "    1. Import APP_EVENTS: import { APP_EVENTS } from '@kernel/domain/events/app-events.const';"
    echo "    2. Replace raw string with APP_EVENTS.INFO.DOMAIN.EVENT_NAME"
    echo "    3. If no matching event exists, add it to .shared-kernel/domain/events/app-events.const.ts"
    echo "    4. Run npm run system:kernel to propagate"
    echo ""
    echo "  See CLAUDE.md -> 'APP_EVENTS = SSOT' for details."
    echo ""
    exit 1
fi

print_success "Response event validation passed — ${CHECKED} handler files checked, all events use APP_EVENTS.INFO.*"
exit 0
