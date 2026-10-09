#!/bin/bash
# imports-health.sh — Module-boundary & import-structure guard (NOT cycle detection).
#
# WHAT IT CHECKS (7 checks): forbidden READONLY imports inside .shared-kernel;
# cross-imports main/↔web-1/; missing @ts-ignore on kernel node_modules imports;
# Prisma SSOT bypass (prisma/js-client value imports); db_models.dto barrel imports;
# email-transport facade encapsulation; reverse-layer imports (UI/components/ →
# UI/features/). NONE of these detect circular/value-cycle dependencies — that is
# owned by `circular-imports.sh` (main/src) and `circular-deps.sh` (web-1/src),
# both madge-based with @-alias resolution.

# Trap for cleanup
trap 'rm -rf "$TMPDIR_IH"' EXIT

# Source utilities
source "$(dirname "$0")/_utils.sh"

print_boxed_header "IMPORTS HEALTH AUDIT"

# Get project root
PROJECT_ROOT=$(get_project_root)

TMPDIR_IH=$(mktemp -d)

# Initialize
check_results=()

# Check directories
for dir in .shared-kernel main/src web-1/src; do
    [[ ! -d "$PROJECT_ROOT/$dir" ]] && { print_error "Directory $dir not found"; exit 1; }
done

echo "Analyzing import patterns..."

# ─── Build file lists ONCE (shared across all checks) ───
find "$PROJECT_ROOT/.shared-kernel" \( -name "*.ts" -o -name "*.tsx" \) \
    -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/dist/*" -not -path "*/out/*" -not -path "*/.git/*" \
    > "$TMPDIR_IH/kernel_files.txt" 2>/dev/null

find "$PROJECT_ROOT/main/src" \( -name "*.ts" -o -name "*.tsx" \) \
    -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/dist/*" -not -path "*/out/*" -not -path "*/.git/*" \
    > "$TMPDIR_IH/main_files.txt" 2>/dev/null

find "$PROJECT_ROOT/web-1/src" \( -name "*.ts" -o -name "*.tsx" \) \
    -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/dist/*" -not -path "*/out/*" -not -path "*/.git/*" \
    -not -path "*/READONLY-shared-kernel/*" -not -path "*/prisma/js-client/*" \
    > "$TMPDIR_IH/web1_files.txt" 2>/dev/null

# ─── Run all 7 checks in parallel ───

# Check 1: Forbidden READONLY imports in shared-kernel
(
    xargs grep -Hn "READONLY" < "$TMPDIR_IH/kernel_files.txt" 2>/dev/null \
        | grep -v "^\s*//" \
        | grep -E "from.*READONLY|import.*READONLY|require.*READONLY" \
        > "$TMPDIR_IH/forbidden.txt" 2>/dev/null
    true
) &
PID1=$!

# Check 2: Cross-imports main→web-1 and web-1→main
(
    xargs grep -Hn "web-1" < "$TMPDIR_IH/main_files.txt" 2>/dev/null \
        | grep -v "^\s*//" \
        | grep -E "from.*web-1|import.*web-1|require.*web-1" \
        > "$TMPDIR_IH/main_to_web.txt" 2>/dev/null

    xargs grep -Hn "/main/" < "$TMPDIR_IH/web1_files.txt" 2>/dev/null \
        | grep -v "^\s*//" \
        | grep -E "from.*/main/|import.*/main/|require.*/main/" \
        > "$TMPDIR_IH/web_to_main.txt" 2>/dev/null
    true
) &
PID2=$!

# Check 3: Missing @ts-ignore for node_modules imports in shared-kernel
(
    xargs grep -Hn "from ['\"]@\|from ['\"][a-z]" < "$TMPDIR_IH/kernel_files.txt" 2>/dev/null \
        | grep -v "^\s*//" \
        | grep -v "from ['\"]\./" \
        | grep -v "READONLY-shared-kernel" \
        > "$TMPDIR_IH/node_imports_raw.txt" 2>/dev/null

    > "$TMPDIR_IH/missing_ignore.txt"
    while IFS=: read -r file_path line_num content; do
        [[ -z "$file_path" ]] && continue
        # Check current line for @ts-ignore or @ts-nocheck
        if echo "$content" | grep -qE "@ts-ignore|@ts-nocheck"; then
            continue
        fi
        if [[ $line_num -gt 1 ]]; then
            prev_line=$((line_num - 1))
            if ! sed -n "${prev_line}p" "$file_path" 2>/dev/null | grep -qE "@ts-ignore|@ts-nocheck"; then
                echo "$file_path:$line_num:$content" >> "$TMPDIR_IH/missing_ignore.txt"
            fi
        else
            echo "$file_path:$line_num:$content" >> "$TMPDIR_IH/missing_ignore.txt"
        fi
    done < "$TMPDIR_IH/node_imports_raw.txt"
    true
) &
PID3=$!

# Check 4: Prisma SSOT bypass
(
    xargs grep -Hn "from.*prisma/js-client" < "$TMPDIR_IH/web1_files.txt" 2>/dev/null \
        | grep -v "^\s*//" \
        | grep -vE "import\s+(type\s+)?\{\s*(Prisma|PrismaClient)\s*(,\s*(Prisma|PrismaClient)\s*)*\}" \
        > "$TMPDIR_IH/prisma_ssot.txt" 2>/dev/null
    true
) &
PID4=$!

# Check 5: Barrel file imports
(
    cat "$TMPDIR_IH/kernel_files.txt" "$TMPDIR_IH/main_files.txt" "$TMPDIR_IH/web1_files.txt" \
        | xargs grep -Hn "from.*db_models\.dto['\"]" 2>/dev/null \
        > "$TMPDIR_IH/barrel.txt" 2>/dev/null
    true
) &
PID5=$!

# Check 6: Direct adapter imports (bypass email-transport facade)
# Only email-transport.ts may import from adapters/ — domain code must use the facade.
ADAPTER_BASELINE=1
(
    xargs grep -Hn "from.*email-handler/adapters/" < "$TMPDIR_IH/web1_files.txt" 2>/dev/null \
        | grep -v "email-transport\.ts:" \
        > "$TMPDIR_IH/adapter_bypass.txt" 2>/dev/null
    true
) &
PID6=$!

# Check 7: Reverse-layer import — main/src/UI/components/ must NOT import from
# UI/features/. Atomic layers: components = reusable primitives BELOW features;
# a components→features import couples the shared layer to concrete features
# (when the feature moves/renames, the "primitive" drags it along). Escape per
# import line: `// features-import-allow: <reason>` (rare; prefer moving the file
# to features/). Precedent: r17/H25 (nailLengthOptions, GalleryQuickFilters)
# fixed by hand WITHOUT a guard → NotificationBell (2026-07-14) re-introduced the
# same reverse import and slipped through; this check closes that class.
# Regex requires `from '<path with features/>'` (quote after from) so DECISION
# prose mentioning "components/ → features/" is not a false hit.
(
    grep "/UI/components/" "$TMPDIR_IH/main_files.txt" 2>/dev/null \
        | xargs grep -HnE "from\s+['\"][^'\"]*\bfeatures/" 2>/dev/null \
        | grep -v "features-import-allow" \
        > "$TMPDIR_IH/reverse_layer.txt" 2>/dev/null
    true
) &
PID7=$!

# Wait for all checks
wait $PID1 $PID2 $PID3 $PID4 $PID5 $PID6 $PID7

# ─── Collect results ───
forbidden_count=0; [[ -s "$TMPDIR_IH/forbidden.txt" ]] && forbidden_count=$(wc -l < "$TMPDIR_IH/forbidden.txt")
cross_count=0
[[ -s "$TMPDIR_IH/main_to_web.txt" ]] && cross_count=$((cross_count + $(wc -l < "$TMPDIR_IH/main_to_web.txt")))
[[ -s "$TMPDIR_IH/web_to_main.txt" ]] && cross_count=$((cross_count + $(wc -l < "$TMPDIR_IH/web_to_main.txt")))
missing_ignore_count=0; [[ -s "$TMPDIR_IH/missing_ignore.txt" ]] && missing_ignore_count=$(wc -l < "$TMPDIR_IH/missing_ignore.txt")
prisma_ssot_count=0; [[ -s "$TMPDIR_IH/prisma_ssot.txt" ]] && prisma_ssot_count=$(wc -l < "$TMPDIR_IH/prisma_ssot.txt")
barrel_count=0; [[ -s "$TMPDIR_IH/barrel.txt" ]] && barrel_count=$(wc -l < "$TMPDIR_IH/barrel.txt")
adapter_bypass_count=0; [[ -s "$TMPDIR_IH/adapter_bypass.txt" ]] && adapter_bypass_count=$(wc -l < "$TMPDIR_IH/adapter_bypass.txt")
reverse_layer_count=0; [[ -s "$TMPDIR_IH/reverse_layer.txt" ]] && reverse_layer_count=$(wc -l < "$TMPDIR_IH/reverse_layer.txt")

[[ $forbidden_count -eq 0 ]] && check_results+=("Forbidden READONLY:✅:0 issues") || check_results+=("Forbidden READONLY:❌:$forbidden_count issues")
[[ $cross_count -eq 0 ]] && check_results+=("Cross-module:✅:0 issues") || check_results+=("Cross-module:❌:$cross_count issues")
[[ $missing_ignore_count -eq 0 ]] && check_results+=("Missing @ts-ignore:✅:0 warnings") || check_results+=("Missing @ts-ignore:⚠️:$missing_ignore_count warnings")
[[ $prisma_ssot_count -eq 0 ]] && check_results+=("Prisma SSOT bypass:✅:0 issues") || check_results+=("Prisma SSOT bypass:❌:$prisma_ssot_count issues")
[[ $barrel_count -eq 0 ]] && check_results+=("Barrel db_models.dto:✅:0 issues") || check_results+=("Barrel db_models.dto:❌:$barrel_count issues")
if [[ $adapter_bypass_count -le $ADAPTER_BASELINE ]]; then
    check_results+=("Adapter encapsulation:✅:$adapter_bypass_count/$ADAPTER_BASELINE (baseline)")
else
    check_results+=("Adapter encapsulation:❌:$adapter_bypass_count (baseline: $ADAPTER_BASELINE)")
fi
[[ $reverse_layer_count -eq 0 ]] && check_results+=("Reverse layer components→features:✅:0 issues") || check_results+=("Reverse layer components→features:❌:$reverse_layer_count issues")

# Display
print_table_header "Check" "Status" "Issues"
for result in "${check_results[@]}"; do
    IFS=':' read -r check status issues <<< "$result"
    print_table_row "$check" "$status" "$issues" ""
done
print_table_footer

# Violation details
[[ $forbidden_count -gt 0 ]] && {
    echo -e "\n${BOLD}${RED}Forbidden READONLY imports:${NC}"
    head -5 "$TMPDIR_IH/forbidden.txt" | while IFS=: read -r file line content; do
        echo -e "   ${RED}$file:$line${NC} → $content"
    done
    [[ $forbidden_count -gt 5 ]] && echo -e "   ${YELLOW}... and $((forbidden_count - 5)) more${NC}"
}

[[ $cross_count -gt 0 ]] && {
    echo -e "\n${BOLD}${RED}Cross-module imports:${NC}"
    [[ -s "$TMPDIR_IH/main_to_web.txt" ]] && { echo -e "   ${BLUE}main/ → web-1/:${NC}"; head -3 "$TMPDIR_IH/main_to_web.txt"; }
    [[ -s "$TMPDIR_IH/web_to_main.txt" ]] && { echo -e "   ${BLUE}web-1/ → main/:${NC}"; head -3 "$TMPDIR_IH/web_to_main.txt"; }
}

[[ $missing_ignore_count -gt 0 ]] && {
    echo -e "\n${BOLD}${YELLOW}Missing @ts-ignore:${NC}"
    head -5 "$TMPDIR_IH/missing_ignore.txt" | while IFS=: read -r file line content; do
        echo -e "   ${YELLOW}$file:$line${NC}"
    done
}

[[ $prisma_ssot_count -gt 0 ]] && {
    echo -e "\n${BOLD}${RED}Prisma SSOT bypass:${NC}"
    head -5 "$TMPDIR_IH/prisma_ssot.txt" | while IFS=: read -r file line content; do
        echo -e "   ${RED}$file:$line${NC}"
    done
}

[[ $barrel_count -gt 0 ]] && {
    echo -e "\n${BOLD}${RED}Barrel db_models.dto imports:${NC}"
    head -5 "$TMPDIR_IH/barrel.txt" | while IFS=: read -r file line content; do
        echo -e "   ${RED}$file:$line${NC}"
    done
}

[[ $adapter_bypass_count -gt $ADAPTER_BASELINE ]] && {
    echo -e "\n${BOLD}${RED}Direct adapter imports (bypass email-transport):${NC}"
    head -5 "$TMPDIR_IH/adapter_bypass.txt" | while IFS=: read -r file line content; do
        echo -e "   ${RED}$file:$line${NC}"
    done
}

[[ $reverse_layer_count -gt 0 ]] && {
    echo -e "\n${BOLD}${RED}Reverse-layer imports (components/ → features/):${NC}"
    head -5 "$TMPDIR_IH/reverse_layer.txt" | while IFS=: read -r file line content; do
        echo -e "   ${RED}$file:$line${NC} → $content"
    done
    [[ $reverse_layer_count -gt 5 ]] && echo -e "   ${YELLOW}... and $((reverse_layer_count - 5)) more${NC}"
}

# How to fix
adapter_errors=0; [[ $adapter_bypass_count -gt $ADAPTER_BASELINE ]] && adapter_errors=$((adapter_bypass_count - ADAPTER_BASELINE))
total_errors=$((forbidden_count + cross_count + prisma_ssot_count + barrel_count + adapter_errors + reverse_layer_count))
if [[ $total_errors -gt 0 ]] || [[ $missing_ignore_count -gt 0 ]]; then
    echo -e "\n${YELLOW}HOW TO FIX:${NC}"
    [[ $forbidden_count -gt 0 ]] && echo "   Remove READONLY-shared-kernel imports from .shared-kernel"
    [[ $cross_count -gt 0 ]] && echo "   Remove cross-imports between main/ and web-1/ — use .shared-kernel"
    [[ $missing_ignore_count -gt 0 ]] && echo "   Add // @ts-ignore above node_modules imports in .shared-kernel"
    [[ $prisma_ssot_count -gt 0 ]] && echo "   Import enums from READONLY-shared-kernel, not prisma/js-client"
    [[ $barrel_count -gt 0 ]] && echo "   Import from db_models.generated.dto or .manual.dto directly"
    [[ $adapter_bypass_count -gt $ADAPTER_BASELINE ]] && echo "   Use email-transport facade instead of direct adapter imports"
    [[ $reverse_layer_count -gt 0 ]] && echo "   Move the file to UI/features/ (it depends on features) — components/ must not import features/"
fi

echo

if [[ $total_errors -gt 0 ]]; then
    print_error "IMPORTS HEALTH FAILED"
    exit 1
else
    print_success "IMPORTS HEALTH PASSED"
    [[ $missing_ignore_count -gt 0 ]] && echo -e "   ${YELLOW}(with $missing_ignore_count warnings)${NC}"
    exit 0
fi
