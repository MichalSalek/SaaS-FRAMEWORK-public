#!/bin/bash

# SSOT Routes Drift Audit Script
# Compares routing.config.ts ROUTES_API with actual endpoint implementations

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Cleanup trap for interruption
TEMP_FILES=""
trap 'rm -f $TEMP_FILES; exit 1' INT TERM

# Source utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_utils.sh"

PROJECT_ROOT=$(get_project_root)
ROUTING_CONFIG="$PROJECT_ROOT/.shared-kernel/domain/routing/routing.config.ts"
API_DIR="$PROJECT_ROOT/web-1/src/pages/api/v1"

# Start timer
START_TIME=$(date +%s)

# Header with box
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║                          🔍 SSOT ROUTES DRIFT AUDIT                          ║${NC}"
echo -e "${BOLD}║                        $(date '+%Y-%m-%d %H:%M:%S')                         ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo

# Validate required files exist
echo -e "${BLUE}📋 Validating environment...${NC}"

if [[ ! -f "$ROUTING_CONFIG" ]]; then
    echo -e "  ${RED}❌ routing.config.ts not found${NC}"
    echo -e "     Path: ...$(echo "$ROUTING_CONFIG" | tail -c 50)"
    exit 1
fi

if [[ ! -s "$ROUTING_CONFIG" ]]; then
    echo -e "  ${RED}❌ routing.config.ts is empty${NC}"
    exit 1
fi

if [[ ! -d "$API_DIR" ]]; then
    echo -e "  ${RED}❌ API directory not found${NC}"
    echo -e "     Path: ...$(echo "$API_DIR" | tail -c 50)"
    exit 1
fi

echo -e "  ${GREEN}✅ All required files found${NC}"
echo

# Extract SSOT routes
echo -e "${BLUE}🔍 Scanning SSOT routes...${NC}"

# Normalize line endings and extract routes, avoiding comments
SSOT_ROUTES=$(sed 's/\r$//' "$ROUTING_CONFIG" | \
    grep -E '^\s*[A-Z_]+:\s*`\${API_VER}' | \
    grep -v '^\s*//' | \
    sed 's/.*`${API_VER}\([^`]*\)`.*/\1/' | \
    sed 's|/$||' | \
    grep -v '^$' | \
    sort | uniq || true)

if [[ -z "$SSOT_ROUTES" ]]; then
    echo -e "  ${YELLOW}⚠️  No SSOT routes found in routing.config.ts${NC}"
fi

# Warn about non-API_VER routes in ROUTES_API (e.g. DEV_LOGIN: '/api/auth/dev-login')
NON_API_VER_ROUTES=$(sed 's/\r$//' "$ROUTING_CONFIG" | \
    sed -n '/ROUTES_API/,/} as const/p' | \
    grep -E '^\s*[A-Z_]+:' | \
    grep -v '^\s*//' | \
    grep -v '${API_VER}' | \
    grep -v '^\s*}' | \
    grep -v 'ROUTES_API' || true)
NON_API_VER_COUNT=$(echo "$NON_API_VER_ROUTES" | grep -v '^$' | wc -l)

if [[ $NON_API_VER_COUNT -gt 0 ]]; then
    echo -e "  ${YELLOW}⚠️  $NON_API_VER_COUNT non-API_VER routes in ROUTES_API (excluded from drift check):${NC}"
    echo "$NON_API_VER_ROUTES" | grep -v '^$' | while IFS= read -r line; do
        echo -e "     ${YELLOW}• $(echo "$line" | xargs)${NC}"
    done
    echo
fi

# Find endpoint implementations
echo -e "${BLUE}🔍 Scanning endpoint implementations...${NC}"

# Base routes from index.ts and direct .ts files
BASE_ROUTES=$(find "$API_DIR" -name "index.ts" -o -name "*.ts" 2>/dev/null | \
    grep -v "/webhooks/" | \
    grep -v "/get\.ts$" | \
    grep -v "/post\.ts$" | \
    sed "s|$API_DIR/||" | \
    sed 's|/index\.ts$||' | \
    sed 's|\.ts$||' | \
    grep -v '^$' || true)

# Routes from get.ts/post.ts files
GET_POST_ROUTES=$(find "$API_DIR" -name "get.ts" -o -name "post.ts" 2>/dev/null | \
    grep -v "/webhooks/" | \
    while read -r file; do
        rel_path="${file#$API_DIR/}"
        base_path=$(dirname "$rel_path")
        [[ "$base_path" != "." ]] && echo "$base_path"
    done | grep -v '^$' || true)

# Combine and normalize
IMPL_ROUTES=$(echo -e "$BASE_ROUTES\n$GET_POST_ROUTES" | \
    grep -v '^$' | \
    sort | uniq || true)

# Counts
SSOT_COUNT=$(count_items "$SSOT_ROUTES")
IMPL_COUNT=$(count_items "$IMPL_ROUTES")

echo -e "${BOLD}📊 Discovery Results${NC}"
echo -e "  ${GREEN}✅ SSOT routes found:        ${BOLD}${SSOT_COUNT}${NC}"
echo -e "  ${GREEN}✅ Implementations found:    ${BOLD}${IMPL_COUNT}${NC}"
echo

# Create temp files for comparison
SSOT_TEMP=$(mktemp)
IMPL_TEMP=$(mktemp)
TEMP_FILES="$SSOT_TEMP $IMPL_TEMP"
trap 'rm -f $TEMP_FILES; exit 1' INT TERM
trap 'rm -f $TEMP_FILES' EXIT

echo "$SSOT_ROUTES" > "$SSOT_TEMP"
echo "$IMPL_ROUTES" > "$IMPL_TEMP"

# Find drift
SSOT_ONLY=$(comm -23 "$SSOT_TEMP" "$IMPL_TEMP" | grep -v '^$' || true)
IMPL_ONLY=$(comm -13 "$SSOT_TEMP" "$IMPL_TEMP" | grep -v '^$' || true)

SSOT_ONLY_COUNT=$(count_items "$SSOT_ONLY")
IMPL_ONLY_COUNT=$(count_items "$IMPL_ONLY")
DRIFT_COUNT=$((SSOT_ONLY_COUNT + IMPL_ONLY_COUNT))

# Report drift issues
echo -e "${BOLD}🔍 Drift Analysis${NC}"
echo "────────────────────────────────────────────────────────────────────────────────"

if [[ $SSOT_ONLY_COUNT -gt 0 ]]; then
    echo -e "${YELLOW}⚠️  Routes defined in SSOT but not implemented (${BOLD}${SSOT_ONLY_COUNT}${NC}${YELLOW}):${NC}"
    echo "$SSOT_ONLY" | while IFS= read -r route; do
        [[ -n "$route" ]] || continue
        # Find definition location
        line_info=$(sed 's/\r$//' "$ROUTING_CONFIG" | \
            grep -n "^\s*[A-Z_]*:\s*\`\${API_VER}$route\`" 2>/dev/null | \
            grep -v '^\s*//' | \
            head -1 || echo "")
        if [[ -n "$line_info" ]]; then
            line_num=$(echo "$line_info" | cut -d: -f1)
            # Truncate long paths
            short_route=$(echo "$route" | sed 's|.*/\([^/]*/[^/]*/[^/]*\)$|.../\1|')
            echo -e "  ${RED}❌ ${short_route}${NC} ${BLUE}(routing.config.ts:${line_num})${NC}"
        else
            echo -e "  ${RED}❌ $route${NC}"
        fi
        echo -e "     ${BLUE}💡 Create: api/v1$route/index.ts${NC}"
    done
    echo
else
    echo -e "  ${GREEN}✅ All SSOT routes have implementations${NC}"
    echo
fi

if [[ $IMPL_ONLY_COUNT -gt 0 ]]; then
    echo -e "${YELLOW}⚠️  Implementations found but not in SSOT (${BOLD}${IMPL_ONLY_COUNT}${NC}${YELLOW}):${NC}"
    echo "$IMPL_ONLY" | while IFS= read -r route; do
        [[ -n "$route" ]] || continue
        # Find implementation file
        impl_file=""
        if [[ -f "$API_DIR$route/index.ts" ]]; then
            impl_file="$route/index.ts"
        elif [[ -f "$API_DIR$route.ts" ]]; then
            impl_file="$route.ts"
        elif [[ -f "$API_DIR$route/get.ts" ]]; then
            impl_file="$route/get.ts"
        elif [[ -f "$API_DIR$route/post.ts" ]]; then
            impl_file="$route/post.ts"
        fi
        
        if [[ -n "$impl_file" ]]; then
            # Truncate long paths
            short_impl=$(echo "$impl_file" | sed 's|.*/\([^/]*/[^/]*/[^/]*\)$|.../\1|')
            short_route=$(echo "$route" | sed 's|.*/\([^/]*/[^/]*/[^/]*\)$|.../\1|')
            echo -e "  ${RED}❌ ${short_route}${NC} ${BLUE}(api/v1/${short_impl})${NC}"
        else
            echo -e "  ${RED}❌ $route${NC}"
        fi
        echo -e "     ${BLUE}💡 Add to ROUTES_API in routing.config.ts${NC}"
    done
    echo
else
    echo -e "  ${GREEN}✅ All implementations are defined in SSOT${NC}"
    echo
fi

# Calculate execution time
END_TIME=$(date +%s)
EXECUTION_TIME=$((END_TIME - START_TIME))

# Summary
echo "════════════════════════════════════════════════════════════════════════════════"
echo -e "${BOLD}📊 SUMMARY${NC}"
echo "────────────────────────────────────────────────────────────────────────────────"
echo -e "  ${BLUE}Total SSOT routes:       ${BOLD}${SSOT_COUNT}${NC}"
echo -e "  ${BLUE}Total implementations:   ${BOLD}${IMPL_COUNT}${NC}"
echo -e "  ${BLUE}Drift issues:            ${BOLD}${DRIFT_COUNT}${NC}"
echo -e "  ${BLUE}Execution time:          ${BOLD}${EXECUTION_TIME}s${NC}"
echo

if [[ $DRIFT_COUNT -gt 0 ]]; then
    echo -e "${RED}❌ AUDIT FAILED${NC} - Drift detected between SSOT and implementations"
    echo -e "   ${YELLOW}📋 Action items: ${BOLD}${DRIFT_COUNT}${NC}"
    echo -e "   ${BLUE}💡 Review the issues above and sync SSOT with actual implementations${NC}"
    echo
    exit 1
else
    echo -e "${GREEN}✅ AUDIT PASSED${NC} - SSOT and implementations are in sync"
    echo -e "   ${GREEN}🎉 No action items required${NC}"
    echo
    exit 0
fi