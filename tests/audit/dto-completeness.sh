#!/bin/bash

source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)
CQRS_CONFIG="$PROJECT_ROOT/.shared-kernel/domain/commands-and-queries/cqrs.config.ts"
APP_EVENTS_CONST="$PROJECT_ROOT/.shared-kernel/domain/events/app-events.const.ts"
MODELS_DIR="$PROJECT_ROOT/.shared-kernel/models"
SCHEMA_FILE="$PROJECT_ROOT/web-1/src/prisma/schema.prisma"
GENERATED_DTO="$PROJECT_ROOT/.shared-kernel/models/db_models.generated.dto.ts"
GENERATOR_CONFIG="$PROJECT_ROOT/scripts/generate-dto/config.ts"
MANUAL_DTO="$PROJECT_ROOT/.shared-kernel/models/db_models.manual.dto.ts"
ROUTING_FILE="$PROJECT_ROOT/.shared-kernel/domain/routing/routing.config.ts"
HTTP_METHODS_FILE="$PROJECT_ROOT/.shared-kernel/domain/http/http-methods.config.ts"

# Cleanup
TMPDIR_AUDIT=$(mktemp -d)
trap 'rm -rf "$TMPDIR_AUDIT"' EXIT

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                            📋 DTO COMPLETENESS AUDIT                         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ─── Freshness check ───
# DECISION (nie usuwaj tego komentarza): freshness = REGEN-DIFF, nie liczniki.
# Same liczniki (`grep -c '^model '` vs `^export type`) przepuszczały zmianę/dodanie
# KOLUMNY w istniejącym modelu bez regen — jedyna cicha ścieżka rozjazdu schema↔kernel
# (census 2026-07-09). Regen idzie przez `--out` do pliku TEMP (trap EXIT sprząta),
# committed db_models.generated.dto.ts nie jest NIGDY mutowany — atomiczność by
# construction, zero restore-dance. Liczniki zostają tylko jako tani fallback, gdy
# devDeps generatora (tsx / @mrleebo/prisma-ast) nie są zainstalowane.
check_generated_dto_freshness() {
    local errors=0

    [[ ! -f "$GENERATED_DTO" ]] && { print_error "Missing: db_models.generated.dto.ts"; ((errors++)); }
    [[ ! -f "$MANUAL_DTO" ]] && { print_error "Missing: db_models.manual.dto.ts"; ((errors++)); }
    [[ ! -f "$SCHEMA_FILE" ]] && { print_error "Missing: schema.prisma"; ((errors++)); }
    [[ $errors -gt 0 ]] && { print_error "Generated DTO freshness check failed ($errors issues)"; exit 1; }

    # Primary: full regen into temp + byte-diff against the committed kernel DTO.
    if [[ -d "$PROJECT_ROOT/node_modules/tsx" && -d "$PROJECT_ROOT/node_modules/@mrleebo/prisma-ast" ]]; then
        local regen_out="$TMPDIR_AUDIT/db_models.regen.dto.ts"
        if ! (cd "$PROJECT_ROOT" && npm run --silent system:generate-dto -- --out "$regen_out" >/dev/null 2>&1); then
            print_error "DTO generator failed (npm run system:generate-dto -- --out) — investigate before trusting kernel DTOs"
            exit 1
        fi
        if [[ ! -f "$regen_out" ]]; then
            print_error "DTO generator produced no output at temp path — investigate scripts/generate-dto"
            exit 1
        fi
        if ! diff -q "$GENERATED_DTO" "$regen_out" >/dev/null 2>&1; then
            print_error "schema.prisma zmienione bez system:generate-dto — committed db_models.generated.dto.ts ≠ regen ze schematu:"
            diff -u "$GENERATED_DTO" "$regen_out" | head -40 | sed 's/^/    /'
            print_info "Fix: npm run system:kernel:full (regeneruje DTO + propaguje kernel), potem commit."
            exit 1
        fi
        print_info "Generated DTO freshness: OK (regen-diff, byte-identical)"
        return 0
    fi

    # Fallback (devDeps generatora niezainstalowane): stare liczniki — łapią tylko
    # brakujące modele/enumy, NIE zmiany kolumn.
    print_warning "Generator devDeps (tsx/@mrleebo/prisma-ast) niezainstalowane — fallback na liczniki (nie łapie zmian kolumn)."
    local schema_models=$(grep -c '^model ' "$SCHEMA_FILE" 2>/dev/null || echo "0")
    local generated_types=$(grep -c '^export type ' "$GENERATED_DTO" 2>/dev/null || echo "0")
    [[ "$schema_models" -gt "$generated_types" ]] && {
        print_error "Schema has $schema_models models but generated DTO has only $generated_types types — run: npm run system:generate-dto"
        ((errors++))
    }

    local schema_enums=$(grep -c '^enum ' "$SCHEMA_FILE" 2>/dev/null || echo "0")
    # Liczba pomijanych enumow DERYWOWANA ze SSOT generatora (config.ts SKIP_ENUMS),
    # nie hardcodowana. Hardcode `- 1  # minus PricingPlan` cichnie przy KAZDEJ zmianie
    # SKIP_ENUMS: dopisanie enuma dawaloby falszywy RED, a usuniecie PricingPlan —
    # falszywy GREEN (zanizone `expected`, brakujacy enum przechodzi).
    local skip_enums
    skip_enums=$(sed -n '/SKIP_ENUMS/,/])/p' "$GENERATOR_CONFIG" 2>/dev/null | grep -cE "^\s*'[A-Za-z0-9_]+',")
    [[ -z "$skip_enums" ]] && skip_enums=0
    local expected_enums=$((schema_enums - skip_enums))
    local generated_enums=$(grep -c '^export const .*Value = Object.freeze' "$GENERATED_DTO" 2>/dev/null || echo "0")
    [[ "$expected_enums" -gt "$generated_enums" ]] && {
        print_error "Schema has $expected_enums generable enums but generated DTO has only $generated_enums — run: npm run system:generate-dto"
        ((errors++))
    }

    [[ $errors -gt 0 ]] && { print_error "Generated DTO freshness check failed ($errors issues)"; exit 1; }
    print_info "Generated DTO freshness: OK (fallback liczniki)"
}

# ─── Required files ───
check_required_files() {
    local fail=0
    [[ ! -f "$CQRS_CONFIG" ]] && { print_error "CQRS config missing"; fail=1; }
    [[ ! -f "$APP_EVENTS_CONST" ]] && { print_error "App Events Const missing"; fail=1; }
    [[ ! -d "$MODELS_DIR" ]] && { print_error "Models dir missing"; fail=1; }
    local dto_count=$(find "$MODELS_DIR" -name "*.dto.ts" 2>/dev/null | wc -l)
    [[ $dto_count -eq 0 ]] && { print_error "No DTO files found"; fail=1; }
    [[ $fail -eq 1 ]] && exit 1
}

# ─── Extract events (via shared _utils.sh parser) ───
extract_events() {
    extract_handler_events "$APP_EVENTS_CONST" | awk -F'\t' '{print $2 "\t" $3}' | sort -t$'\t' -k2 -u > "$TMPDIR_AUDIT/events_with_domain.txt"
    awk -F'\t' '{print $2}' "$TMPDIR_AUDIT/events_with_domain.txt" | sort -u > "$TMPDIR_AUDIT/events.txt"
    [[ ! -s "$TMPDIR_AUDIT/events.txt" ]] && { print_error "No events extracted"; exit 1; }
}

# ─── Extract ALL DTO blocks in ONE awk pass ───
# Output: FILE<tab>DTO_NAME<tab>has_req<tab>has_resp<tab>has_resp_err<tab>has_io
extract_all_dtos_fast() {
    find "$MODELS_DIR" -name "*.dto.ts" -print0 | xargs -0 awk '
    BEGINFILE {
        current_file = FILENAME
    }
    # Match top-level DTO names: exactly "  NAME: {" (2 spaces indent, all caps + underscore)
    # Internal fields (REQUEST, RESPONSE, etc.) are at 4+ spaces — excluded by pattern
    /^  [A-Z][A-Z_0-9]+:[[:space:]]*\{/ {
        name = $0
        gsub(/^[[:space:]]+/, "", name)
        gsub(/:[[:space:]]*\{.*/, "", name)

        in_dto = 1
        dto_name = name
        has_req = 0
        has_resp = 0
        has_resp_err = 0
        has_io = 0

        # Count braces on opening line
        line = $0; gsub(/[^{]/, "", line); brace_depth = length(line)
        line = $0; gsub(/[^}]/, "", line); brace_depth -= length(line)
        next
    }

    in_dto {
        # Track braces
        line = $0; gsub(/[^{]/, "", line); brace_depth += length(line)
        line = $0; gsub(/[^}]/, "", line); brace_depth -= length(line)

        # Check for required fields
        if ($0 ~ /REQUEST:/) has_req = 1
        if ($0 ~ /RESPONSE:/ && $0 !~ /RESPONSE_ERROR/) has_resp = 1
        if ($0 ~ /RESPONSE_ERROR:/) has_resp_err = 1
        if ($0 ~ /IO_CLIENT_FUNCTION:/) has_io = 1

        if (brace_depth <= 0) {
            rel = current_file
            gsub(/.*\/models\//, "", rel)
            printf "%s\t%s\t%d\t%d\t%d\t%d\n", rel, dto_name, has_req, has_resp, has_resp_err, has_io
            in_dto = 0
        }
    }
    ' > "$TMPDIR_AUDIT/dto_map.tsv"
}

# ─── DTO op key ↔ ROUTES_API / API_HTTP_METHODS PURE-EQUALITY parity ───
# DECISION (nie usuwaj tego komentarza):
# Kontrakt API = SSOT rozłożony na 3 rejestry złączone WSPÓLNYM kluczem operacji.
# Konwencja (AGENTS.md): DTO op key === ROUTES_API key === API_HTTP_METHODS key
# (czysta równość, zero derywacji/prefix-fallbacku). Ten check wymusza join po
# równości: KAŻDY blok DTO ma trasę+metodę o IDENTYCZNYM kluczu. Regresja (op wraca
# do formy krótkiej / rejestr driftuje) = FAIL. Zamyka fuzzy-join, którego używał
# gen-openapi (fallback usunięty) i event_to_dto_variations (zredukowany do identity).
#
# Udokumentowane aliasy (op współdzieli endpoint innego op — 1-trasa/N-op):
#   USER_LOGOUT          → SESSION_DELETE_ALL (brak własnej trasy I metody; logout =
#                          Better Auth out-of-band; placeholder DTO trzyma inwariant event↔DTO)
#   SALON_STAFF_INVITE   → SALON_STAFF (brak własnej trasy; ma własną metodę POST)
#   SALON_STAFF_GET_ALL  → SALON_STAFF (brak własnej trasy; ma własną metodę GET)
# Zmiana aliasów = zmiana ROUTE_ALIASES w main/src/application/http/http.endpoints.ts.
extract_freeze_keys() {
    # $1 = const name, $2 = file. Emits top-level UPPER keys inside Object.freeze({...}).
    # Close on BOTH `} as const)` AND the next top-level `export const ` (block boundary):
    # if the closer is ever reformatted, the export-const guard still stops the parser
    # from leaking sibling-const keys into the set (over-extraction = false-pass). The
    # opening line is consumed by the open rule (has `next`), so it never self-closes.
    awk -v cn="$1" '
      $0 ~ ("export const " cn " = Object.freeze\\(\\{") { inblk=1; next }
      inblk && (/^\} as const\)/ || /^export const /) { inblk=0 }
      inblk && /^  [A-Z_][A-Z_0-9]*:/ { k=$0; sub(/^  /,"",k); sub(/:.*/,"",k); print k }
    ' "$2"
}

check_dto_registry_parity() {
    local route_keys method_keys
    route_keys=$(extract_freeze_keys ROUTES_API "$ROUTING_FILE")
    method_keys=$(extract_freeze_keys API_HTTP_METHODS "$HTTP_METHODS_FILE")
    [[ -z "$route_keys" ]] && { print_error "parity: no ROUTES_API keys extracted from $ROUTING_FILE"; exit 1; }
    [[ -z "$method_keys" ]] && { print_error "parity: no API_HTTP_METHODS keys extracted from $HTTP_METHODS_FILE"; exit 1; }

    # ── Extraction-integrity guard (closes the block-scope silent-drop hole) ──
    # extract_all_dtos_fast counts braces across a whole line INCLUDING comments/strings,
    # so an op whose body has an unbalanced `{` in a comment (`// returns { data`) or a
    # string/type never closes → that op is SILENTLY dropped from dto_map and parity never
    # sees it (blind pass — the exact block-scope pitfall). Assert #op-openers (grep, same
    # regex as the awk opener rule) == #emitted rows; any drop = FAIL. The floor catches a
    # catastrophic extraction failure (MODELS_DIR moved / awk broke → 0 rows → vacuous pass).
    local openers emitted
    openers=$(find "$MODELS_DIR" -name '*.dto.ts' -print0 | xargs -0 grep -hE '^  [A-Z][A-Z_0-9]+:[[:space:]]*\{' 2>/dev/null | wc -l | tr -d ' ')
    emitted=$(wc -l < "$TMPDIR_AUDIT/dto_map.tsv" | tr -d ' ')
    if [[ "$emitted" -lt 100 ]]; then
        print_error "parity: DTO extraction produced only $emitted op blocks (floor 100) — extraction broken (MODELS_DIR/awk); refuse to vacuously pass"
        exit 1
    fi
    if [[ "$openers" -ne "$emitted" ]]; then
        print_error "parity: DTO extraction dropped $((openers - emitted)) op block(s) ($openers openers vs $emitted emitted) — unbalanced { in a comment/string inside an op body. Fix extract_all_dtos_fast (strip comments before brace-count) before trusting parity."
        exit 1
    fi

    declare -A ROUTE_SET METHOD_SET
    while IFS= read -r k; do [[ -n "$k" ]] && ROUTE_SET["$k"]=1; done <<< "$route_keys"
    while IFS= read -r k; do [[ -n "$k" ]] && METHOD_SET["$k"]=1; done <<< "$method_keys"

    # Documented aliases: op borrows another op's endpoint (1-route/N-op). Keyed by the
    # borrowing op → the route key it reuses (mirrors ROUTE_ALIASES in http.endpoints.ts).
    # Assert each alias target still resolves in ROUTE_SET, so deleting the host route
    # (e.g. SESSION_DELETE_ALL) FAILS the guard instead of leaving a dead exempt green.
    declare -A ALIAS_TARGET ALIASED_NO_METHOD
    ALIAS_TARGET["USER_LOGOUT"]="SESSION_DELETE_ALL"
    ALIAS_TARGET["SALON_STAFF_INVITE"]="SALON_STAFF"
    ALIAS_TARGET["SALON_STAFF_GET_ALL"]="SALON_STAFF"
    ALIASED_NO_METHOD["USER_LOGOUT"]=1   # logout = Better Auth out-of-band, no own /api/v1 method

    local dead_alias=()
    for op in "${!ALIAS_TARGET[@]}"; do
        [[ -z "${ROUTE_SET[${ALIAS_TARGET[$op]}]+x}" ]] && dead_alias+=("$op → ${ALIAS_TARGET[$op]}")
    done
    if [[ ${#dead_alias[@]} -gt 0 ]]; then
        print_error "parity: aliased op(s) point at a MISSING host route (${#dead_alias[@]}): ${dead_alias[*]} — restore the host route or fix the alias"
        exit 1
    fi

    local missing_route=() missing_method=()
    while IFS= read -r op; do
        [[ -z "$op" ]] && continue
        if [[ -z "${ROUTE_SET[$op]+x}" && -z "${ALIAS_TARGET[$op]+x}" ]]; then
            missing_route+=("$op")
        fi
        if [[ -z "${METHOD_SET[$op]+x}" && -z "${ALIASED_NO_METHOD[$op]+x}" ]]; then
            missing_method+=("$op")
        fi
    done < <(cut -f2 "$TMPDIR_AUDIT/dto_map.tsv" | sort -u)

    local fail=0
    if [[ ${#missing_route[@]} -gt 0 ]]; then
        fail=1
        echo -e "\n  ${RED}DTO ops WITHOUT matching ROUTES_API key (${#missing_route[@]}):${NC}"
        for op in "${missing_route[@]}"; do echo -e "    ${RED}$op${NC} — add ROUTES_API.$op OR document as alias in check_dto_registry_parity"; done
    fi
    if [[ ${#missing_method[@]} -gt 0 ]]; then
        fail=1
        echo -e "\n  ${RED}DTO ops WITHOUT matching API_HTTP_METHODS key (${#missing_method[@]}):${NC}"
        for op in "${missing_method[@]}"; do echo -e "    ${RED}$op${NC} — add API_HTTP_METHODS.$op OR document as alias"; done
    fi

    if [[ $fail -eq 1 ]]; then
        print_error "DTO ↔ registry pure-equality parity FAILED (DTO op key must === ROUTES_API key === API_HTTP_METHODS key)"
        exit 1
    fi
    print_info "DTO ↔ registry pure-equality: OK (every DTO op has identical route+method key; 4 documented aliases)"
}

# ─── Event → candidate DTO files (dynamic: domain from extracted data + dto_map scan) ───
# Returns newline-separated list of candidate files. Primary (domain-derived) first,
# then any files from dto_map.tsv containing the event or its variations.
get_dto_candidates_for_event() {
    local event="$1"
    local candidates=()

    # 1. Primary: derive from domain
    local domain
    domain=$(grep -P "\t${event}$" "$TMPDIR_AUDIT/events_with_domain.txt" | head -1 | cut -f1)
    if [[ -n "$domain" ]]; then
        local dto_dir
        dto_dir=$(domain_to_dto_dir "$domain")
        local dto_file="${dto_dir}/${dto_dir}.dto.ts"

        if [[ -f "$MODELS_DIR/$dto_file" ]]; then
            candidates+=("$dto_file")
        else
            # Try alternate naming: directory keeps hyphens, filename uses underscores
            # Handles e.g. event-log/event_log.dto.ts
            local alt_filename
            alt_filename=$(echo "$dto_dir" | tr '-' '_')
            local alt_file="${dto_dir}/${alt_filename}.dto.ts"
            [[ -f "$MODELS_DIR/$alt_file" ]] && candidates+=("$alt_file")
        fi
    fi

    # 2. Fallback: scan dto_map.tsv for the event name (or stripped variations) in any file
    # Handles cross-domain DTOs (e.g. moderation events under ADMIN/GALLERY domains)
    local fallback_files
    fallback_files=$(while IFS= read -r variation; do
        [[ -z "$variation" ]] && continue
        awk -F'\t' -v ev="$variation" '$2 == ev { print $1 }' "$TMPDIR_AUDIT/dto_map.tsv"
    done < <(event_to_dto_variations "$event") | sort -u)

    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        # Avoid duplicates with primary candidate
        local dup=false
        for c in "${candidates[@]}"; do [[ "$c" == "$f" ]] && { dup=true; break; }; done
        $dup || candidates+=("$f")
    done <<< "$fallback_files"

    # Output candidates (one per line), or empty if none found
    if [[ ${#candidates[@]} -eq 0 ]]; then
        echo ""
    else
        printf '%s\n' "${candidates[@]}"
    fi
}

# ─── Event → DTO name (pure equality post-standaryzacja) ───
# DECISION (nie usuwaj tego komentarza):
# Po standaryzacji kluczy (P-pełny, AGENTS.md): DTO op key === CQRS event key.
# Prefix-strip fuzzy-join (ACCOUNT_* → strip ACCOUNT_ itd.) USUNIĘTY — był tolerancją
# driftu, który już nie istnieje. Join = czysta równość nazwy eventu z nazwą bloku DTO.
# `check_dto_registry_parity` dodatkowo wymusza tę równość względem ROUTES_API/methods,
# więc regresja do formy krótkiej pada tu (brak exact DTO) I tam (brak trasy). Kandydaci
# cross-domain (np. USER_DISABLE_ANY w ADMIN DTO) łapane przez fallback-scan dto_map po
# exact nazwie w get_dto_candidates_for_event (domenowo-agnostyczny).
event_to_dto_variations() {
    echo "$1"
}

# ─── Main ───
main() {
    print_info "Checking required files..."
    check_required_files

    print_info "Checking generated DTO freshness..."
    check_generated_dto_freshness

    print_info "Extracting events..."
    extract_events

    print_info "Extracting DTOs (single awk pass)..."
    extract_all_dtos_fast

    local events_count=$(wc -l < "$TMPDIR_AUDIT/events.txt")
    local dtos_count=$(wc -l < "$TMPDIR_AUDIT/dto_map.tsv")

    print_info "Total CQRS events: $events_count"
    print_info "Total DTO blocks: $dtos_count"
    print_separator

    # Pure-equality parity: DTO op key === ROUTES_API key === API_HTTP_METHODS key.
    check_dto_registry_parity
    print_separator

    # Build associative arrays from awk output (one loop, no subprocesses)
    declare -A DTO_EXISTS      # key="file<tab>name" → 1
    declare -A DTO_COMPLETE    # key="file<tab>name" → 1 if all 4 fields present

    while IFS=$'\t' read -r file name has_req has_resp has_resp_err has_io; do
        DTO_EXISTS["${file}	${name}"]=1
        if [[ "$has_req" == "1" && "$has_resp" == "1" && "$has_resp_err" == "1" && "$has_io" == "1" ]]; then
            DTO_COMPLETE["${file}	${name}"]=1
        fi
    done < "$TMPDIR_AUDIT/dto_map.tsv"

    # Match events → DTOs using arrays (no subprocess per event)
    > "$TMPDIR_AUDIT/missing.txt"
    > "$TMPDIR_AUDIT/incomplete.txt"
    > "$TMPDIR_AUDIT/matched.txt"

    while IFS= read -r event; do
        [[ -z "$event" ]] && continue

        local found=false
        local complete=false
        local matched_name=""
        local matched_file=""

        # Get candidate DTO files (domain-derived first, then dto_map fallback)
        while IFS= read -r dto_file; do
            [[ -z "$dto_file" ]] && continue

            while IFS= read -r variation; do
                [[ -z "$variation" ]] && continue
                local key="${dto_file}	${variation}"

                if [[ -n "${DTO_EXISTS[$key]+x}" ]]; then
                    found=true
                    matched_name="$variation"
                    matched_file="$dto_file"
                    [[ -n "${DTO_COMPLETE[$key]+x}" ]] && complete=true
                    break 2
                fi
            done < <(event_to_dto_variations "$event")
        done < <(get_dto_candidates_for_event "$event")

        if $found; then
            echo "$event	$matched_name" >> "$TMPDIR_AUDIT/matched.txt"
            $complete || echo "$event" >> "$TMPDIR_AUDIT/incomplete.txt"
        else
            echo "$event" >> "$TMPDIR_AUDIT/missing.txt"
        fi
    done < "$TMPDIR_AUDIT/events.txt"

    # Orphaned DTOs: DTOs not matched by any event (set difference)
    cut -f2 "$TMPDIR_AUDIT/matched.txt" | sort -u > "$TMPDIR_AUDIT/matched_names.txt"
    cut -f2 "$TMPDIR_AUDIT/dto_map.tsv" | sort -u > "$TMPDIR_AUDIT/all_dto_names.txt"
    comm -23 "$TMPDIR_AUDIT/all_dto_names.txt" "$TMPDIR_AUDIT/matched_names.txt" > "$TMPDIR_AUDIT/orphaned.txt"

    # Results
    local missing_count=$(wc -l < "$TMPDIR_AUDIT/missing.txt")
    local incomplete_count=$(wc -l < "$TMPDIR_AUDIT/incomplete.txt")
    local orphaned_count=$(wc -l < "$TMPDIR_AUDIT/orphaned.txt")

    local complete_events=$((events_count - missing_count - incomplete_count))
    local coverage=0
    [[ $events_count -gt 0 ]] && coverage=$(( (complete_events * 100) / events_count ))

    # Coverage display
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                              📊 DTO COVERAGE                                 ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    local bar_length=50
    local filled_length=$(( (coverage * bar_length) / 100 ))
    local empty_length=$(( bar_length - filled_length ))

    local bar_color="${RED}"
    [[ $coverage -ge 95 ]] && bar_color="${GREEN}"
    [[ $coverage -ge 80 && $coverage -lt 95 ]] && bar_color="${YELLOW}"

    printf "Event coverage: %3d%% [" "$coverage"
    printf "%*s" "$filled_length" | tr ' ' '#'
    printf "%*s" "$empty_length" | tr ' ' '-'
    echo -e "] ${bar_color}$coverage%${NC}"
    echo ""

    echo -e "${BLUE}┌─────────────────────────┬───────┬──────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│ Metric                  │ Count │ Status                               │${NC}"
    echo -e "${BLUE}├─────────────────────────┼───────┼──────────────────────────────────────┤${NC}"
    printf "${BLUE}│${NC} %-23s ${BLUE}│${NC} %5s ${BLUE}│${NC} %-36s ${BLUE}│${NC}\n" "CQRS Events" "$events_count" "Total requiring DTOs"
    printf "${BLUE}│${NC} %-23s ${BLUE}│${NC} %5s ${BLUE}│${NC} %-36s ${BLUE}│${NC}\n" "Missing DTOs" "$missing_count" "$([[ $missing_count -eq 0 ]] && echo "OK" || echo "REQUIRED")"
    printf "${BLUE}│${NC} %-23s ${BLUE}│${NC} %5s ${BLUE}│${NC} %-36s ${BLUE}│${NC}\n" "Incomplete DTOs" "$incomplete_count" "$([[ $incomplete_count -eq 0 ]] && echo "OK" || echo "FIX")"
    printf "${BLUE}│${NC} %-23s ${BLUE}│${NC} %5s ${BLUE}│${NC} %-36s ${BLUE}│${NC}\n" "DTO blocks found" "$dtos_count" "Informational"
    printf "${BLUE}│${NC} %-23s ${BLUE}│${NC} %5s ${BLUE}│${NC} %-36s ${BLUE}│${NC}\n" "Orphaned DTOs" "$orphaned_count" "$([[ $orphaned_count -eq 0 ]] && echo "OK" || echo "Cleanup")"
    echo -e "${BLUE}└─────────────────────────┴───────┴──────────────────────────────────────┘${NC}"
    echo ""
    print_separator

    # Missing DTOs details
    local has_errors=false

    if [[ $missing_count -gt 0 ]]; then
        has_errors=true
        echo ""
        echo -e "${RED}MISSING DTOs ($missing_count):${NC}"
        while IFS= read -r event; do
            [[ -z "$event" ]] && continue
            local expected_file
            expected_file=$(get_dto_candidates_for_event "$event" | head -1)
            echo -e "  ${RED}$event${NC} ${GRAY}(expected in ${expected_file:-unknown})${NC}"
        done < "$TMPDIR_AUDIT/missing.txt"
        echo ""
    fi

    if [[ $incomplete_count -gt 0 ]]; then
        has_errors=true
        echo ""
        echo -e "${YELLOW}INCOMPLETE DTOs ($incomplete_count):${NC}"
        while IFS= read -r event; do
            [[ -z "$event" ]] && continue
            echo -e "  ${YELLOW}$event${NC} ${GRAY}(missing REQUEST/RESPONSE/RESPONSE_ERROR/IO_CLIENT_FUNCTION)${NC}"
        done < "$TMPDIR_AUDIT/incomplete.txt"
        echo ""
    fi

    if [[ $orphaned_count -gt 0 ]]; then
        echo ""
        echo -e "${YELLOW}ORPHANED DTOs ($orphaned_count) — no matching CQRS event:${NC}"
        while IFS= read -r dto; do
            [[ -z "$dto" ]] && continue
            echo -e "  ${YELLOW}$dto${NC}"
        done < "$TMPDIR_AUDIT/orphaned.txt"
        echo ""
    fi

    # Result
    echo ""
    if $has_errors; then
        print_error "DTO completeness check FAILED ($missing_count missing, $incomplete_count incomplete)"
        exit 1
    else
        print_success "DTO completeness audit PASSED (${coverage}% coverage, $events_count events)"
        exit 0
    fi
}

main
