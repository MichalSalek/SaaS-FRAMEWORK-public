#!/bin/bash

set -euo pipefail

source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)
I18N_DIR="$PROJECT_ROOT/.shared-kernel/domain/i18n"
LOCALES_DIR="$PROJECT_ROOT/main/src/locales"
CONFIG_FILE="$I18N_DIR/i18n.config.ts"
VALIDATION_FILE="$I18N_DIR/validation.i18n.ts"

# File existence checks
if [[ ! -f "$CONFIG_FILE" ]]; then
    print_error "i18n.config.ts not found at $CONFIG_FILE"
    exit 1
fi

if [[ ! -f "$VALIDATION_FILE" ]]; then
    print_error "validation.i18n.ts not found at $VALIDATION_FILE"
    exit 1
fi

if [[ ! -d "$LOCALES_DIR" ]]; then
    print_error "locales directory not found at $LOCALES_DIR"
    exit 1
fi

print_progress_bar() {
    local current=$1
    local total=$2
    local width=10
    local percentage=$((current * 100 / total))
    local filled=$((current * width / total))
    local empty=$((width - filled))

    printf "["
    printf "%*s" $filled | tr ' ' '█'
    printf "%*s" $empty | tr ' ' '░'
    printf "] %3d%%" $percentage
}

print_boxed_header "I18N COVERAGE AUDIT" "🌐"

# DECISION (nie usuwaj tego komentarza):
# SLEPA PLAMA ZAMKNIETA — z czterech sekcji tego audytu BLOKUJACA byla dokladnie
# JEDNA (§1: 207 kluczy `validation.*`), a §2 (parzystosc locale) i §3 (puste
# wartosci) tylko podbijaly licznik ostrzezen, ktory NIGDY nie dotykal kodu
# wyjscia. POMIAR: 207 z 4622 kluczy realnie bronionych = 4,5%. Praktyczny
# skutek: klucz dodany tylko do `pl` albo pusty string w `en` przechodzil
# pre-commit, pre-push i `run-all` jako „PASSED" — czyli wchodzil na produkcje
# jako goly klucz (`static.foo.bar`) albo pusty przycisk w interfejsie. To
# najgorszy mozliwy ksztalt bramki: sekcja, ktora wypisuje pelna liste naruszen
# i konczy zerem.
# Obie sekcje sa teraz BLOKUJACE. Zweryfikowane PRZED zmiana, ze sa zielone:
# 3 locale × 4622 klucze, identyczne zbiory, zero pustych wartosci — wiec
# ratchet startuje z czystego stanu i lapie wylacznie regresje.
# §4 (klucze osierocone) zostaje swiadomie POZA audytem — powod w naglowku tej
# sekcji (scope `useTranslations`, statyczna analiza dawalaby falszywki).
EXIT_CODE=0

# ============================================================================
# SECTION 1: Validation keys (from validation.i18n.ts) — ERROR level
# ============================================================================

# Extract validation keys from validation.i18n.ts
VALIDATION_KEYS=$(grep -o "'validation\.[^']*'" "$VALIDATION_FILE" | sed "s/'//g" | sort -u)
TOTAL_VALIDATION_KEYS=$(echo "$VALIDATION_KEYS" | wc -l)

print_header "§1 VALIDATION KEYS COVERAGE"
echo -e "${BLUE}Expected validation keys from validation.i18n.ts:${NC} $TOTAL_VALIDATION_KEYS"
echo
printf "%-8s %-6s %-12s %-8s\n" "Locale" "Keys" "Coverage" "Status"
echo "────────────────────────────────────────────"

declare -A LOCALE_RESULTS
declare -A MISSING_KEYS
declare -A EXTRA_KEYS

# Check each locale efficiently
for locale in de en pl; do
    COMMON_FILE="$LOCALES_DIR/$locale/common.json"

    if [[ ! -f "$COMMON_FILE" ]]; then
        printf "%-8s %-6s %-12s %-8s\n" "$locale" "N/A" "FILE MISSING" "❌"
        EXIT_CODE=1
        continue
    fi

    # Use Python to do all the work in one go
    RESULT=$(python3 -c "
import json
import sys

try:
    with open('$COMMON_FILE') as f:
        data = json.load(f)

    def extract_keys(obj, prefix=''):
        keys = []
        if isinstance(obj, dict):
            for k, v in obj.items():
                new_key = f'{prefix}.{k}' if prefix else k
                if isinstance(v, dict):
                    keys.extend(extract_keys(v, new_key))
                else:
                    keys.append(new_key)
        return keys

    json_validation_keys = set(key for key in extract_keys(data) if key.startswith('validation.'))
    expected_keys = set('''$VALIDATION_KEYS'''.strip().split('\n'))

    found_keys = len(expected_keys & json_validation_keys)
    missing_keys = expected_keys - json_validation_keys
    extra_keys = json_validation_keys - expected_keys

    print(f'{found_keys}')
    if missing_keys:
        print('MISSING:')
        for key in sorted(missing_keys):
            print(f'  - {key}')
    if extra_keys:
        print('EXTRA:')
        for key in sorted(extra_keys):
            print(f'  - {key}')

except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
")

    FOUND_KEYS=$(echo "$RESULT" | head -1)
    COVERAGE_PERCENT=$((FOUND_KEYS * 100 / TOTAL_VALIDATION_KEYS))

    # Store results for later display
    LOCALE_RESULTS[$locale]="$FOUND_KEYS/$TOTAL_VALIDATION_KEYS"

    if grep -q "MISSING:" <<< "$RESULT"; then
        MISSING_KEYS[$locale]=$(echo "$RESULT" | sed -n '/MISSING:/,/EXTRA:/p' | grep "  -" || echo "$RESULT" | sed -n '/MISSING:/,$p' | grep "  -")
    fi

    if grep -q "EXTRA:" <<< "$RESULT"; then
        EXTRA_KEYS[$locale]=$(echo "$RESULT" | sed -n '/EXTRA:/,$p' | grep "  -")
    fi

    # Print table row
    printf "%-8s %-6s " "$locale" "$FOUND_KEYS"
    print_progress_bar $FOUND_KEYS $TOTAL_VALIDATION_KEYS

    if [[ $FOUND_KEYS -eq $TOTAL_VALIDATION_KEYS ]]; then
        echo -e " ${GREEN}✅${NC}"
    else
        echo -e " ${RED}❌${NC}"
        EXIT_CODE=1
    fi
done

# Show missing translations grouped by locale
HAS_MISSING=false
for locale in de en pl; do
    if [[ -n "${MISSING_KEYS[$locale]:-}" ]]; then
        if [[ "$HAS_MISSING" == "false" ]]; then
            echo
            print_header "❌ MISSING TRANSLATIONS"
            HAS_MISSING=true
        fi
        echo -e "\n${BOLD}${RED}$locale locale:${NC}"
        echo "${MISSING_KEYS[$locale]}" | sed 's/  - /  • /'
    fi
done

# Show unused translations
HAS_UNUSED=false
for locale in de en pl; do
    if [[ -n "${EXTRA_KEYS[$locale]:-}" ]]; then
        if [[ "$HAS_UNUSED" == "false" ]]; then
            echo
            print_header "🗑️  UNUSED TRANSLATIONS"
            HAS_UNUSED=true
        fi
        echo -e "\n${BOLD}${YELLOW}$locale locale:${NC}"
        echo "${EXTRA_KEYS[$locale]}" | sed 's/  - /  • /'
    fi
done

# ============================================================================
# SECTION 2: Locale parity check (PL/EN/DE) — ERROR level (blocking, see DECISION above)
# Checks that ALL keys (every namespace, every nesting level) exist in all 3 locales
# ============================================================================

echo
print_header "§2 LOCALE PARITY CHECK (PL/EN/DE)"

PARITY_RESULT=$(python3 -c "
import json
import sys

locales = ['de', 'en', 'pl']
keys_per_locale = {}

for locale in locales:
    path = '$LOCALES_DIR/' + locale + '/common.json'
    with open(path) as f:
        data = json.load(f)

    def extract_keys(obj, prefix=''):
        keys = []
        if isinstance(obj, dict):
            for k, v in obj.items():
                new_key = f'{prefix}.{k}' if prefix else k
                if isinstance(v, dict):
                    keys.extend(extract_keys(v, new_key))
                else:
                    keys.append(new_key)
        return keys

    keys_per_locale[locale] = set(extract_keys(data))

all_keys = set()
for locale in locales:
    all_keys |= keys_per_locale[locale]

total_keys = len(all_keys)
has_issues = False

for locale in locales:
    missing = all_keys - keys_per_locale[locale]
    if missing:
        has_issues = True
        print(f'LOCALE_MISSING:{locale}:{len(missing)}')
        for key in sorted(missing):
            print(f'  - {key}')

if not has_issues:
    print(f'PARITY_OK:{total_keys}')
else:
    print(f'PARITY_TOTAL:{total_keys}')
")

if grep -q "^PARITY_OK:" <<< "$PARITY_RESULT"; then
    TOTAL_ALL_KEYS=$(echo "$PARITY_RESULT" | grep "^PARITY_OK:" | cut -d: -f2)
    echo -e "${GREEN}✅ PASS:${NC} All 3 locales have identical key sets (${TOTAL_ALL_KEYS} keys each)"
else
    TOTAL_ALL_KEYS=$(echo "$PARITY_RESULT" | grep "^PARITY_TOTAL:" | cut -d: -f2)
    echo -e "${RED}❌ FAIL:${NC} Locale key mismatch detected (union: ${TOTAL_ALL_KEYS} keys)"
    EXIT_CODE=1

    for locale in de en pl; do
        LOCALE_LINE=$(echo "$PARITY_RESULT" | grep "^LOCALE_MISSING:${locale}:" || true)
        if [[ -n "$LOCALE_LINE" ]]; then
            MISSING_COUNT=$(echo "$LOCALE_LINE" | cut -d: -f3)
            echo -e "\n${BOLD}${YELLOW}${locale} locale — missing ${MISSING_COUNT} keys:${NC}"
            # Show keys between this locale's header and next header (or end)
            echo "$PARITY_RESULT" | sed -n "/^LOCALE_MISSING:${locale}:/,/^LOCALE_MISSING:\|^PARITY_/{ /^  -/p }" | sed 's/  - /  • /' | head -20
            if [[ $MISSING_COUNT -gt 20 ]]; then
                echo -e "  ${GRAY}... and $((MISSING_COUNT - 20)) more${NC}"
            fi
        fi
    done
fi

# ============================================================================
# SECTION 3: Empty value detection — ERROR level (blocking, see DECISION above)
# Checks that no translation value is an empty string ""
# ============================================================================

echo
print_header "§3 EMPTY VALUE CHECK"

EMPTY_RESULT=$(python3 -c "
import json
import sys

locales = ['de', 'en', 'pl']
has_empties = False

for locale in locales:
    path = '$LOCALES_DIR/' + locale + '/common.json'
    with open(path) as f:
        data = json.load(f)

    def find_empty(obj, prefix=''):
        empties = []
        if isinstance(obj, dict):
            for k, v in obj.items():
                new_key = f'{prefix}.{k}' if prefix else k
                if isinstance(v, dict):
                    empties.extend(find_empty(v, new_key))
                elif isinstance(v, str) and v.strip() == '':
                    empties.append(new_key)
        return empties

    empties = find_empty(data)
    if empties:
        has_empties = True
        print(f'EMPTY:{locale}:{len(empties)}')
        for key in sorted(empties):
            print(f'  - {key}')

if not has_empties:
    print('EMPTY_OK')
")

if grep -q "^EMPTY_OK" <<< "$EMPTY_RESULT"; then
    echo -e "${GREEN}✅ PASS:${NC} No empty translation values found in any locale"
else
    echo -e "${RED}❌ FAIL:${NC} Empty translation values detected"
    EXIT_CODE=1

    for locale in de en pl; do
        LOCALE_LINE=$(echo "$EMPTY_RESULT" | grep "^EMPTY:${locale}:" || true)
        if [[ -n "$LOCALE_LINE" ]]; then
            EMPTY_COUNT=$(echo "$LOCALE_LINE" | cut -d: -f3)
            echo -e "\n${BOLD}${YELLOW}${locale} locale — ${EMPTY_COUNT} empty values:${NC}"
            echo "$EMPTY_RESULT" | sed -n "/^EMPTY:${locale}:/,/^EMPTY:\|^EMPTY_/{ /^  -/p }" | sed 's/  - /  • /' | head -20
            if [[ $EMPTY_COUNT -gt 20 ]]; then
                echo -e "  ${GRAY}... and $((EMPTY_COUNT - 20)) more${NC}"
            fi
        fi
    done
fi

# ============================================================================
# SECTION 4: Orphaned keys detection — SKIPPED
#
# WHY: next-intl useTranslations('namespace') scopes t() calls to a namespace,
# so t('title') actually resolves to 'namespace.title'. Reliably reconstructing
# the full key path would require parsing every useTranslations() scope and
# mapping each t() call to its enclosing scope — including hooks that pass t()
# as a parameter, dynamic namespace composition, and components receiving
# scoped t functions as props. This makes static analysis unreliable and would
# produce excessive false positives.
#
# RECOMMENDATION: If orphan detection is needed in the future, consider:
# 1. A runtime approach (instrument next-intl to log used keys in dev mode)
# 2. A TypeScript-based AST analysis that follows useTranslations scopes
# ============================================================================

# ============================================================================
# SUMMARY
# ============================================================================

echo
print_header "🔧 ACTION ITEMS"
if [[ "$HAS_MISSING" == "true" ]]; then
    echo -e "${RED}1. Add missing validation keys to respective common.json files${NC}"
fi
if [[ "$HAS_UNUSED" == "true" ]]; then
    echo -e "${YELLOW}2. Remove unused validation keys from common.json${NC}"
fi
echo -e "${BLUE}3. Ensure all validation keys from validation.i18n.ts are translated${NC}"
if [[ $EXIT_CODE -ne 0 ]]; then
    echo -e "${RED}4. Napraw parity / puste wartosci powyzej — BLOKUJACE (dodaj brakujacy klucz do wszystkich 3 locale, uzupelnij pusty string)${NC}"
fi

echo
print_header "📋 SUMMARY"
if [[ $EXIT_CODE -eq 0 ]]; then
    echo -e "${GREEN}✅ PASSED:${NC} All validation keys translated, locales in sync, no empty values"
else
    echo -e "${RED}❌ FAILED:${NC} Translation coverage incomplete (validation keys / locale parity / empty values)"
fi

exit $EXIT_CODE
