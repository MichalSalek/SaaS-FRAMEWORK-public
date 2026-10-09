#!/bin/bash

# Trap for cleanup (all temp files this script creates)
trap 'rm -f /tmp/kernel_sync_* /tmp/sync_details_*' EXIT

# Source utilities
source "$(dirname "$0")/_utils.sh"

print_boxed_header "KERNEL SYNC AUDIT"

# Get project root
PROJECT_ROOT=$(get_project_root)

# Base paths
SOURCE_DIR="$PROJECT_ROOT/.shared-kernel"
MAIN_TARGET="$PROJECT_ROOT/main/src/READONLY-shared-kernel"
WEB_TARGET="$PROJECT_ROOT/web-1/src/READONLY-shared-kernel"

# --- Fast-path: checksum cache ---
CHECKSUM_FILE="$PROJECT_ROOT/.kernel-checksum"

# Ta sama detekcja co u PRODUCENTA pliku (scripts/kernel/cp-kernel): GNU md5sum
# (Linux) vs BSD `md5 -r` (macOS — staging build box). Konsument liczacy na sztywno
# `md5sum` na macOS dostawal pusty hash i fast-path nigdy nie trafial: audyt dalej
# byl POPRAWNY (spadal na wolna sciezke), ale cache producenta byl tam martwy.
# Uzywane UNQUOTED — "md5 -r" musi rozpasc sie na komende + flage.
if command -v md5sum >/dev/null 2>&1; then
  MD5_CMD="md5sum"
else
  MD5_CMD="md5 -r"
fi
if [[ -f "$CHECKSUM_FILE" ]] && [[ -d "$SOURCE_DIR" ]] && [[ -d "$MAIN_TARGET" ]] && [[ -d "$WEB_TARGET" ]]; then
  # Regenerate current checksum (source content)
  CURRENT_CHECKSUM=$(find "$SOURCE_DIR" -type f \
    -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.idea/*' \
    -print0 | sort -z | xargs -0 $MD5_CMD 2>/dev/null)

  CACHED_CHECKSUM=$(grep -v '^FILES_\|^HASH_' "$CHECKSUM_FILE" 2>/dev/null)

  # Check file counts too
  MAIN_COUNT=$(find "$MAIN_TARGET" -type f | wc -l)
  WEB1_COUNT=$(find "$WEB_TARGET" -type f | wc -l)
  CACHED_MAIN=$(grep '^FILES_MAIN=' "$CHECKSUM_FILE" 2>/dev/null | cut -d= -f2)
  CACHED_WEB1=$(grep '^FILES_WEB1=' "$CHECKSUM_FILE" 2>/dev/null | cut -d= -f2)

  # Content hashes for target directories (detects edits to READONLY files)
  MAIN_HASH=$(find "$MAIN_TARGET" -type f -print0 | sort -z | xargs -0 $MD5_CMD 2>/dev/null | $MD5_CMD | cut -d' ' -f1)
  WEB1_HASH=$(find "$WEB_TARGET" -type f -print0 | sort -z | xargs -0 $MD5_CMD 2>/dev/null | $MD5_CMD | cut -d' ' -f1)
  CACHED_MAIN_HASH=$(grep '^HASH_MAIN=' "$CHECKSUM_FILE" 2>/dev/null | cut -d= -f2)
  CACHED_WEB1_HASH=$(grep '^HASH_WEB1=' "$CHECKSUM_FILE" 2>/dev/null | cut -d= -f2)

  if [[ "$CURRENT_CHECKSUM" == "$CACHED_CHECKSUM" ]] && \
     [[ "$MAIN_COUNT" == "$CACHED_MAIN" ]] && \
     [[ "$WEB1_COUNT" == "$CACHED_WEB1" ]] && \
     [[ "$MAIN_HASH" == "$CACHED_MAIN_HASH" ]] && \
     [[ "$WEB1_HASH" == "$CACHED_WEB1_HASH" ]]; then
    echo -e "${GREEN}  Checksum match — kernel in sync (fast-path)${NC}"
    print_success "KERNEL SYNC PASSED"
    exit 0
  fi
fi
# --- End fast-path ---

out_of_sync=0
sync_results=()
PERM_DRIFT_TOTAL=0

# Check if directories exist
check_directories() {
    local missing=0
    
    if [[ ! -d "$SOURCE_DIR" ]]; then
        echo "❌ Source directory $SOURCE_DIR not found"
        missing=1
    fi
    
    if [[ ! -d "$MAIN_TARGET" ]]; then
        echo "❌ Target directory $MAIN_TARGET not found"
        missing=1
    fi
    
    if [[ ! -d "$WEB_TARGET" ]]; then
        echo "❌ Target directory $WEB_TARGET not found"
        missing=1
    fi
    
    return $missing
}

# Check if file is text (not binary)
is_text() {
    file -b --mime-type "$1" | grep -q "^text/"
    return $?
}

# Analyze differences with detailed categorization
analyze_differences() {
    local source="$1"
    local target="$2"
    local temp_file="/tmp/kernel_sync_$$"
    
    # Get all files from both directories
    find "$source" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/.idea/*" -not -path "*/.vscode/*" -not -name "*.log" | sort > "${temp_file}_source"
    find "$target" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/.idea/*" -not -path "*/.vscode/*" -not -name "*.log" | sort > "${temp_file}_target"
    
    # Convert to relative paths
    sed "s|^$source/||" "${temp_file}_source" > "${temp_file}_source_rel"
    sed "s|^$target/||" "${temp_file}_target" > "${temp_file}_target_rel"
    
    # Find new, deleted, and common files
    comm -23 "${temp_file}_source_rel" "${temp_file}_target_rel" > "${temp_file}_new"
    comm -13 "${temp_file}_source_rel" "${temp_file}_target_rel" > "${temp_file}_deleted"
    comm -12 "${temp_file}_source_rel" "${temp_file}_target_rel" > "${temp_file}_common"
    
    local new_count=$(wc -l < "${temp_file}_new")
    local deleted_count=$(wc -l < "${temp_file}_deleted")
    local modified_count=0
    local total_lines_changed=0
    local perm_drift_count=0
    
    # Check for modifications in common files
    while IFS= read -r rel_path; do
        local source_file="$source/$rel_path"
        local target_file="$target/$rel_path"
        
        # Handle symlinks
        if [[ -L "$source_file" ]] || [[ -L "$target_file" ]]; then
            if [[ "$(readlink "$source_file" 2>/dev/null)" != "$(readlink "$target_file" 2>/dev/null)" ]]; then
                ((modified_count++))
            fi
            continue
        fi
        
        # Zawartość (twardo) + uprawnienia kopii READONLY, docelowo 444 (miękko).
        # DECISION (nie usuwaj tego komentarza): zły bit uprawnień NIE jest
        # rozsynchronizowaniem i NIE czerwieni bramki — jest liczony osobno i
        # raportowany jako ostrzeżenie. Git nie przechowuje bitu read-only
        # (jedynie executable), więc KAŻDY świeży `clone --recursive` (i każdy
        # checkout w CI) materializuje kopie jako 644. Wcześniej check był
        # pomijany tylko pod CI, przez co pierwszy `audit:all` po klonie dawał
        # 100/101 z jedynym failem "M:159, lines changed: 0" przy kernelu
        # identycznym co do bajtu — czerwona bramka za nie-problem uczy
        # ignorować bramki. To, przed czym check miał chronić — ręczny
        # `chmod +w` ORAZ edycja kopii — łapie porównanie zawartości niżej,
        # które zostaje twarde. Sam `chmod` bez edycji nie zmienia niczego,
        # co propaguje się dalej; naprawia go `npm run system:kernel`.

        # Compare file contents
        if ! cmp -s "$source_file" "$target_file"; then
            ((modified_count++))
            
            # Count lines changed for text files
            if is_text "$source_file"; then
                local lines_diff=$(diff -u "$source_file" "$target_file" 2>/dev/null | grep -E "^[+-]" | grep -v "^[+-]{3}" | wc -l)
                total_lines_changed=$((total_lines_changed + lines_diff))
            else
                total_lines_changed=$((total_lines_changed + 1))  # Binary files count as 1 change
            fi
        else
            # Zawartość zgodna — zostaje tylko bit uprawnień. Liczony DOPIERO tutaj,
            # żeby ostrzeżenie "(zawartość zgodna)" nigdy nie kłamało o pliku, który
            # ma realny diff.
            local target_perms
            target_perms=$(stat -c %a "$target_file" 2>/dev/null)
            if [[ "$target_perms" != "444" ]]; then
                ((perm_drift_count++))
            fi
        fi
    done < "${temp_file}_common"
    
    echo "$new_count:$deleted_count:$modified_count:$total_lines_changed:$perm_drift_count"
}

# Show detailed diff preview with syntax highlighting hints
show_diff_preview() {
    local source="$1"
    local target="$2"
    local temp_file="/tmp/kernel_sync_preview_$$"
    
    echo -e "\n${BOLD}📋 Diff Preview:${NC}"
    
    # Get differences with context
    diff -r --exclude=".git" --exclude="node_modules" --exclude=".idea" --exclude=".vscode" --exclude="*.log" "$source" "$target" 2>/dev/null > "$temp_file"
    
    if [[ -s "$temp_file" ]]; then
        local file_count=0
        local current_file=""
        local line_count=0
        
        while IFS= read -r line; do
            # Detect new file being processed
            if [[ "$line" =~ ^diff\ -r ]]; then
                if [[ $file_count -ge 3 ]]; then
                    break
                fi
                ((file_count++))
                current_file=$(echo "$line" | awk '{print $NF}')
                line_count=0
                echo -e "   ${BLUE}📄 $current_file${NC}"
                continue
            fi
            
            # Show first 3 lines of each file diff with syntax highlighting
            if [[ $line_count -lt 3 ]] && [[ "$line" =~ ^[\<\>\+\-] ]]; then
                if [[ "$line" =~ ^[\+] ]]; then
                    echo -e "      ${GREEN}$line${NC}"
                elif [[ "$line" =~ ^[\-] ]]; then
                    echo -e "      ${RED}$line${NC}"
                else
                    echo "      $line"
                fi
                ((line_count++))
            elif [[ $line_count -eq 3 ]]; then
                echo -e "      ${YELLOW}... (truncated)${NC}"
                ((line_count++))
            fi
        done < "$temp_file"
        
        local total_files=$(grep -c "^diff -r" "$temp_file")
        if [[ $total_files -gt 3 ]]; then
            echo -e "   ${YELLOW}... and $((total_files - 3)) more files${NC}"
        fi
    fi
    
    rm -f "$temp_file"
}

check_sync() {
    local target_dir="$1"
    local target_name="$2"
    
    # Analyze differences
    local stats
    stats=$(analyze_differences "$SOURCE_DIR" "$target_dir")
    IFS=':' read -r new_count deleted_count modified_count lines_changed perm_drift <<< "$stats"

    if [[ "$perm_drift" -gt 0 ]]; then
        PERM_DRIFT_TOTAL=$((PERM_DRIFT_TOTAL + perm_drift))
    fi
    
    local total_changes=$((new_count + deleted_count + modified_count))
    
    if [[ $total_changes -eq 0 ]]; then
        sync_results+=("$target_name:✅:In sync")
        return 0
    else
        local changes_summary="N:$new_count M:$modified_count D:$deleted_count"
        sync_results+=("$target_name:❌:$changes_summary")
        
        # Store details for later display
        echo "DETAILS_$target_name" > "/tmp/sync_details_$(echo "$target_name" | tr '/' '_')"
        echo "New files: $new_count" >> "/tmp/sync_details_$(echo "$target_name" | tr '/' '_')"
        echo "Modified files: $modified_count" >> "/tmp/sync_details_$(echo "$target_name" | tr '/' '_')"
        echo "Deleted files: $deleted_count" >> "/tmp/sync_details_$(echo "$target_name" | tr '/' '_')"
        echo "Lines changed: $lines_changed" >> "/tmp/sync_details_$(echo "$target_name" | tr '/' '_')"
        
        # Show diff preview if not too large
        if [[ $total_changes -le 10 ]]; then
            show_diff_preview "$SOURCE_DIR" "$target_dir" >> "/tmp/sync_details_$(echo "$target_name" | tr '/' '_')"
        fi
        
        return 1
    fi
}

# Check directories exist
if ! check_directories; then
    print_error "KERNEL SYNC FAILED: Required directories missing"
    exit 1
fi

echo "Comparing $SOURCE_DIR with target directories..."

# Check main/
if ! check_sync "$MAIN_TARGET" "main/"; then
    out_of_sync=1
fi

# Check web-1/
if ! check_sync "$WEB_TARGET" "web-1/"; then
    out_of_sync=1
fi

# Display results table
print_table_header "Target" "Status" "Changes"

for result in "${sync_results[@]}"; do
    IFS=':' read -r target status changes <<< "$result"
    if [[ "$status" == "✅" ]]; then
        print_table_row "$target" "$status" "$changes" ""
    else
        print_table_row "$target" "$status" "$changes" ""
    fi
done

print_table_footer

# Show details for out-of-sync targets
for result in "${sync_results[@]}"; do
    IFS=':' read -r target status changes <<< "$result"
    if [[ "$status" == "❌" ]]; then
        echo -e "\n${BOLD}${RED}Details for $target:${NC}"
        details_file="/tmp/sync_details_$(echo "$target" | tr '/' '_')"
        if [[ -f "$details_file" ]]; then
            while IFS= read -r line; do
                if [[ "$line" =~ ^DETAILS_ ]]; then
                    continue
                elif [[ "$line" =~ ^📋 ]]; then
                    echo -e "${BOLD}$line${NC}"
                elif [[ "$line" =~ ^New\ files:|^Modified\ files:|^Deleted\ files:|^Lines\ changed: ]]; then
                    echo "   📊 $line"
                else
                    echo "$line"
                fi
            done < "$details_file"
        fi
    fi
done

echo

if [[ $PERM_DRIFT_TOTAL -gt 0 ]]; then
    echo -e "${YELLOW}  [WARN] pliki kopii READONLY bez trybu 444: $PERM_DRIFT_TOTAL (zawartość zgodna).${NC}"
    echo -e "${YELLOW}         Normalne po świeżym klonie — przywraca: npm run system:kernel${NC}"
    echo
fi

if [[ $out_of_sync -eq 1 ]]; then
    echo -e "${YELLOW}🔧 HOW TO FIX: sprawdź package.json${NC}"
    echo
    print_error "KERNEL SYNC FAILED"
    exit 1
else
    print_success "KERNEL SYNC PASSED"
    exit 0
fi
