#!/usr/bin/env bash
# stripe-scope.sh — Guard: every Stripe product/price LIST query scopes to Nailfolio.
#
# INTENT:
#   The plan catalogue is only the products that carry the plan prefix
#   (metadata.planId startsWith 'app-price-', via the kernel helper
#   isScopedToNailfolio). Anything else (objects created by hand in the dashboard,
#   archived products) is ignored, so every list query is scoped. This ratchet fails the
#   moment a Stripe list-query lands in a file that does not also scope via
#   isScopedToNailfolio.
#
# WHAT IT CHECKS (hard fail):
#   Every web-1/src file (excl READONLY-shared-kernel, *.test.ts) that calls
#   `.prices.list(` or `.products.list(` must also reference `isScopedToNailfolio`
#   somewhere in the same file.
#
# EXIT: 0 if PASS, 1 if an unscoped Stripe list-query file is found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC="${ROOT}/web-1/src"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$SRC" "źródeł web-1"

print_boxed_header "Stripe scope: product/price queries scoped to Nailfolio" "💳"

VIOLATIONS=0

# Files with a Stripe list-query (prices.list / products.list), excl READONLY + tests.
LIST_FILES=$(grep -rlE '\.(prices|products)\.list\(' "$SRC" --include='*.ts' \
  | grep -v '/READONLY-shared-kernel/' \
  | grep -vE '\.test\.ts$' || true)

if [[ -z "$LIST_FILES" ]]; then
  print_info "No Stripe prices.list/products.list call-sites found."
fi

# DECISION (nie usuwaj tego komentarza): scope is checked at FILE granularity —
# a single `isScopedToNailfolio` reference anywhere in a file passes ALL of that
# file's `.prices.list(` / `.products.list(` call-sites. KNOWN GAP: a file that
# scopes one list-query but adds a SECOND, unscoped list-query would still pass.
# We accept this because the Stripe surface is tiny (2 files: pricing.operations
# + price-resolver.operations) and reviewable by eye; per-call AST parsing of
# which list-call carries the scope filter would be brittle and over-engineered
# for the surface. If the Stripe surface grows, revisit toward per-call scoping.
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if grep -q 'isScopedToNailfolio' "$f"; then
    print_success "scoped: ${f#"$ROOT"/}"
  else
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "UNSCOPED Stripe list-query: ${f#"$ROOT"/} - add isScopedToNailfolio"
  fi
done <<< "$LIST_FILES"

print_separator
if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "stripe-scope audit FAILED — ${VIOLATIONS} unscoped Stripe query file(s)"
  exit 1
fi
print_success "stripe-scope audit PASSED — all Stripe product/price queries scope to Nailfolio"
exit 0
