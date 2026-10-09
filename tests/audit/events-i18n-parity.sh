#!/bin/bash

# I18N EVENTS — LOCALE PARITY AUDIT
# In run-all (npm run audit:all / git:push).
#
# Verifies event translation keys are present in ALL locales (pl/en/de).
# Deterministic: builds the union of top-level keys across locales and flags any
# locale missing a key the others have. Catches the real drift — "added a PL
# translation, forgot EN/DE" — WITHOUT asserting which events must be translated.
# (user-facing vs internal is a fuzzy line; encoding it as an allow/deny list
#  rots, so we deliberately do not. events.json itself is the source of which
#  events carry a user-facing string.)
#
# NOTE: a "dead key" check (events.json key with no matching APP_EVENTS event)
# is intentionally omitted — ~17 keys come from COMMON errors outside INFO and
# would false-positive. Add later as advisory only if it earns its keep.

set -u

source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)
LOCALES_DIR="$PROJECT_ROOT/main/src/locales"
LOCALES=(pl en de)

print_boxed_header "I18N EVENTS — LOCALE PARITY"

if [[ ! -d "$LOCALES_DIR" ]]; then
    print_error "locales directory not found at $LOCALES_DIR"
    exit 1
fi

# Extract top-level UPPER_SNAKE keys from a locale's events.json
extract_keys() {
    grep -oE '^[[:space:]]*"[A-Z0-9_]+"[[:space:]]*:' "$1" \
        | grep -oE '"[A-Z0-9_]+"' | tr -d '"' | sort -u
}

# Validate files + collect keys per locale
declare -A KEYS
for locale in "${LOCALES[@]}"; do
    f="$LOCALES_DIR/$locale/events.json"
    if [[ ! -f "$f" ]]; then
        print_error "events.json missing for locale '$locale' ($f)"
        exit 1
    fi
    KEYS[$locale]="$(extract_keys "$f")"
done

# Union of all keys across locales (sorted, unique)
UNION=$(printf "%s\n" "${KEYS[@]}" | grep -v '^$' | sort -u)
TOTAL=$(echo "$UNION" | grep -vc '^$')

echo -e "${BOLD}Union of ${TOTAL} event keys across ${#LOCALES[@]} locales (${LOCALES[*]})${NC}"
echo ""

printf "%-8s %-8s %-10s %s\n" "Locale" "Keys" "Missing" "Status"
echo "────────────────────────────────────────────"

EXIT_CODE=0
declare -A MISSING_PER_LOCALE
for locale in "${LOCALES[@]}"; do
    have=$(echo "${KEYS[$locale]}" | sort -u)
    have_count=$(echo "$have" | grep -vc '^$')
    missing=$(comm -23 <(echo "$UNION") <(echo "$have") | grep -v '^$' || true)
    if [[ -z "$missing" ]]; then
        printf "%-8s %-8s %-10s %s\n" "$locale" "$have_count" "0" "PASS"
    else
        miss_count=$(echo "$missing" | grep -vc '^$')
        printf "%-8s %-8s %-10s %s\n" "$locale" "$have_count" "$miss_count" "FAIL"
        MISSING_PER_LOCALE[$locale]="$missing"
        EXIT_CODE=1
    fi
done

# Show missing keys per locale
if [[ $EXIT_CODE -ne 0 ]]; then
    echo ""
    print_header "MISSING KEYS (present in some locales, absent here)"
    for locale in "${LOCALES[@]}"; do
        if [[ -n "${MISSING_PER_LOCALE[$locale]:-}" ]]; then
            echo -e "\n${BOLD}${RED}${locale}:${NC}"
            echo "${MISSING_PER_LOCALE[$locale]}" | while IFS= read -r k; do
                [[ -n "$k" ]] && echo -e "  - $k"
            done
        fi
    done
fi

echo ""
print_header "SUMMARY"
if [[ $EXIT_CODE -eq 0 ]]; then
    echo -e "${GREEN}PASSED:${NC} all ${TOTAL} event keys present in every locale (${LOCALES[*]})"
else
    echo -e "${RED}FAILED:${NC} locale parity broken — bring all locales in sync"
    echo -e "${YELLOW}Fix: add missing keys to main/src/locales/<locale>/events.json${NC}"
fi

exit $EXIT_CODE
