#!/usr/bin/env bash
# env-governance.sh — Guard against ungoverned raw `process.env.X` reads in web-1.
#
# INTENT (BDX W1.2):
#   web-1 env vars MUST flow through a single registry + schema:
#     environment.config.ts (RAW_VARS registry) → env-schema.ts (validation) →
#     ENV_VARS (typed, normalized export). Raw `process.env.X` reads scattered
#     across the codebase bypass that SSOT: they skip normalization, escape the
#     required/optional + format contract, and drift silently when a var is
#     renamed. A new ungoverned read therefore = build break.
#
# WHAT IT CHECKS:
#   Check A — Any `process.env.<NAME>` access in web-1/src/** OUTSIDE the registry
#     files and the framework/runtime allowlist is a violation. Callers must read
#     via ENV_VARS.
#   Check B — RAW_VARS registry (environment.config.ts) and ENV_SCHEMA (env-schema.ts)
#     MUST list the SAME var names. The two files split concerns deliberately —
#     config resolves+normalizes the VALUE (typed ENV_VARS export), schema declares
#     the CONTRACT (required/optional + format + boot fail-policy) — but the var-name
#     list is the one fact they share. A var in RAW_VARS but not ENV_SCHEMA is read
#     yet UNGOVERNED (no required/format validation); a var in ENV_SCHEMA but not
#     RAW_VARS validates `undefined` (never reaches ENV_VARS). Either = silent drift,
#     exactly the "drift silently" risk this audit's intent names. This check closes
#     the only maintainability seam of the two-file design.
#
# ALLOWLIST:
#   FILE allowlist (these ARE the registry / are vendored generated code):
#     - application/environment/environment.config.ts  (RAW_VARS registry — the ONLY
#       place raw process.env is read for app config)
#     - application/environment/env-schema.ts           (reads process.env.PPID/NODE_ENV
#       for run-once flag + soft-mode detection only)
#     - prisma/js-client/**  prisma-app-logs/js-client/**  (generated Prisma clients)
#     - READONLY-shared-kernel/**                        (vendored kernel copy — governed
#       upstream, READONLY here)
#   VAR allowlist (framework / runtime built-ins — NOT application config; owned by
#   the Node/Next/Vercel platform, never user-supplied .env app config):
#     - NODE_ENV       (Node built-in: 'development' | 'production' | 'test')
#     - NEXT_RUNTIME   (Next.js built-in: 'nodejs' | 'edge')
#     - VERCEL         (Vercel platform marker: '1' on Vercel)
#     - PPID           (process metadata — used by the run-once flag)
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
WEB1_SRC="${ROOT}/web-1/src"

print_boxed_header "Env governance: ENV_VARS SSOT enforcement" "🔐"

VIOLATIONS=0

# ── File-path allowlist (relative to ROOT) — prefix match ──────────────────────
FILE_ALLOWLIST=(
  "web-1/src/application/environment/environment.config.ts"
  "web-1/src/application/environment/env-schema.ts"
  "web-1/src/prisma/js-client/"
  "web-1/src/prisma-app-logs/js-client/"
  "web-1/src/READONLY-shared-kernel/"
)

# ── Var-name allowlist (framework/runtime built-ins) ───────────────────────────
# A process.env.X read whose X is in this set is NOT an app-config governance miss.
VAR_ALLOWLIST="NODE_ENV NEXT_RUNTIME VERCEL PPID"

is_allowed_var() {
  local var="$1"
  for allowed in $VAR_ALLOWLIST; do
    [[ "$var" == "$allowed" ]] && return 0
  done
  return 1
}

print_header "Check A — Raw process.env.<NAME> reads outside ENV_VARS registry"

GOVERNANCE_VIOLATIONS=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"

  SKIP=0
  for allowed in "${FILE_ALLOWLIST[@]}"; do
    if [[ "$REL_PATH" == "${allowed}"* ]]; then
      SKIP=1
      break
    fi
  done
  [[ "$SKIP" -eq 1 ]] && continue

  # Match `process.env.NAME` (dot access). Spread `...process.env` and bracket
  # access are not captured by this pattern (the dot form is the governed read).
  while IFS= read -r match; do
    [[ -z "$match" ]] && continue
    LINE_NO="${match%%:*}"
    VAR_NAME=$(echo "$match" | grep -oP 'process\.env\.\K[A-Z_][A-Z0-9_]*' | head -1)

    [[ -z "$VAR_NAME" ]] && continue
    if is_allowed_var "$VAR_NAME"; then
      continue
    fi

    GOVERNANCE_VIOLATIONS="${GOVERNANCE_VIOLATIONS}${REL_PATH}:${LINE_NO} → process.env.${VAR_NAME}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION — ${REL_PATH}:${LINE_NO} reads process.env.${VAR_NAME}"
    print_info  "  Fix: read via ENV_VARS.${VAR_NAME} (register in environment.config.ts + env-schema.ts)"
  done < <(grep -nP 'process\.env\.[A-Z_]' "$file" 2>/dev/null || true)

done < <(find "$WEB1_SRC" -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 2>/dev/null \
  | grep -zv "node_modules\|\.next\|\.open-next\|/out/\|/dist/")

if [[ -z "$GOVERNANCE_VIOLATIONS" ]]; then
  print_success "No ungoverned process.env reads in web-1/src"
fi

print_separator

# ── Check B: RAW_VARS registry ↔ ENV_SCHEMA name parity ────────────────────────
print_header "Check B — RAW_VARS registry <-> ENV_SCHEMA parity"

CONFIG_FILE="${WEB1_SRC}/application/environment/environment.config.ts"
SCHEMA_FILE="${WEB1_SRC}/application/environment/env-schema.ts"

# RAW_VARS keys: every `KEY:` line inside the `const RAW_VARS = { ... } as const;`
# block. Handles both single-line (`KEY: normalizeX(...)`) and multi-line
# (`KEY:` then `  normalizeX(...) || 'default'`) forms — the key is the `KEY:` line,
# never the lowercase `normalizeX(` / `'default'` continuation lines.
RAW_KEYS=$(awk '/const RAW_VARS = \{/{f=1} f{print} /^\} as const;/{if(f)exit}' "$CONFIG_FILE" \
  | grep -oE '^[[:space:]]+[A-Z_][A-Z0-9_]*:' | tr -d ' :' | sort -u)

# ENV_SCHEMA names: every `name: 'KEY'` entry.
SCHEMA_NAMES=$(grep -oE "name: '[A-Z_][A-Z0-9_]*'" "$SCHEMA_FILE" \
  | grep -oE "[A-Z_][A-Z0-9_]*" | sort -u)

# In RAW_VARS but NOT ENV_SCHEMA → read but ungoverned (no required/format contract).
UNGOVERNED=$(comm -23 <(echo "$RAW_KEYS") <(echo "$SCHEMA_NAMES") | grep -v '^$' || true)
# In ENV_SCHEMA but NOT RAW_VARS → validates `undefined`, never reaches ENV_VARS.
ORPHANED=$(comm -13 <(echo "$RAW_KEYS") <(echo "$SCHEMA_NAMES") | grep -v '^$' || true)

if [[ -n "$UNGOVERNED" ]]; then
  while IFS= read -r var; do
    [[ -z "$var" ]] && continue
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "DRIFT — ${var} in RAW_VARS (environment.config.ts) but missing from ENV_SCHEMA"
    print_info  "  Fix: add { name: '${var}', required: ..., format: ... } to env-schema.ts ENV_SCHEMA"
  done <<< "$UNGOVERNED"
fi

if [[ -n "$ORPHANED" ]]; then
  while IFS= read -r var; do
    [[ -z "$var" ]] && continue
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "DRIFT — ${var} in ENV_SCHEMA (env-schema.ts) but missing from RAW_VARS"
    print_info  "  Fix: add ${var}: normalizeString(process.env.${var}) to environment.config.ts RAW_VARS"
  done <<< "$ORPHANED"
fi

if [[ -z "$UNGOVERNED" && -z "$ORPHANED" ]]; then
  RAW_COUNT=$(echo "$RAW_KEYS" | grep -c '^' || echo 0)
  print_success "RAW_VARS and ENV_SCHEMA in sync (${RAW_COUNT} vars, no drift)"
fi

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "env-governance audit FAILED — ${VIOLATIONS} violation(s) found"
  echo ""
  exit 1
fi

print_success "env-governance audit PASSED — env reads governed + RAW_VARS/ENV_SCHEMA in sync"
exit 0
