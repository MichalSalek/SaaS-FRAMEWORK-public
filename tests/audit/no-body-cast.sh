#!/bin/bash
# no-body-cast.sh — Forbid raw `req.body as X` / `request.body as X` casts.
#
# INTENT (FWE Wave H — request-boundary contract hardening):
#   The request body is typed in exactly ONE place: the central middleware seam
#   (HTTPRequestHandlerMiddleware → defineHandler), which coalesces a non-object
#   body to {} and hands the handler a typed `body: T` AFTER the validationFunction
#   has run. A handler (or any code) doing its own `req.body as SomeType` bypasses
#   that seam — it re-asserts a type the validator never checked, which is exactly
#   the silent type/runtime drift this boundary exists to prevent.
#
#   Baseline 0: handlers receive the validated `body` parameter; they never re-cast
#   `req.body`. This ratchet keeps it that way.
#
# SAFE PATTERN:   defineHandler<REQ>({ validate, handle: (body) => ... })  // body is typed
# ANTI-PATTERN:   const data = req.body as SomeType                        // unchecked re-cast
#
# KNOWN LIMITATIONS (honest scope — a grep ratchet can't do data-flow):
#   - Caught: `req.body as X`, `request.body as X`, and bracket form `req['body'] as X`.
#   - NOT caught: an aliased/intermediate-var cast (`const b = req.body; … b as X`) — the
#     intermediate-var body cast is, by construction, the legitimate central seam itself
#     (request.middleware.ts), so it cannot be forbidden without flagging the seam. None
#     of these dodge patterns exist in the codebase today (baseline 0); this ratchet stops
#     the natural `req.body as` form, not a determined obfuscation.
set -e
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC="${ROOT}/web-1/src"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$SRC" "źródeł web-1"

# ── Allowlist: path fragments where a raw body cast is legitimate.
# Empty by design — the central seam (request.middleware.ts) types the body via an
# intermediate `rawBody` variable, not `req.body as`, so it does not match. If a
# genuine exception ever arises, add its path fragment here WITH a justification.
BODY_CAST_ALLOWLIST=()

# Match `req.body as X`, `request.body as X`, and bracket form `req['body'] as X`
# (whitespace-tolerant). The bracket sub-pattern `\[[[:space:]]*.?body.?[[:space:]]*\]`
# matches ['body'] / ["body"] / [body] / [ 'body' ] but NOT a variable whose name merely
# CONTAINS "body" (req[somebody], req[antibody], req[nobody]) — the single optional char
# on each side of `body` only admits a quote, so substrings can't false-positive.
BODY_CAST_PATTERN='\breq(uest)?(\.body|\[[[:space:]]*.?body.?[[:space:]]*\])[[:space:]]+as\b'

print_boxed_header "Request contract: no raw body cast audit"

FAIL=0
CHECKED=0

while IFS= read -r file; do
    rel_path="${file#${ROOT}/}"

    # Skip READONLY kernel copies and test files.
    [[ "$rel_path" == *"/READONLY-shared-kernel/"* ]] && continue
    [[ "$rel_path" == *.test.ts ]] && continue

    # ── Check allowlist
    skip=0
    for pattern in "${BODY_CAST_ALLOWLIST[@]}"; do
        if [[ "$rel_path" == *"$pattern"* ]]; then
            skip=1
            break
        fi
    done
    [[ $skip -eq 1 ]] && continue

    CHECKED=$((CHECKED + 1))

    # ── Find raw body casts, excluding comment lines (// and /* * )
    matches=$(grep -nE "$BODY_CAST_PATTERN" "$file" 2>/dev/null | grep -vE '^[0-9]+:[[:space:]]*//' | grep -vE '^[0-9]+:[[:space:]]*\*' || true)

    if [[ -n "$matches" ]]; then
        FAIL=1
        print_error "RAW BODY CAST: ${rel_path}"
        echo "$matches" | while IFS= read -r line; do
            echo -e "    ${YELLOW}${line}${NC}"
        done
        echo -e "    ${BLUE}→ Use the typed \`body\` from defineHandler/middleware, not \`req.body as\`${NC}"
        echo ""
    fi
done < <(find "$SRC" -name "*.ts" -type f 2>/dev/null)

if [[ $FAIL -eq 1 ]]; then
    echo ""
    print_error "NO-BODY-CAST FAILED: request body must come typed from the central validation seam"
    echo ""
    echo "  HOW TO FIX:"
    echo "    1. Read the body via defineHandler's typed \`handle: (body) => ...\` parameter"
    echo "    2. If the field is missing from the REQUEST DTO, add it there + to the validator"
    echo ""
    exit 1
fi

print_success "no-body-cast passed — ${CHECKED} files checked, zero raw \`req.body as\` casts"
exit 0
