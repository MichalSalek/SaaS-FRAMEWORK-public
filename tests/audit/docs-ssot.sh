#!/bin/bash

# DOCS SSOT AUDIT — code-only brand/domain consistency.
# In run-all (npm run audit:all / git:push).
#
# Scans PRODUCTION CODE only. docs/ are intentionally NOT scanned: analysis /
# review files legitimately quote the old domain/brand IN THE CONTEXT of fixing
# it (e.g. "BUG: kontakt@nailfolio.com → .app"), which produced false-positives,
# and the per-file exception list to suppress them rotted with every new report.
# Doc hygiene is out of scope here — this guards what ships.
#
# Canonical values: DOMAIN_SSOT §0 (nailfolio.app). Update STALE_* if §0 changes.

# Source utilities
source "$(dirname "$0")/_utils.sh"

print_boxed_header "DOCS SSOT AUDIT (code)"

# Get project root
PROJECT_ROOT=$(get_project_root)
ERRORS=0
WARNINGS=0

# ─────────────────────────────────────────────
# Stale values to reject in production code (DOMAIN_SSOT §0)
# ─────────────────────────────────────────────
STALE_DOMAIN="nailfolio.com"
STALE_BRANDS=("NailGallery" "Nail Gallery" "Nail-Gallery" "NailBook")
STALE_EMAIL_DOMAIN="@nailfolio.com"

# Production source roots. READONLY kernel copies are excluded — the kernel SSOT
# is .shared-kernel/, and copy fidelity is validated by kernel-sync.sh.
CODE_DIRS=(".shared-kernel" "main/src" "web-1/src")

# ─────────────────────────────────────────────
# Helper: literal-string scan across code roots → "file:line:..." hits
# ─────────────────────────────────────────────
scan_code() {
    local pattern="$1"
    local dir target
    for dir in "${CODE_DIRS[@]}"; do
        target="$PROJECT_ROOT/$dir"
        [[ ! -d "$target" ]] && continue
        rg --no-heading -n -F "$pattern" "$target" \
            --glob '!**/node_modules/**' \
            --glob '!**/.next/**' \
            --glob '!**/READONLY-shared-kernel/**' \
            2>/dev/null || true
    done
}

# ─────────────────────────────────────────────
# CHECK 1: Stale domain in code
# ─────────────────────────────────────────────
print_header "Check 1: Stale domain ($STALE_DOMAIN) in code"

DOMAIN_HITS=$(scan_code "$STALE_DOMAIN" | grep -v '^$' || true)

if [[ -z "$DOMAIN_HITS" ]]; then
    print_success "No stale domain in code"
else
    count=$(echo "$DOMAIN_HITS" | wc -l)
    print_error "Found $count stale domain references in code:"
    echo "$DOMAIN_HITS" | head -20 | while IFS= read -r line; do
        echo -e "    ${GRAY}$line${NC}"
    done
    ERRORS=$((ERRORS + count))
fi

# ─────────────────────────────────────────────
# CHECK 2: Stale brand names in code
# ─────────────────────────────────────────────
print_header "Check 2: Stale brand names in code"

BRAND_ERRORS=0
for brand in "${STALE_BRANDS[@]}"; do
    brand_hits=$(scan_code "$brand" | grep -v '^$' || true)
    if [[ -n "$brand_hits" ]]; then
        count=$(echo "$brand_hits" | wc -l)
        print_error "Found $count stale '$brand' references in code:"
        echo "$brand_hits" | head -10 | while IFS= read -r line; do
            echo -e "    ${GRAY}$line${NC}"
        done
        BRAND_ERRORS=$((BRAND_ERRORS + count))
    fi
done

if [[ $BRAND_ERRORS -eq 0 ]]; then
    print_success "No stale brand names in code"
else
    ERRORS=$((ERRORS + BRAND_ERRORS))
fi

# ─────────────────────────────────────────────
# CHECK 3: Stale email domain in code
# ─────────────────────────────────────────────
print_header "Check 3: Stale email domain ($STALE_EMAIL_DOMAIN) in code"

EMAIL_HITS=$(scan_code "$STALE_EMAIL_DOMAIN" | grep -v '^$' || true)

if [[ -z "$EMAIL_HITS" ]]; then
    print_success "No stale email domain in code"
else
    count=$(echo "$EMAIL_HITS" | wc -l)
    print_error "Found $count stale email domain references in code:"
    echo "$EMAIL_HITS" | head -20 | while IFS= read -r line; do
        echo -e "    ${GRAY}$line${NC}"
    done
    ERRORS=$((ERRORS + count))
fi

# ─────────────────────────────────────────────
# CHECK 4: SSOT reference header in satellite docs
# (deterministic presence-check on a fixed file list — not a stale-value scan,
#  so it does not rot. Kept because it is cheap and catches drift.)
# ─────────────────────────────────────────────
print_header "Check 4: SSOT reference header in satellite docs"

SATELLITE_DOCS=(
    "docs/DOMAIN/marketing/MARKETING_PLAN.md"
    "docs/DOMAIN/product/SUPPORT_PLAN.md"
    "docs/DOMAIN/marketing/REFERRAL_PROGRAM.md"
    "docs/DOMAIN/business/B2B_SALES_PLAYBOOK.md"
    "docs/DOMAIN/product/TARGET_ROUTING_AND_JOURNEY_MAP.md"
    "docs/DOMAIN/marketing/ASO_STRATEGY.md"
    "docs/DOMAIN/product/PUSH_NOTIFICATIONS_PLAN.md"
    "docs/DOMAIN/product/CANCELLATION_FLOW.md"
    "docs/DOMAIN/business/EXPANSION_STRATEGY.md"
    "docs/DOMAIN/product/ANALYTICS_TRACKING_PLAN.md"
    "docs/DOMAIN/LAUNCH_CHECKLIST.md"
    "docs/DOMAIN/marketing/MARKET_AND_PERSONAS.md"
    "docs/DOMAIN/GAP_ANALYSIS_REPORT.md"
    "docs/DOMAIN/business/BRIEF_PRAWNIK_KSIEGOWY.md"
)

MISSING_HEADERS=0
for doc in "${SATELLITE_DOCS[@]}"; do
    full_path="$PROJECT_ROOT/$doc"
    if [[ -f "$full_path" ]]; then
        if ! grep -q "DOMAIN_SSOT" "$full_path" 2>/dev/null; then
            print_warning "Missing SSOT ref: $doc"
            MISSING_HEADERS=$((MISSING_HEADERS + 1))
        fi
    fi
done

if [[ $MISSING_HEADERS -eq 0 ]]; then
    print_success "All ${#SATELLITE_DOCS[@]} satellite docs have SSOT reference"
else
    WARNINGS=$((WARNINGS + MISSING_HEADERS))
fi

# ─────────────────────────────────────────────
# CHECK 5: Unresolved placeholders in production code
# (launch guard — [COMPANY NAME] etc. are placeholders not resolved yet;
#  warning, not error, until then.)
# ─────────────────────────────────────────────
print_header "Check 5: Unresolved placeholders in production code"

PLACEHOLDER_PATTERNS='\[COMPANY NAME\]|\[NAZWA FIRMY\]|\[FIRMENNAME\]|\[ADDRESS\]|\[ADRES\]|\[ADRESSE\]|\[NUMER\]|\[NUMBER\]|\[NUMMER\]'

PLACEHOLDER_HITS=""
for dir in "main/src" "web-1/src"; do
    target="$PROJECT_ROOT/$dir"
    [[ ! -d "$target" ]] && continue
    # Exclude .ts/.tsx — TS [number] index type collides with [NUMBER] placeholder
    hits=$(rg --no-heading -n "$PLACEHOLDER_PATTERNS" "$target" \
        --glob '!**/node_modules/**' \
        --glob '!**/.next/**' \
        --glob '!**/READONLY-shared-kernel/**' \
        --glob '!*.ts' \
        --glob '!*.tsx' \
        2>/dev/null || true)
    if [[ -n "$hits" ]]; then
        PLACEHOLDER_HITS+="$hits"$'\n'
    fi
done

PLACEHOLDER_HITS=$(echo "$PLACEHOLDER_HITS" | grep -v '^$' || true)

if [[ -z "$PLACEHOLDER_HITS" ]]; then
    print_success "No unresolved placeholders"
else
    count=$(echo "$PLACEHOLDER_HITS" | wc -l)
    # Placeholders not resolved yet — warn, don't fail
    print_warning "Found $count placeholders (not resolved yet):"
    echo "$PLACEHOLDER_HITS" | head -10 | while IFS= read -r line; do
        echo -e "    ${GRAY}$line${NC}"
    done
    WARNINGS=$((WARNINGS + count))
fi

# ─────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────
echo
print_separator

if [[ $ERRORS -eq 0 ]]; then
    if [[ $WARNINGS -gt 0 ]]; then
        print_success "DOCS SSOT PASSED ($WARNINGS warnings)"
    else
        print_success "DOCS SSOT PASSED"
    fi
    exit 0
else
    print_error "DOCS SSOT FAILED: $ERRORS errors, $WARNINGS warnings"
    exit 1
fi
