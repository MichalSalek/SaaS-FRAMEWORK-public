#!/usr/bin/env bash
# pricing-parity.sh — Guard PricingPlan value parity across its split SSOT.
#
# INTENT:
#   PricingPlan is special: its values live in TWO places that MUST agree —
#     1. the Prisma `enum PricingPlan` in web-1/src/prisma/schema.prisma (the DB
#        constraint — what a `pricing_plan` column can physically store), and
#     2. `PricingPlanValue` in .shared-kernel/domain/pricing/pricing.config.ts
#        (the kernel SSOT used by all TS code, display names, pricing UI).
#   The DTO generator is told to SKIP PricingPlan (scripts/generate-dto/config.ts
#   SKIP_ENUMS) and import the kernel type instead — so the kernel is the source
#   of truth and the schema enum must mirror it. If they drift, code can type a
#   plan the DB enum rejects at write time (silent latent bug), e.g. a new tier
#   added to the kernel but not the schema can never be persisted.
#
# WHAT IT CHECKS (hard fail):
#   1. The Prisma enum PricingPlan value-set == the kernel PricingPlanValue value-set.
#   2. SKIP_ENUMS still lists 'PricingPlan' (so the generator keeps deferring to the
#      kernel SSOT — otherwise a generated duplicate would shadow the kernel type).
#
# EXIT: 0 if PASS, 1 if drift found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SCHEMA="${ROOT}/web-1/src/prisma/schema.prisma"
KERNEL="${ROOT}/.shared-kernel/domain/pricing/pricing.config.ts"
GEN_CONFIG="${ROOT}/scripts/generate-dto/config.ts"

print_boxed_header "PricingPlan parity: schema enum ↔ kernel SSOT" "💳"

VIOLATIONS=0

# ─── Extract the Prisma enum PricingPlan values ──────────────────────────────
SCHEMA_VALUES=$(awk '
  /^enum PricingPlan[[:space:]]*\{/ { f=1; next }
  f && /^\}/ { f=0 }
  f {
    gsub(/[[:space:]]/, "")
    gsub(/\/\/.*/, "")
    if ($0 != "") print
  }' "$SCHEMA" | sort)

# ─── Extract the kernel PricingPlanValue right-hand string literals ───────────
KERNEL_VALUES=$(awk '
  /PricingPlanValue[[:space:]]*=[[:space:]]*Object\.freeze/ { f=1; next }
  f && /\}[[:space:]]*as const/ { f=0 }
  f {
    if (match($0, /'\''[A-Z_]+'\''/)) {
      print substr($0, RSTART+1, RLENGTH-2)
    }
  }' "$KERNEL" | sort)

print_header "Check 1: enum value-set parity"
if [[ -z "$SCHEMA_VALUES" ]]; then
  print_error "Could not extract enum PricingPlan from schema.prisma"
  VIOLATIONS=$((VIOLATIONS + 1))
elif [[ -z "$KERNEL_VALUES" ]]; then
  print_error "Could not extract PricingPlanValue from pricing.config.ts"
  VIOLATIONS=$((VIOLATIONS + 1))
elif [[ "$SCHEMA_VALUES" != "$KERNEL_VALUES" ]]; then
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "PricingPlan DRIFT — schema enum and kernel PricingPlanValue differ"
  ONLY_SCHEMA=$(comm -23 <(echo "$SCHEMA_VALUES") <(echo "$KERNEL_VALUES") | tr '\n' ' ')
  ONLY_KERNEL=$(comm -13 <(echo "$SCHEMA_VALUES") <(echo "$KERNEL_VALUES") | tr '\n' ' ')
  [[ -n "$ONLY_SCHEMA" ]] && print_info "  Only in schema.prisma enum: ${ONLY_SCHEMA}"
  [[ -n "$ONLY_KERNEL" ]] && print_info "  Only in kernel PricingPlanValue: ${ONLY_KERNEL}"
  print_info "  Fix: add the missing value to BOTH (schema enum + kernel config), then db push."
else
  COUNT=$(echo "$SCHEMA_VALUES" | grep -c .)
  print_success "Parity holds — ${COUNT} values match (schema enum == kernel SSOT)"
fi

print_header "Check 2: SKIP_ENUMS still defers PricingPlan to the kernel"
if grep -qE "'PricingPlan'" "$GEN_CONFIG" && grep -qE "SKIP_ENUMS" "$GEN_CONFIG"; then
  print_success "SKIP_ENUMS lists 'PricingPlan' (generator defers to kernel SSOT)"
else
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "SKIP_ENUMS no longer lists 'PricingPlan' — generated duplicate could shadow the kernel type"
  print_info  "  Keep 'PricingPlan' in SKIP_ENUMS (scripts/generate-dto/config.ts) — kernel is the SSOT."
fi

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "pricing-parity audit FAILED — ${VIOLATIONS} issue(s)"
  echo ""
  exit 1
fi

print_success "pricing-parity audit PASSED — PricingPlan SSOT consistent"
exit 0
