#!/usr/bin/env bash
# secret-discipline.sh — Enforce timing-safe secret handling + schema governance.
#
# INTENT (BDX W1.4):
#   Secrets must be (a) compared in constant time and (b) governed by the env
#   schema. Two failure modes this ratchet locks out:
#     (a) raw `===` / `!==` value-comparison on a secret-named variable — a
#         non-constant-time compare leaks the secret byte-by-byte via timing.
#         The ONLY sanctioned compare is crypto.timingSafeEqual (length pre-check
#         + constant-time), centralized in verify-internal-secret.ts.
#     (b) a `process.env.*SECRET*` read whose var is NOT registered in
#         env-schema.ts — an ungoverned secret escapes the required/format
#         contract (W1.2) and can silently fail-OPEN in production.
#
# ALLOWLIST:
#   - application/auth/verify-internal-secret.ts  (the sanctioned timing-safe SSOT)
#   - application/environment/env-schema.ts        (the schema registry itself)
#   - application/environment/environment.config.ts (RAW_VARS registry — the ONLY
#     place process.env secrets are read into ENV_VARS)
#   - *.test.ts                                    (test fixtures use literal secrets)
#   - READONLY-shared-kernel/**                    (vendored kernel)
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
WEB1_SRC="${ROOT}/web-1/src"
ENV_SCHEMA="${WEB1_SRC}/application/environment/env-schema.ts"

print_boxed_header "Secret discipline: timing-safe + schema governance" "🔑"

VIOLATIONS=0

# Files exempt from BOTH checks (prefix match, relative to ROOT).
ALLOWLIST=(
  "web-1/src/application/auth/verify-internal-secret.ts"
  "web-1/src/application/environment/env-schema.ts"
  "web-1/src/application/environment/environment.config.ts"
  "web-1/src/READONLY-shared-kernel/"
)

is_allowlisted() {
  local rel="$1"
  [[ "$rel" == *.test.ts ]] && return 0
  for allowed in "${ALLOWLIST[@]}"; do
    [[ "$rel" == "${allowed}"* ]] && return 0
  done
  return 1
}

# ─── CHECK A: raw ===/!== on a secret-named variable ─────────────────────────
print_header "Check A: non-constant-time compare on secret variables"

CHECK_A_VIOLATIONS=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"
  is_allowlisted "$REL_PATH" && continue

  # Identifier containing 'secret' (any case) on either side of === / !==, when
  # the OTHER side is a value (not a `typeof x === 'string'` type guard).
  # Exclude `typeof ... secret ... === 'string'|'undefined'` guards explicitly.
  while IFS= read -r match; do
    [[ -z "$match" ]] && continue
    # Skip typeof type-guards — those are safe (compare a type tag, not the secret).
    grep -qiP "typeof\s+\w*secret\w*" <<<"$match" && continue
    grep -qiP "\w*secret\w*\s*(===|!==)\s*(typeof|undefined|null|''|\"\")" <<<"$match" && {
      # Comparing a secret var to undefined/null/'' is a presence check, not a
      # value compare — allowed (no secret bytes are compared).
      continue
    }

    LINE_NO="${match%%:*}"
    CHECK_A_VIOLATIONS="${CHECK_A_VIOLATIONS}${REL_PATH}:${LINE_NO}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION (compare) — ${REL_PATH}:${LINE_NO}"
    print_info  "  $(echo "$match" | cut -d: -f2- | sed 's/^[[:space:]]*//')"
    print_info  "  Fix: use verifyInternalSecret() / crypto.timingSafeEqual (constant-time)"
  done < <(grep -niP "\w*secret\w*\s*(===|!==)" "$file" 2>/dev/null || true)

done < <(find "$WEB1_SRC" -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 2>/dev/null \
  | grep -zv "node_modules\|\.next\|\.open-next\|/out/\|/dist/")

if [[ -z "$CHECK_A_VIOLATIONS" ]]; then
  print_success "No non-constant-time secret comparisons found"
fi

print_separator

# ─── CHECK B: process.env.*SECRET* must be registered in env-schema.ts ────────
print_header "Check B: every process.env.*SECRET* read is governed by env-schema.ts"

if [[ ! -f "$ENV_SCHEMA" ]]; then
  print_error "env-schema.ts not found at ${ENV_SCHEMA}"
  exit 1
fi

CHECK_B_VIOLATIONS=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"
  is_allowlisted "$REL_PATH" && continue

  while IFS= read -r match; do
    [[ -z "$match" ]] && continue
    LINE_NO="${match%%:*}"
    VAR_NAME=$(grep -oiP 'process\.env\.\K[A-Z_][A-Z0-9_]*SECRET[A-Z0-9_]*' <<<"$match" | head -1)
    [[ -z "$VAR_NAME" ]] && continue

    # The var MUST appear as a schema entry name in env-schema.ts.
    if ! grep -qP "name:\s*'${VAR_NAME}'" "$ENV_SCHEMA"; then
      CHECK_B_VIOLATIONS="${CHECK_B_VIOLATIONS}${REL_PATH}:${LINE_NO} → ${VAR_NAME}"$'\n'
      VIOLATIONS=$((VIOLATIONS + 1))
      print_error "VIOLATION (ungoverned secret) — ${REL_PATH}:${LINE_NO} reads process.env.${VAR_NAME}"
      print_info  "  Fix: register '${VAR_NAME}' in env-schema.ts (required:'prod', format:'secret') and read via ENV_VARS"
    fi
  done < <(grep -niP "process\.env\.[A-Z_]*SECRET" "$file" 2>/dev/null || true)

done < <(find "$WEB1_SRC" -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 2>/dev/null \
  | grep -zv "node_modules\|\.next\|\.open-next\|/out/\|/dist/")

if [[ -z "$CHECK_B_VIOLATIONS" ]]; then
  print_success "Every process.env.*SECRET* read is registered in env-schema.ts"
fi

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "secret-discipline audit FAILED — ${VIOLATIONS} violation(s) found"
  echo ""
  exit 1
fi

print_success "secret-discipline audit PASSED"
exit 0
