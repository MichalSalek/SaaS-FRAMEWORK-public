#!/bin/bash
# validation-coverage.sh — MISSING-validator detector + coverage REPORTER.
#
# ROLE SPLIT (nie usuwaj tego komentarza): this script has TWO concerns, only one
# of which is a hard gate:
#   • GATES (exit 1): CQRS handler endpoints that carry NO request validator at
#     all (neither `validate:`/`validationFunction: VALIDATION_POLICY.validators.X`
#     nor a recognised NO-OP form) — a genuinely unvalidated endpoint.
#   • REPORTS ONLY (does NOT gate): NO-OP validations and UNUSED validators are
#     surfaced for review but do NOT drive exit 1 here.
#
# The NO-OP validation GATING is the job of the SIBLING audit
# `noop-validation-allowlist.sh`: it FAILS (exit 1) when a write-method
# (POST/PUT/PATCH/DELETE) endpoint uses a NO-OP validator WITHOUT an entry in its
# KNOWN_NOOP_VALIDATION allowlist — i.e. it blocks NEW accidental no-ops at commit
# time. This script intentionally only reports the no-op COUNT so the two audits
# don't double-own the same gate. If you want "no new no-op validation" enforced,
# look at noop-validation-allowlist.sh, not here.

set -euo pipefail

source "$(dirname "$0")/_utils.sh"

# PCRE is required for multi-line validation pattern matching (grep -Pzo)
if ! echo "test" | grep -P "test" >/dev/null 2>&1; then
    print_error "GNU grep with PCRE support required (grep -P). Install libpcre or use GNU grep."
    exit 1
fi

# Initialize temp files tracking
TEMP_FILES=""

# Cleanup trap
cleanup() {
    [[ -n "${TEMP_FILES:-}" ]] && rm -f $TEMP_FILES 2>/dev/null || true
}
trap cleanup EXIT

print_progress_bar() {
    local current=$1
    local total=$2
    local width=20
    local percentage=$((current * 100 / total))
    local filled=$((current * width / total))
    local empty=$((width - filled))
    
    printf "["
    printf "%*s" $filled | tr ' ' '█'
    printf "%*s" $empty | tr ' ' '░'
    printf "] %d%% (%d/%d)" $percentage $current $total
}

print_boxed_header "VALIDATION COVERAGE AUDIT" "🔍"

# Get project root
PROJECT_ROOT=$(get_project_root)

# File existence checks
POLICY_FILE="$PROJECT_ROOT/.shared-kernel/policies/validation.policy.ts"
API_DIR="$PROJECT_ROOT/web-1/src/pages/api/v1"

if [[ ! -f "$POLICY_FILE" ]]; then
    print_error "validation.policy.ts not found at $POLICY_FILE"
    exit 1
fi

if [[ ! -d "$API_DIR" ]]; then
    print_error "API directory not found at $API_DIR"
    exit 1
fi

# Find all endpoint files
ENDPOINT_FILES=$(find "$API_DIR" -name "*.ts" 2>/dev/null | sort)
if [[ -z "$ENDPOINT_FILES" ]]; then
    print_error "No TypeScript files found in $API_DIR"
    exit 1
fi

TOTAL_ENDPOINTS=0
PROPER_VALIDATION=0
NOOP_VALIDATION=0
MISSING_VALIDATION=0
RAW_HANDLERS=0
NON_HANDLERS=0

declare -a MISSING_LIST=()
declare -a NOOP_LIST=()
declare -a RAW_LIST=()

echo "📁 Analyzing endpoints..."

# Check each endpoint
while IFS= read -r file; do
    if [[ -n "$file" && -f "$file" ]]; then
        # Handler-shape classification (FWE: the API migrated to `defineHandler`,
        # which calls HTTPRequestHandlerMiddleware INTERNALLY and takes the validator
        # under the `validate:` key — the old in-file `HTTPRequestHandlerMiddleware`
        # + `validationFunction:` markers matched only 4/156 files and produced a
        # false "100% (4/4)". Mirror noop-validation-allowlist.sh: read BOTH handler
        # styles and BOTH validator keys.

        # Raw/webhook handlers (withPublicHandler / withRawSecretHandler) validate
        # inline (signature / shared-secret verify), never via VALIDATION_POLICY —
        # legitimately excluded from the coverage denominator.
        if grep -qE "withPublicHandler|withRawSecretHandler" "$file"; then
            TOTAL_ENDPOINTS=$((TOTAL_ENDPOINTS + 1))
            RAW_HANDLERS=$((RAW_HANDLERS + 1))
            RAW_LIST+=("$file")
            continue
        fi

        # Not a CQRS endpoint handler at all (route barrel, shared util, sub-module
        # without defineHandler or the legacy middleware) — not subject to request
        # validation, so it must NOT inflate or deflate the coverage denominator.
        if ! grep -qE "defineHandler[(<]|HTTPRequestHandlerMiddleware" "$file"; then
            NON_HANDLERS=$((NON_HANDLERS + 1))
            continue
        fi

        # CQRS handler — must carry a request validator (`validate:` for
        # defineHandler, `validationFunction:` for the legacy middleware).
        TOTAL_ENDPOINTS=$((TOTAL_ENDPOINTS + 1))

        # Remove comments and check validation patterns
        TEMP_FILE=$(mktemp)
        TEMP_FILES="$TEMP_FILES $TEMP_FILE"

        # Strip comments: block comments first (before // strip corrupts /* */ boundaries)
        sed '/\/\*/,/\*\//d' "$file" | sed 's|//.*$||g' > "$TEMP_FILE"

        # Proper validation: validate|validationFunction → VALIDATION_POLICY.validators.X
        if grep -Pzo '(?s)(validate|validationFunction):\s*VALIDATION_POLICY\.validators\.[a-zA-Z_][a-zA-Z0-9_.]*' "$TEMP_FILE" >/dev/null 2>&1; then
            PROPER_VALIDATION=$((PROPER_VALIDATION + 1))
        # No-op validation: inline {__isValid: true} literal or imported NO_VALIDATION
        # (both validator keys; mirrors noop-validation-allowlist.sh detection).
        elif grep -Pzo '(?s)(validate|validationFunction):\s*\(\s*\)\s*=>\s*\(\s*{\s*__isValid:\s*true' "$TEMP_FILE" >/dev/null 2>&1 || \
             grep -qE '(validate|validationFunction):\s*NO_VALIDATION' "$TEMP_FILE"; then
            NOOP_VALIDATION=$((NOOP_VALIDATION + 1))
            NOOP_LIST+=("$file")
        else
            MISSING_VALIDATION=$((MISSING_VALIDATION + 1))
            MISSING_LIST+=("$file")
        fi
    fi
done <<< "$ENDPOINT_FILES"

# Extract validators from policy (handle namespaced and complex names)
DEFINED_VALIDATORS=()
if [[ -f "$POLICY_FILE" ]]; then
    # Remove comments first
    TEMP_POLICY=$(mktemp)
    TEMP_FILES="$TEMP_FILES $TEMP_POLICY"
    sed '/\/\*/,/\*\//d' "$POLICY_FILE" | sed 's|//.*$||g' > "$TEMP_POLICY"
    
    while IFS= read -r validator; do
        [[ -n "$validator" ]] && DEFINED_VALIDATORS+=("$validator")
    done < <(grep -o "validators\.[a-zA-Z_][a-zA-Z0-9_.]*" "$TEMP_POLICY" | sed 's/validators\.//' | sort -u)
fi

# Find used validators (handle all quote types and multi-line)
USED_VALIDATORS=()
while IFS= read -r file; do
    if [[ -n "$file" && -f "$file" ]]; then
        TEMP_FILE=$(mktemp)
        TEMP_FILES="$TEMP_FILES $TEMP_FILE"
        sed '/\/\*/,/\*\//d' "$file" | sed 's|//.*$||g' > "$TEMP_FILE"
        
        while IFS= read -r used; do
            [[ -n "$used" ]] && USED_VALIDATORS+=("$used")
        done < <(grep -o "VALIDATION_POLICY\.validators\.[a-zA-Z_][a-zA-Z0-9_.]*" "$TEMP_FILE" | sed 's/VALIDATION_POLICY\.validators\.//' | sort -u)
    fi
done <<< "$ENDPOINT_FILES"

# Find unused validators
UNUSED_VALIDATORS=()
for validator in "${DEFINED_VALIDATORS[@]}"; do
    if [[ ! " ${USED_VALIDATORS[*]} " =~ " ${validator} " ]]; then
        UNUSED_VALIDATORS+=("$validator")
    fi
done

# Calculate coverage (exclude raw handlers from validation requirement)
VALIDATION_REQUIRED=$((TOTAL_ENDPOINTS - RAW_HANDLERS))
if [[ $VALIDATION_REQUIRED -gt 0 ]]; then
    COVERAGE=$((PROPER_VALIDATION * 100 / VALIDATION_REQUIRED))
else
    COVERAGE=100
fi

echo
print_header "📊 COVERAGE OVERVIEW"
echo -n "Validation Coverage: "
print_progress_bar $PROPER_VALIDATION $VALIDATION_REQUIRED
echo

echo
print_header "📋 ENDPOINT BREAKDOWN"
echo -e "${GREEN}✅ Properly validated:${NC} $PROPER_VALIDATION endpoints"
if [[ $NOOP_VALIDATION -gt 0 ]]; then
    echo -e "${YELLOW}⚠️  No-op validation:${NC} $NOOP_VALIDATION endpoints"
fi
if [[ $MISSING_VALIDATION -gt 0 ]]; then
    echo -e "${RED}❌ Missing validation:${NC} $MISSING_VALIDATION endpoints"
fi
if [[ $RAW_HANDLERS -gt 0 ]]; then
    echo -e "${BLUE}🔧 Raw handlers (excluded):${NC} $RAW_HANDLERS endpoints"
fi
if [[ $NON_HANDLERS -gt 0 ]]; then
    echo -e "${BLUE}📦 Non-handler files (skipped):${NC} $NON_HANDLERS files"
fi

if [[ $MISSING_VALIDATION -gt 0 ]]; then
    echo
    print_header "❌ ENDPOINTS WITHOUT VALIDATION ($MISSING_VALIDATION)"
    for file in "${MISSING_LIST[@]}"; do
        echo -e "${RED}  • ${file#web-1/src/pages/api/v1/}${NC}"
    done
fi

if [[ $NOOP_VALIDATION -gt 0 ]]; then
    echo
    print_header "⚠️  ENDPOINTS WITH NO-OP VALIDATION ($NOOP_VALIDATION)"
    for file in "${NOOP_LIST[@]}"; do
        echo -e "${YELLOW}  • ${file#web-1/src/pages/api/v1/}${NC}"
    done
fi

if [[ $RAW_HANDLERS -gt 0 ]]; then
    echo
    print_header "🔧 RAW HANDLERS (NO MIDDLEWARE) ($RAW_HANDLERS)"
    for file in "${RAW_LIST[@]}"; do
        echo -e "${BLUE}  • ${file#web-1/src/pages/api/v1/}${NC}"
    done
fi

if [[ ${#UNUSED_VALIDATORS[@]} -gt 0 ]]; then
    echo
    print_header "🗑️  UNUSED VALIDATORS (${#UNUSED_VALIDATORS[@]})"
    for validator in "${UNUSED_VALIDATORS[@]}"; do
        echo -e "${YELLOW}  • validators.$validator${NC}"
    done
fi

echo
print_header "🔧 ACTION ITEMS"
if [[ $MISSING_VALIDATION -gt 0 ]]; then
    echo -e "${RED}1. Add validation to $MISSING_VALIDATION endpoints${NC}"
    echo "   validationFunction: VALIDATION_POLICY.validators.yourValidator"
fi
if [[ $NOOP_VALIDATION -gt 0 ]]; then
    echo -e "${YELLOW}2. Review $NOOP_VALIDATION no-op validations - are they intentional?${NC}"
fi
if [[ ${#UNUSED_VALIDATORS[@]} -gt 0 ]]; then
    echo -e "${YELLOW}3. Remove ${#UNUSED_VALIDATORS[@]} unused validators to clean up dead code${NC}"
fi
if [[ $RAW_HANDLERS -gt 0 ]]; then
    echo -e "${BLUE}4. Consider migrating $RAW_HANDLERS raw handlers to HTTPRequestHandlerMiddleware${NC}"
fi

echo
print_header "📋 SUMMARY"
if [[ $MISSING_VALIDATION -gt 0 ]]; then
    echo -e "${RED}❌ FAILED:${NC} $MISSING_VALIDATION endpoints without validation"
    echo -e "${RED}   Coverage: $COVERAGE% ($PROPER_VALIDATION/$VALIDATION_REQUIRED)${NC}"
    exit 1
else
    echo -e "${GREEN}✅ PASSED:${NC} All endpoints have validation"
    echo -e "${GREEN}   Coverage: $COVERAGE% ($PROPER_VALIDATION/$VALIDATION_REQUIRED)${NC}"
    exit 0
fi