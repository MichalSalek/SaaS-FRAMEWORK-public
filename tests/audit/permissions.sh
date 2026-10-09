#!/bin/bash

# Source utilities
source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)
CQRS_CONFIG="$PROJECT_ROOT/.shared-kernel/domain/commands-and-queries/cqrs.config.ts"
APP_EVENTS_CONST="$PROJECT_ROOT/.shared-kernel/domain/events/app-events.const.ts"
PERMISSIONS_CONFIG="$PROJECT_ROOT/.shared-kernel/domain/permissions/permissions.config.ts"
PERMISSIONS_BACKEND_CONFIG="$PROJECT_ROOT/.shared-kernel/application/role-permissions.ts"
PERMISSIONS_SEED="$PROJECT_ROOT/web-1/src/application/permissions/permissions.seed.ts"

# Baseline: number of events accessible ONLY via MASTER_ADMIN wildcard (no explicit role)
# If this count INCREASES, it means someone removed an explicit permission — FAIL the audit.
# Update this baseline ONLY when intentionally adding admin-only events.
# DECISION (nie usuwaj tego komentarza): ratchet zaciśnięty 57→55 = aktualny faktyczny
# stan admin-only eventów (zweryfikowane uruchomieniem audytu). 2-eventowy luz został
# zamknięty, więc KAŻDY nowy admin-only event przekroczy baseline i zatrzyma bramkę,
# wymuszając świadomą decyzję: nadać jawną rolę (STYLIST/CLIENT) albo celowo podbić ten
# baseline. Admin-only-via-wildcard (getAllEvents MASTER_ADMIN) to LEGALNY stan z założenia
# (56 takich eventów istnieje by design; +1 2026-07-08: ADMIN_GET_ATTENTION_COUNTS,
# badge-liczniki sidebara admina; +2 2026-08-19: ADMIN_GET_LOG_GROUPS /
# ADMIN_SET_LOG_ISSUE_STATUS — triage logów jest narzędziem wyłącznie admina, żadna
# rola produktowa nie ma powodu czytać cudzych błędów ani zmieniać ich statusu;
# +1 2026-09-23: ADMIN_GET_LOG_DETAILS — szczegóły jednego wpisu, ten sam powód;
# +1 2026-09-23: ADMIN_GET_EMAIL_PIPELINE — podgląd kolejki maili i statystyki kodów,
# dane cudzych kont, więc wyłącznie admin;
# +1 2026-09-23: INTERNAL_SWEEP_TICK — publiczny zegar sweepów dla monitora Better Stack,
# handler withPublicHandler jak INTERNAL_HEALTH_PUBLIC, poza RBAC, więc bez roli w zbiorach)
# — dlatego ratchet, NIE twardy wymóg "każdy event musi mieć jawną non-wildcard rolę"
# (taki check fałszywie failowałby te 56 eventów).
BASELINE_ADMIN_ONLY_EVENTS=62

# Cleanup function
cleanup() {
    rm -f /tmp/commands.txt /tmp/queries.txt /tmp/all_cqrs_events.txt /tmp/permission_events.txt /tmp/events_without_permissions.txt /tmp/orphaned_permissions.txt
    rm -f /tmp/admin_events.txt /tmp/events_without_permissions_filtered.txt
    rm -f /tmp/missing_admin.txt /tmp/missing_user.txt /tmp/missing_gallery.txt /tmp/missing_account.txt /tmp/missing_session.txt /tmp/missing_favorite.txt /tmp/missing_other.txt /tmp/categorized_missing.txt
    rm -f /tmp/role_permissions.txt /tmp/wildcard_roles.txt
}

# Set trap for cleanup
trap cleanup EXIT

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                            🔐 PERMISSIONS AUDIT                              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# File existence checks
check_required_files() {
    local missing_files=()
    
    if [[ ! -f "$CQRS_CONFIG" ]]; then
        missing_files+=("CQRS config: $CQRS_CONFIG")
    fi
    
    if [[ ! -f "$APP_EVENTS_CONST" ]]; then
        missing_files+=("App Events Const: $APP_EVENTS_CONST")
    fi
    
    if [[ ! -f "$PERMISSIONS_CONFIG" ]]; then
        missing_files+=("Permissions config: $PERMISSIONS_CONFIG")
    fi
    
    if [[ ! -f "$PERMISSIONS_BACKEND_CONFIG" ]]; then
        missing_files+=("Permissions backend config: $PERMISSIONS_BACKEND_CONFIG")
    fi
    
    if [[ ${#missing_files[@]} -gt 0 ]]; then
        print_error "Missing required files:"
        for file in "${missing_files[@]}"; do
            echo -e "  ${RED}• $file${NC}"
        done
        print_error "Cannot proceed with audit"
        exit 1
    fi
}

# Extract all COMMAND and QUERY events from app-events.const.ts using shared awk parser
extract_cqrs_events() {
    # Use shared extraction function (robust awk-based, no fragile sed ranges)
    extract_handler_events "$APP_EVENTS_CONST" | awk -F'\t' '$1=="COMMANDS" {print $3}' | sort > /tmp/commands.txt
    extract_handler_events "$APP_EVENTS_CONST" | awk -F'\t' '$1=="QUERIES" {print $3}' | sort > /tmp/queries.txt

    # Validate extraction
    local commands_count=$(wc -l < /tmp/commands.txt 2>/dev/null || echo "0")
    local queries_count=$(wc -l < /tmp/queries.txt 2>/dev/null || echo "0")

    if [[ $commands_count -eq 0 && $queries_count -eq 0 ]]; then
        print_error "Failed to extract events from App Events Const"
        print_error "Commands found: $commands_count, Queries found: $queries_count"
        print_error "Check file format and syntax: $APP_EVENTS_CONST"
        exit 1
    fi

    # Combine and deduplicate
    extract_handler_events "$APP_EVENTS_CONST" | awk -F'\t' '{print $3}' | sort -u > /tmp/all_cqrs_events.txt
}

# Extract events that have permissions configured with enhanced parsing
extract_permission_events() {
    > /tmp/permission_events.txt
    > /tmp/role_permissions.txt
    > /tmp/wildcard_roles.txt
    
    # Extract permission sets from permissions.config.ts
    local config_content=$(cat "$PERMISSIONS_BACKEND_CONFIG")
    
    # Extract from BASE_PERMISSIONS
    echo "$config_content" | sed -n '/BASE_PERMISSIONS = \[/,/\] as const;/p' | \
        grep -oE "APP_EVENTS\.[A-Z_.]+" | sed 's/.*\.//' >> /tmp/permission_events.txt
    
    # Extract from LOGGED_USER_PERMISSIONS
    echo "$config_content" | sed -n '/LOGGED_USER_PERMISSIONS = \[/,/\] as const;/p' | \
        grep -oE "APP_EVENTS\.[A-Z_.]+" | sed 's/.*\.//' >> /tmp/permission_events.txt
    
    # Extract from STYLIST_SPECIFIC_PERMISSIONS
    echo "$config_content" | sed -n '/STYLIST_SPECIFIC_PERMISSIONS = \[/,/\] as const;/p' | \
        grep -oE "APP_EVENTS\.[A-Z_.]+" | sed 's/.*\.//' >> /tmp/permission_events.txt
    
    # Extract from CLIENT_SPECIFIC_PERMISSIONS
    echo "$config_content" | sed -n '/CLIENT_SPECIFIC_PERMISSIONS = \[/,/\] as const;/p' | \
        grep -oE "APP_EVENTS\.[A-Z_.]+" | sed 's/.*\.//' >> /tmp/permission_events.txt
    
    # Deduplicate
    sort -u /tmp/permission_events.txt -o /tmp/permission_events.txt
    
    # Count roles (hardcoded - we know the structure)
    echo "Role: NOT_LOGGED_IN (BASE_PERMISSIONS)" > /tmp/role_permissions.txt
    echo "Role: CLIENT_ROLE (LOGGED_USER + CLIENT_SPECIFIC)" >> /tmp/role_permissions.txt
    echo "Role: STYLIST_ROLE (LOGGED_USER + STYLIST_SPECIFIC)" >> /tmp/role_permissions.txt
    echo "Role: MASTER_ADMIN (getAllEvents() - WILDCARD)" >> /tmp/role_permissions.txt
    # INTENTIONAL HARDCODE: MASTER_ADMIN wildcard status is verified dynamically below
    # (line ~420: grep for getAllEvents in MASTER_ADMIN role section of permissions.seed.ts).
    # This line only sets the display text for the role summary table.
    echo "MASTER_ADMIN: getAllEvents() - WILDCARD ACCESS" > /tmp/wildcard_roles.txt
    
    # Validate extraction
    local events_count=$(wc -l < /tmp/permission_events.txt 2>/dev/null || echo "0")
    
    if [[ $events_count -eq 0 ]]; then
        print_warning "No permissions extracted from $PERMISSIONS_BACKEND_CONFIG"
    else
        print_info "Extracted $events_count permission events from 4 roles"
    fi
}

# Main audit logic with enhanced error handling
main() {
    print_info "Checking required files..."
    check_required_files
    
    print_info "Extracting CQRS events..."
    extract_cqrs_events
    
    print_info "Extracting permission events..."
    extract_permission_events
    
    # Count events with validation
    if [[ ! -f /tmp/all_cqrs_events.txt ]]; then
        print_error "Failed to create CQRS events file"
        exit 1
    fi
    
    TOTAL_CQRS=$(wc -l < /tmp/all_cqrs_events.txt 2>/dev/null || echo "0")
    TOTAL_COMMANDS=$(wc -l < /tmp/commands.txt 2>/dev/null || echo "0")
    TOTAL_QUERIES=$(wc -l < /tmp/queries.txt 2>/dev/null || echo "0")
    TOTAL_WITH_PERMISSIONS=$(wc -l < /tmp/permission_events.txt 2>/dev/null || echo "0")
    
    # Validate counts
    if [[ $TOTAL_CQRS -eq 0 ]]; then
        print_error "No CQRS events found - check CQRS config format"
        exit 1
    fi
    
    print_separator
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                                📊 SUMMARY                                    ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    printf "%-25s %s\n" "📋 Total COMMAND events:" "$TOTAL_COMMANDS"
    printf "%-25s %s\n" "🔍 Total QUERY events:" "$TOTAL_QUERIES"
    printf "%-25s %s\n" "⚡ Total CQRS events:" "$TOTAL_CQRS"
    printf "%-25s %s\n" "🔐 Events with permissions:" "$TOTAL_WITH_PERMISSIONS"
    echo ""
    
    # Check for wildcard permissions
    MASTER_ADMIN_HAS_ALL=false
    if [[ -s /tmp/wildcard_roles.txt ]]; then
        MASTER_ADMIN_HAS_ALL=true
        print_info "Found wildcard permissions (MASTER_ADMIN has all events):"
        while IFS= read -r wildcard; do
            echo -e "  ${YELLOW}• $wildcard${NC}"
        done < /tmp/wildcard_roles.txt
    fi
    
    print_separator
    
    # Find events without permissions
    if [[ -f /tmp/all_cqrs_events.txt && -f /tmp/permission_events.txt ]]; then
        comm -23 /tmp/all_cqrs_events.txt /tmp/permission_events.txt > /tmp/events_without_permissions.txt
    else
        print_error "Missing temporary files for comparison"
        exit 1
    fi
    
    # MASTER_ADMIN wildcard covers ALL events, so technically no event is "without permissions"
    # But we still want to warn about events that are ONLY accessible via wildcard (no explicit role)
    # This is important for security audit - every event should have at least one explicit role OR be admin-only
    
    EVENTS_WITHOUT_PERMISSIONS=$(wc -l < /tmp/events_without_permissions.txt 2>/dev/null || echo "0")
    
    # Find orphaned permissions
    comm -13 /tmp/all_cqrs_events.txt /tmp/permission_events.txt > /tmp/orphaned_permissions.txt 2>/dev/null || touch /tmp/orphaned_permissions.txt
    ORPHANED_PERMISSIONS=$(wc -l < /tmp/orphaned_permissions.txt 2>/dev/null || echo "0")
    
    echo ""
    echo -e "${RED}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                        🚨 EVENTS WITHOUT PERMISSIONS                         ║${NC}"
    echo -e "${RED}║                              (SECURITY HOLE)                                 ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    if [[ $EVENTS_WITHOUT_PERMISSIONS -gt 0 ]]; then
        echo -e "${RED}⚠️  CRITICAL: Found $EVENTS_WITHOUT_PERMISSIONS events without permissions${NC}"
        echo ""
        
        # Categorize missing events with enhanced patterns first
        grep -E "^(ADMIN_|BECOME_|SWITCH_|GET_LOGS|GET_NOTES|SAVE_NOTE|SET_MAIN_NOTE|MASTER_ADMIN_)" /tmp/events_without_permissions.txt > /tmp/missing_admin.txt 2>/dev/null || touch /tmp/missing_admin.txt
        grep -E "^(USER_)" /tmp/events_without_permissions.txt > /tmp/missing_user.txt 2>/dev/null || touch /tmp/missing_user.txt
        grep -E "^(GALLERY_|CREATE_GALLERY|DELETE_GALLERY|UPDATE_GALLERY|GET_GALLERY)" /tmp/events_without_permissions.txt > /tmp/missing_gallery.txt 2>/dev/null || touch /tmp/missing_gallery.txt
        grep -E "^(ACCOUNT_)" /tmp/events_without_permissions.txt > /tmp/missing_account.txt 2>/dev/null || touch /tmp/missing_account.txt
        grep -E "^(SESSION_)" /tmp/events_without_permissions.txt > /tmp/missing_session.txt 2>/dev/null || touch /tmp/missing_session.txt
        grep -E "^(FAVORITE_|FOLLOW_|UNFOLLOW_|GET_FOLLOWED_)" /tmp/events_without_permissions.txt > /tmp/missing_favorite.txt 2>/dev/null || touch /tmp/missing_favorite.txt
        
        # Calculate counts
        MISSING_ADMIN=$(wc -l < /tmp/missing_admin.txt 2>/dev/null || echo "0")
        MISSING_USER=$(wc -l < /tmp/missing_user.txt 2>/dev/null || echo "0")
        MISSING_GALLERY=$(wc -l < /tmp/missing_gallery.txt 2>/dev/null || echo "0")
        MISSING_ACCOUNT=$(wc -l < /tmp/missing_account.txt 2>/dev/null || echo "0")
        MISSING_SESSION=$(wc -l < /tmp/missing_session.txt 2>/dev/null || echo "0")
        MISSING_FAVORITE=$(wc -l < /tmp/missing_favorite.txt 2>/dev/null || echo "0")
        
        # Calculate other events (not in above categories) via set difference
        cat /tmp/missing_admin.txt /tmp/missing_user.txt /tmp/missing_gallery.txt /tmp/missing_account.txt /tmp/missing_session.txt /tmp/missing_favorite.txt | sort > /tmp/categorized_missing.txt
        comm -23 /tmp/events_without_permissions.txt /tmp/categorized_missing.txt > /tmp/missing_other.txt 2>/dev/null || touch /tmp/missing_other.txt
        MISSING_OTHER=$(wc -l < /tmp/missing_other.txt 2>/dev/null || echo "0")

        # Domain summary table
        echo -e "${BLUE}┌─────────────────┬───────┬──────────────────────────────────────────────┐${NC}"
        echo -e "${BLUE}│ Domain          │ Count │ Severity                                     │${NC}"
        echo -e "${BLUE}├─────────────────┼───────┼──────────────────────────────────────────────┤${NC}"
        
        printf "${BLUE}│${NC} %-15s ${BLUE}│${NC} %5s ${BLUE}│${NC} %-44s ${BLUE}│${NC}\n" "Admin" "$MISSING_ADMIN" "$([ "$MISSING_ADMIN" -gt 0 ] 2>/dev/null && echo -e "${RED}CRITICAL${NC}" || echo -e "${GREEN}OK${NC}")"
        printf "${BLUE}│${NC} %-15s ${BLUE}│${NC} %5s ${BLUE}│${NC} %-44s ${BLUE}│${NC}\n" "User" "$MISSING_USER" "$([ "$MISSING_USER" -gt 0 ] 2>/dev/null && echo -e "${RED}HIGH${NC}" || echo -e "${GREEN}OK${NC}")"
        printf "${BLUE}│${NC} %-15s ${BLUE}│${NC} %5s ${BLUE}│${NC} %-44s ${BLUE}│${NC}\n" "Gallery" "$MISSING_GALLERY" "$([ "$MISSING_GALLERY" -gt 0 ] 2>/dev/null && echo -e "${YELLOW}MEDIUM${NC}" || echo -e "${GREEN}OK${NC}")"
        printf "${BLUE}│${NC} %-15s ${BLUE}│${NC} %5s ${BLUE}│${NC} %-44s ${BLUE}│${NC}\n" "Account" "$MISSING_ACCOUNT" "$([ "$MISSING_ACCOUNT" -gt 0 ] 2>/dev/null && echo -e "${YELLOW}MEDIUM${NC}" || echo -e "${GREEN}OK${NC}")"
        printf "${BLUE}│${NC} %-15s ${BLUE}│${NC} %5s ${BLUE}│${NC} %-44s ${BLUE}│${NC}\n" "Session" "$MISSING_SESSION" "$([ "$MISSING_SESSION" -gt 0 ] 2>/dev/null && echo -e "${YELLOW}MEDIUM${NC}" || echo -e "${GREEN}OK${NC}")"
        printf "${BLUE}│${NC} %-15s ${BLUE}│${NC} %5s ${BLUE}│${NC} %-44s ${BLUE}│${NC}\n" "Favorite" "$MISSING_FAVORITE" "$([ "$MISSING_FAVORITE" -gt 0 ] 2>/dev/null && echo -e "${YELLOW}MEDIUM${NC}" || echo -e "${GREEN}OK${NC}")"
        printf "${BLUE}│${NC} %-15s ${BLUE}│${NC} %5s ${BLUE}│${NC} %-44s ${BLUE}│${NC}\n" "Other" "$MISSING_OTHER" "$([ "$MISSING_OTHER" -gt 0 ] 2>/dev/null && echo -e "${YELLOW}REVIEW${NC}" || echo -e "${GREEN}OK${NC}")"
        
        echo -e "${BLUE}└─────────────────┴───────┴──────────────────────────────────────────────┘${NC}"
        echo ""
        
        # Display categorized results with line numbers and file references
        display_missing_category() {
            local category="$1"
            local file="$2"
            local count="$3"
            local suggestion="$4"
            
            if [[ $count -gt 0 ]]; then
                echo -e "  ${RED}$category events ($count):${NC} ${YELLOW}$suggestion${NC}"
                while IFS= read -r event; do
                    if [[ -n "$event" ]]; then
                        # Find line number in App Events Const
                        local line_num=$(grep -n "'$event'" "$APP_EVENTS_CONST" 2>/dev/null | head -1 | cut -d: -f1)
                        if [[ -n "$line_num" ]]; then
                            echo -e "    ${RED}• $event${NC} ${GRAY}(line $line_num in app-events.const.ts)${NC}"
                        else
                            echo -e "    ${RED}• $event${NC}"
                        fi
                    fi
                done < "$file"
            fi
        }
        
        display_missing_category "Admin" "/tmp/missing_admin.txt" "$MISSING_ADMIN" "[Suggest: MASTER_ADMIN only]"
        display_missing_category "User" "/tmp/missing_user.txt" "$MISSING_USER" "[Suggest: MASTER_ADMIN + appropriate roles]"
        display_missing_category "Gallery" "/tmp/missing_gallery.txt" "$MISSING_GALLERY" "[Suggest: STYLIST_ROLE + MASTER_ADMIN]"
        display_missing_category "Account" "/tmp/missing_account.txt" "$MISSING_ACCOUNT" "[Suggest: STYLIST_ROLE + CLIENT_ROLE]"
        display_missing_category "Session" "/tmp/missing_session.txt" "$MISSING_SESSION" "[Suggest: All logged roles]"
        display_missing_category "Favorite" "/tmp/missing_favorite.txt" "$MISSING_FAVORITE" "[Suggest: CLIENT_ROLE + STYLIST_ROLE]"
        
        display_missing_category "Other" "/tmp/missing_other.txt" "$MISSING_OTHER" "[Requires manual review]"
    else
        print_success "All CQRS events have permissions configured"
    fi
    
    print_separator
    
    print_header "ORPHANED PERMISSIONS (WARNING)"
    
    if [[ $ORPHANED_PERMISSIONS -gt 0 ]]; then
        print_warning "Found $ORPHANED_PERMISSIONS permissions without corresponding CQRS events:"
        while IFS= read -r event; do
            if [[ -n "$event" ]]; then
                # Find line number in permissions file
                local line_num=$(grep -n "$event" "$PERMISSIONS_SEED" 2>/dev/null | head -1 | cut -d: -f1)
                if [[ -n "$line_num" ]]; then
                    echo -e "  ${YELLOW}• $event${NC} ${GRAY}(line $line_num in permissions.init.ts)${NC}"
                else
                    echo -e "  ${YELLOW}• $event${NC}"
                fi
            fi
        done < /tmp/orphaned_permissions.txt
    else
        print_success "No orphaned permissions found"
    fi
    
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                               👥 ROLE SUMMARY                                ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    # Enhanced role analysis with table format
    if [[ -f "$PERMISSIONS_SEED" ]]; then
        echo -e "${BLUE}┌─────────────────────┬────────┬──────────────────────────────────────────┐${NC}"
        echo -e "${BLUE}│ Role                │ Events │ Status                                   │${NC}"
        echo -e "${BLUE}├─────────────────────┼────────┼──────────────────────────────────────────┤${NC}"
        
        analyze_role_permissions() {
            local role_pattern="$1"
            local role_name="$2"
            
            # Count events for this role
            local count=$(grep -A 300 "$role_pattern" "$PERMISSIONS_SEED" 2>/dev/null | grep -o "APP_EVENTS\.[A-Z_]*\.[A-Z_]*\.[A-Z_]*" | wc -l)
            local status=""
            
            # Check for empty arrays or wildcards
            if grep -A 5 "$role_pattern" "$PERMISSIONS_SEED" 2>/dev/null | grep -q "\[\]"; then
                status="${YELLOW}EMPTY PERMISSIONS${NC}"
            elif grep -A 5 "$role_pattern" "$PERMISSIONS_SEED" 2>/dev/null | grep -q "getAllEvents\|all.*events\|\*"; then
                status="${GREEN}WILDCARD ACCESS${NC}"
            elif [[ $count -gt 0 ]]; then
                status="${GREEN}CONFIGURED${NC}"
            else
                status="${RED}NO PERMISSIONS${NC}"
            fi
            
            printf "${BLUE}│${NC} %-19s ${BLUE}│${NC} %6s ${BLUE}│${NC} %-40s ${BLUE}│${NC}\n" "$role_name" "$count" "$(echo -e "$status")"
        }
        
        analyze_role_permissions "SystemRoleId.NOT_LOGGED_IN" "NOT_LOGGED_IN"
        analyze_role_permissions "SystemRoleId.CLIENT_ROLE" "CLIENT_ROLE"
        analyze_role_permissions "SystemRoleId.STYLIST_ROLE" "STYLIST_ROLE"
        analyze_role_permissions "SystemRoleId.MASTER_ADMIN" "MASTER_ADMIN"
        
        echo -e "${BLUE}└─────────────────────┴────────┴──────────────────────────────────────────┘${NC}"
        echo ""
        
        # Check for nested permission structures
        if grep -q "getAllEvents\|all.*events\|\*" "$PERMISSIONS_SEED"; then
            echo -e "${CYAN}🔄 Dynamic/wildcard permission assignment detected${NC}"
        fi
        
        # Check for role hierarchy issues
        if [[ -f /tmp/role_permissions.txt ]]; then
            echo -e "${CYAN}📋 Role Permission Details:${NC}"
            while IFS= read -r line; do
                if [[ "$line" =~ ^Role: ]]; then
                    echo -e "  ${CYAN}• $line${NC}"
                fi
            done < /tmp/role_permissions.txt
        fi
    fi
    
    print_separator
    
    print_header "HOW TO FIX"
    
    if [[ $EVENTS_WITHOUT_PERMISSIONS -gt 0 ]]; then
        echo -e "${YELLOW}To fix events without permissions:${NC}"
        echo "1. Edit: $PERMISSIONS_SEED"
        echo "2. Add events to appropriate role in getDefaultRolePermissions() function"
        echo "3. Consider role hierarchy and access patterns"
        echo "4. Test with: sprawdź web-1/package.json"
        echo ""
        echo -e "${YELLOW}Example fix for missing events:${NC}"
        echo "  [SystemRoleId.CLIENT_ROLE]: ["
        echo "    APP_EVENTS.COMMANDS.DOMAIN.EXISTING_EVENT,"
        echo "    APP_EVENTS.COMMANDS.DOMAIN.NEW_EVENT_NAME,  // <- Add missing event here"
        echo "  ],"
        echo ""
        echo -e "${YELLOW}Files to check:${NC}"
        echo "  • CQRS Config: $CQRS_CONFIG"
        echo "  • App Events: $APP_EVENTS_CONST"
        echo "  • Permissions Init: $PERMISSIONS_SEED"
    fi
    
    if [[ $ORPHANED_PERMISSIONS -gt 0 ]]; then
        echo -e "${YELLOW}To fix orphaned permissions:${NC}"
        echo "1. Remove unused permissions from $PERMISSIONS_SEED"
        echo "2. Or add corresponding events to $CQRS_CONFIG if needed"
        echo "3. Check if permissions are used in other contexts"
    fi
    
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                              🎯 AUDIT RESULT                                 ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    # Check if MASTER_ADMIN has wildcard access
    HAS_WILDCARD=false
    if [[ -f "$PERMISSIONS_SEED" ]]; then
        # Check if getAllEvents is used in MASTER_ADMIN role assignment (not in comments)
        if grep -A 3 "SystemRoleId.MASTER_ADMIN" "$PERMISSIONS_SEED" | grep -v "//" | grep -q "getAllEvents"; then
            HAS_WILDCARD=true
        fi
    fi
    
    if [[ $EVENTS_WITHOUT_PERMISSIONS -gt 0 ]]; then
        if [[ "$HAS_WILDCARD" == "true" ]]; then
            # Events without explicit permissions but covered by MASTER_ADMIN wildcard
            # BASELINE CHECK: if count increased, someone removed an explicit permission
            if [[ $EVENTS_WITHOUT_PERMISSIONS -gt $BASELINE_ADMIN_ONLY_EVENTS ]]; then
                local diff=$((EVENTS_WITHOUT_PERMISSIONS - BASELINE_ADMIN_ONLY_EVENTS))
                echo -e "${RED}❌ FAIL: Admin-only events increased by $diff (was $BASELINE_ADMIN_ONLY_EVENTS, now $EVENTS_WITHOUT_PERMISSIONS)${NC}"
                echo -e "${RED}   This means an explicit STYLIST/CLIENT permission was removed!${NC}"
                echo -e "${RED}   Events that lost explicit permissions:${NC}"
                while IFS= read -r event; do
                    echo -e "    ${RED}• $event${NC}"
                done < /tmp/events_without_permissions.txt
                echo ""
                echo -e "${YELLOW}   Fix: Add missing events back to STYLIST_SPECIFIC or CLIENT_SPECIFIC permissions${NC}"
                echo -e "${YELLOW}   Or: Update BASELINE_ADMIN_ONLY_EVENTS=$EVENTS_WITHOUT_PERMISSIONS in this script${NC}"
                exit 1
            fi
            echo -e "${YELLOW}⚠️  INFO: $EVENTS_WITHOUT_PERMISSIONS admin-only events (baseline: $BASELINE_ADMIN_ONLY_EVENTS)${NC}"
            echo -e "${YELLOW}   These events are accessible via MASTER_ADMIN wildcard (getAllEvents)${NC}"
            echo ""
            echo -e "${GREEN}✅ PASS: All events have access (explicit or wildcard), baseline unchanged${NC}"
            if [[ $ORPHANED_PERMISSIONS -gt 0 ]]; then
                echo -e "${YELLOW}⚠️  WARNING: $ORPHANED_PERMISSIONS orphaned permissions found${NC}"
            fi
            exit 0
        else
            # Events without any permissions (no explicit, no wildcard) - CRITICAL
            echo -e "${RED}❌ FAIL: $EVENTS_WITHOUT_PERMISSIONS events lack permissions (security risk)${NC}"
            echo -e "${RED}   These events have NO access (no explicit permissions, no wildcard)${NC}"
            echo -e "${RED}   This is a critical security issue that must be fixed${NC}"
            echo ""
            echo -e "${YELLOW}🔧 Priority Actions:${NC}"
            echo -e "   1. Review missing permissions by domain (see table above)"
            echo -e "   2. Add permissions to appropriate roles in permissions.init.ts"
            echo -e "   3. Re-run audit: ${CYAN}bash tests/audit/permissions.sh${NC}"
            exit 1
        fi
    else
        echo -e "${GREEN}✅ PASS: All CQRS events have explicit permissions configured${NC}"
        if [[ $ORPHANED_PERMISSIONS -gt 0 ]]; then
            echo -e "${YELLOW}⚠️  Note: $ORPHANED_PERMISSIONS orphaned permissions found (cleanup recommended)${NC}"
        fi
        echo ""
        echo -e "${GREEN}🎉 Security audit completed successfully${NC}"
        exit 0
    fi
}

# Run main function
main
