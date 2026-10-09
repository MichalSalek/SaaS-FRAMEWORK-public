#!/bin/bash

# EMAIL I18N — LOCALE PARITY AUDIT
# In run-all (npm run audit:all / git:push).
#
# Verifies kernel email translation LEAF keys are present in ALL locales (pl/en/de)
# of `.shared-kernel/domain/email/locales/email-i18n.<locale>.json`.
# Deterministic: builds the union of leaf-key PATHS (e.g. bodies.welcome.cta,
# subjects.trialWarning, footer.unsubscribe) across locales and flags any locale
# missing a path the others have. Catches the real drift — "added a PL template
# piece, forgot EN/DE" — which TypeScript CANNOT catch here: EN/DE are cast to
# `typeof emailI18nPl` in email-template.i18n.ts (drift-tolerant by design,
# runtime silently falls back to PL). This audit is the drift gate.
#
# Also FAILS on empty-string leaf values (a key present but empty ships a blank
# email piece — same class of bug as a missing key).
#
# Sibling of events-i18n-parity.sh (frontend events.json parity); this one walks
# NESTED JSON via node (leaf paths), not top-level grep.

set -u

source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)
LOCALES_DIR="$PROJECT_ROOT/.shared-kernel/domain/email/locales"
LOCALES=(pl en de)

print_boxed_header "EMAIL I18N — LOCALE PARITY"

if [[ ! -d "$LOCALES_DIR" ]]; then
    print_error "email locales directory not found at $LOCALES_DIR"
    exit 1
fi

# Extract sorted leaf-key paths (dot-notation) from a nested locale JSON.
extract_leaf_paths() {
    node -e "
        const data = require('$1');
        const walk = (o, prefix) => Object.entries(o).flatMap(([k, v]) =>
            v !== null && typeof v === 'object' ? walk(v, prefix + k + '.') : [prefix + k]);
        walk(data, '').sort().forEach(p => console.log(p));
    "
}

# Extract leaf-key paths whose value is an empty/whitespace-only string.
extract_empty_paths() {
    node -e "
        const data = require('$1');
        const walk = (o, prefix) => Object.entries(o).flatMap(([k, v]) =>
            v !== null && typeof v === 'object' ? walk(v, prefix + k + '.') : [[prefix + k, v]]);
        walk(data, '')
            .filter(([, v]) => typeof v === 'string' && v.trim() === '')
            .forEach(([p]) => console.log(p));
    "
}

# Validate files + collect leaf paths per locale
declare -A KEYS
declare -A EMPTY
for locale in "${LOCALES[@]}"; do
    f="$LOCALES_DIR/email-i18n.$locale.json"
    if [[ ! -f "$f" ]]; then
        print_error "email-i18n.$locale.json missing ($f)"
        exit 1
    fi
    if ! KEYS[$locale]="$(extract_leaf_paths "$f")"; then
        print_error "email-i18n.$locale.json is not valid JSON ($f)"
        exit 1
    fi
    EMPTY[$locale]="$(extract_empty_paths "$f")"
done

# Union of all leaf paths across locales (sorted, unique)
UNION=$(printf "%s\n" "${KEYS[@]}" | grep -v '^$' | sort -u)
TOTAL=$(echo "$UNION" | grep -vc '^$')

echo -e "${BOLD}Union of ${TOTAL} email leaf keys across ${#LOCALES[@]} locales (${LOCALES[*]})${NC}"
echo ""

printf "%-8s %-8s %-10s %-8s %s\n" "Locale" "Keys" "Missing" "Empty" "Status"
echo "──────────────────────────────────────────────────"

EXIT_CODE=0
declare -A MISSING_PER_LOCALE
for locale in "${LOCALES[@]}"; do
    have=$(echo "${KEYS[$locale]}" | sort -u)
    have_count=$(echo "$have" | grep -vc '^$')
    missing=$(comm -23 <(echo "$UNION") <(echo "$have") | grep -v '^$' || true)
    empty_count=$(echo "${EMPTY[$locale]}" | grep -vc '^$')
    if [[ -z "$missing" && "$empty_count" -eq 0 ]]; then
        printf "%-8s %-8s %-10s %-8s %s\n" "$locale" "$have_count" "0" "0" "PASS"
    else
        miss_count=$(echo "$missing" | grep -vc '^$')
        printf "%-8s %-8s %-10s %-8s %s\n" "$locale" "$have_count" "$miss_count" "$empty_count" "FAIL"
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
    print_header "EMPTY VALUES (key present, string empty)"
    for locale in "${LOCALES[@]}"; do
        if [[ -n "${EMPTY[$locale]}" ]]; then
            echo -e "\n${BOLD}${RED}${locale}:${NC}"
            echo "${EMPTY[$locale]}" | while IFS= read -r k; do
                [[ -n "$k" ]] && echo -e "  - $k"
            done
        fi
    done
fi

echo ""
print_header "SUMMARY"
if [[ $EXIT_CODE -eq 0 ]]; then
    echo -e "${GREEN}PASSED:${NC} all ${TOTAL} email leaf keys present and non-empty in every locale (${LOCALES[*]})"
else
    echo -e "${RED}FAILED:${NC} email locale parity broken — bring all locales in sync"
    echo -e "${YELLOW}Fix: add/fill missing keys in .shared-kernel/domain/email/locales/email-i18n.<locale>.json${NC}"
    echo -e "${YELLOW}Then propagate the kernel: npm run system:kernel${NC}"
fi

exit $EXIT_CODE
