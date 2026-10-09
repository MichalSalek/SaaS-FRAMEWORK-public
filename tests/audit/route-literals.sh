#!/usr/bin/env bash
# route-literals.sh — Guard against hardcoded /app/ and /user/ string literals
# outside ROUTES_FRONT/ROUTES_API SSOT, and against raw .replace('[' patterns
# on route strings that should use buildRoute().
#
# INTENT:
#   ROUTES_FRONT and ROUTES_API in .shared-kernel/domain/routing/routing.config.ts
#   are the single source of truth for all frontend routes. Hardcoded '/app/...'
#   or '/user/...' strings in runtime code create silent drift when routes change.
#   buildRoute() replaces manual .replace('[param]', value) patterns and ensures
#   type-safe param interpolation.
#
# WHAT IT CHECKS:
#   1. Raw .replace('[') call-sites on route strings (use buildRoute() instead).
#   2. Hardcoded '/app/' or '/user/' string literals in .ts/.tsx source files
#      outside of the ROUTES SSOT definition and known allowlisted locations.
#
# ALLOWLIST — intentional literals (not violations):
#   REPLACE check allowlist: (none — all .replace('[') on routes migrated to buildRoute)
#
#   LITERAL check allowlist:
#   - routing.config.ts — SSOT definitions themselves
#   - route= JSX props (decorative, demo data, not navigation) — excluded via grep
#   - *.test.ts / *.test.tsx — test assertions may reference literal values
#   - ui-library/ — playground/demo components with illustrative data
#   - static/ — LP/marketing pages use route= decorative props for phone mockups
#   - home/HomePage.tsx — decorative route: in mockup data objects
#   - tests/audit/ — audit scripts themselves
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
MAIN_SRC="${ROOT}/main/src"

print_boxed_header "Route literals: SSOT enforcement audit" "🗺️"

VIOLATIONS=0

# ─── CHECK 1: .replace('[') on route strings ─────────────────────────────────

print_header "Check 1: .replace('[') call-sites on routes"

# Allowlist for raw .replace('[') — files excluded from this check.
# Each entry is a path relative to ROOT.
REPLACE_ALLOWLIST=()

REPLACE_VIOLATIONS=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"

  SKIP=0
  for allowed in "${REPLACE_ALLOWLIST[@]}"; do
    if [[ "$REL_PATH" == "$allowed" ]]; then
      SKIP=1
      break
    fi
  done
  [[ "$SKIP" -eq 1 ]] && continue

  # grep for .replace('[ or .replace("[  (the literal bracket in the param)
  if grep -qP "\.replace\(['\"]\\[" "$file" 2>/dev/null; then
    LINES=$(grep -nP "\.replace\(['\"]\\[" "$file" | cut -d: -f1 | sort -u | tr '\n' ',' | sed 's/,$//')
    REPLACE_VIOLATIONS="${REPLACE_VIOLATIONS}${REL_PATH}:${LINES}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION (replace) — ${REL_PATH} at line(s): ${LINES}"
    print_info  "  Fix: use buildRoute(ROUTE_TEMPLATE, { param: value }) instead"
  fi
# DECISION (nie usuwaj tego komentarza): anchored /out/ /dist/ — bare "out"/"dist"
# are unanchored substrings that silently eat any path containing checkout/layouts/
# route/logout/about (e.g. pages/app/checkout/, UI/layouts/, route-access.policy).
# Anchored form matches only real build-output dirs, same as sibling audits.
done < <(find "$MAIN_SRC" -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 \
  | grep -zv "node_modules\|\.next\|/out/\|/dist/")

if [[ -z "$REPLACE_VIOLATIONS" ]]; then
  print_success "No .replace('[') call-sites on routes found"
fi

print_separator

# ─── CHECK 2: Hardcoded /app/ or /user/ string literals ─────────────────────

print_header "Check 2: Hardcoded /app/ or /user/ string literals"

# Allowlist directory/file prefixes (relative to ROOT) exempt from the literal check.
LITERAL_PATH_ALLOWLIST=(
  ".shared-kernel/domain/routing/routing.config.ts"
  # DECISION (nie usuwaj tego komentarza): READONLY-shared-kernel is the
  # kernel-copied-into-main mirror (submoduły→kernel kopiowany); its
  # routing.config.ts is a verbatim copy of the ROUTES SSOT above, not drift.
  "main/src/READONLY-shared-kernel/domain/routing/routing.config.ts"
  "tests/"
  # LP/static pages: only use route= decorative props (not navigation) — filtered below
  "main/src/UI/features/static/"
  # UI library: illustrative demo data, not navigation
  "main/src/UI/features/ui-library/"
  # HomePage mockup data objects use route: for phone-frame illustrations
  "main/src/UI/features/home/HomePage.tsx"
  # DECISION (nie usuwaj tego komentarza): route-access.policy.ts holds an
  # INTENTIONAL parallel access-control classification list (account-route vs
  # product-route vs static, per SPE web-login-first route-access policy). These
  # '/app/' '/user/' literals are a security-classification table, semantically
  # distinct from ROUTES_FRONT navigation SSOT — NOT nav drift. They must stay
  # as raw literals so the policy classifies paths independently of nav config.
  "main/src/application/policies/route-access.policy.ts"
)

LITERAL_VIOLATIONS=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"

  # Skip test files
  if [[ "$REL_PATH" == *.test.ts || "$REL_PATH" == *.test.tsx ]]; then
    continue
  fi

  SKIP=0
  for allowed in "${LITERAL_PATH_ALLOWLIST[@]}"; do
    if [[ "$REL_PATH" == "${allowed}"* ]]; then
      SKIP=1
      break
    fi
  done
  [[ "$SKIP" -eq 1 ]] && continue

  # Find lines matching the pattern.
  # Exclude: route= JSX props (decorative), route: object-key literals (demo data).
  # These are identified by the preceding context: route=  or  route:
  # DECISION (nie usuwaj tego komentarza): also exclude comment lines (first
  # non-space char is `*` JSDoc or `//` line-comment) — '/app/...' inside doc
  # examples (e.g. buildRoute.ts usage JSDoc) is documentation, not a runtime
  # literal, so it is not nav drift.
  # S82: klasa quote OBEJMUJE backtick — dwa realne hardcode'y (template
  # literals `href={\`/app/photo/${id}\`}`) przechodziły na zielono, bo
  # wzorzec łapał tylko ' i " (false-PASS = strażnik mierzył podzbiór).
  MATCHING_LINES=$(grep -nP "['\"\`]\/(?:app|user)\/" "$file" 2>/dev/null \
    | grep -vP "route\s*[=:]\s*['\"\`]\/(?:app|user)\/" \
    | grep -vP "^[0-9]+:\s*(?:\*|//|/\*)" \
    || true)

  if [[ -n "$MATCHING_LINES" ]]; then
    LINES=$(echo "$MATCHING_LINES" | cut -d: -f1 | sort -u | tr '\n' ',' | sed 's/,$//')
    LITERAL_VIOLATIONS="${LITERAL_VIOLATIONS}${REL_PATH}:${LINES}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION (literal) — ${REL_PATH} at line(s): ${LINES}"
    print_info  "  Fix: use ROUTES_FRONT.* or ROUTES_API.* from routing.config"
    echo "$MATCHING_LINES" | head -3 | while IFS= read -r line; do
      print_info "    $(echo "$line" | sed 's/^[[:space:]]*//')"
    done
  fi
# DECISION (nie usuwaj tego komentarza): anchored /out/ /dist/ (patrz Check 1).
done < <(find "${ROOT}/main/src" -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 2>/dev/null \
  | grep -zv "node_modules\|\.next\|/out/\|/dist/")

if [[ -z "$LITERAL_VIOLATIONS" ]]; then
  print_success "No hardcoded /app/ or /user/ literals found outside SSOT"
fi

print_separator

# ─── Result ──────────────────────────────────────────────────────────────────

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "route-literals audit FAILED — ${VIOLATIONS} violation(s) found"
  echo ""
  exit 1
fi

print_success "route-literals audit PASSED — routes use SSOT consistently"
exit 0
