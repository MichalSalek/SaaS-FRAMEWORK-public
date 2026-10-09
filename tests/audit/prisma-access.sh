#!/usr/bin/env bash
# prisma-access.sh — Guard direct-Prisma consistency (BDX D1)
#
# INTENT:
#   Decision D1 (BDX FAZA 1, 2026-06-14): Direct-Prisma via DB_CLIENT.use/<useAppLogs>
#   is the deliberate, consistent data-access pattern. No repository layer.
#   This ratchet locks three invariants:
#
#   CHECK 1 — new PrismaClient() only in prisma.adapter.ts
#     Prevents ad-hoc client instantiation leaking into domain/application code,
#     which would bypass the singleton + adapter pattern (hot-reload safety, adapter
#     swap, connection pooling via PrismaPg adapter).
#
#   CHECK 2 — Prisma runtime client imported only from @app/db/db.client
#     Domain/application code must use DB_CLIENT (the singleton exported by db.client.ts),
#     not import PrismaClient or the generated client directly.
#     NOTE: `import type { Prisma }` from the generated client is allowed — it imports
#     the Prisma NAMESPACE (types like Prisma.TransactionClient, Prisma.JsonValue) with
#     zero runtime footprint. Only runtime (non-type) client imports are violations.
#
#   CHECK 3 — web-1/src/infrastructure/ must not exist
#     Locks decision D1: no repository/infrastructure layer. If this directory
#     appears, it signals unauthorized introduction of the rejected pattern.
#
# ALLOWLIST:
#   - prisma.adapter.ts — the only place that instantiates PrismaClient
#   - prisma/js-client/ and prisma-app-logs/js-client/ — generated client code
#   - *.d.ts — type declaration files (doc comments reference `new PrismaClient`)
#   - tests/audit/ — this script itself
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
WEB1_SRC="${ROOT}/web-1/src"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$WEB1_SRC" "źródeł web-1"

print_boxed_header "Prisma access: direct-Prisma consistency (D1)" "🗄️"

VIOLATIONS=0

# ─── CHECK 1: new PrismaClient() outside prisma.adapter.ts ───────────────────

print_header "Check 1: new PrismaClient() — only in prisma.adapter.ts"

CHECK1_VIOLATIONS=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"

  # Skip the adapter (the only legitimate place)
  [[ "$REL_PATH" == "web-1/src/application/db/adapters/prisma.adapter.ts" ]] && continue
  # Skip generated client directories (contain doc examples with new PrismaClient)
  [[ "$REL_PATH" == *"/prisma/js-client/"* ]] && continue
  [[ "$REL_PATH" == *"/prisma-app-logs/js-client/"* ]] && continue
  # Skip type declaration files
  [[ "$file" == *.d.ts ]] && continue
  # Skip audit scripts
  [[ "$REL_PATH" == "tests/audit/"* ]] && continue

  if grep -qP "new PrismaClient\(" "$file" 2>/dev/null; then
    LINES=$(grep -nP "new PrismaClient\(" "$file" | cut -d: -f1 | sort -u | tr '\n' ',' | sed 's/,$//')
    CHECK1_VIOLATIONS="${CHECK1_VIOLATIONS}${REL_PATH}:${LINES}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION (new PrismaClient) — ${REL_PATH} at line(s): ${LINES}"
    print_info  "  Fix: use DB_CLIENT from @app/db/db.client — do not instantiate PrismaClient directly"
  fi
done < <(find "${WEB1_SRC}" -type f -name "*.ts" -print0 \
  | grep -zv "node_modules")

if [[ -z "$CHECK1_VIOLATIONS" ]]; then
  print_success "No rogue new PrismaClient() instantiations found"
fi

print_separator

# ─── CHECK 2: runtime Prisma client import outside @app/db/db.client ─────────

print_header "Check 2: Runtime Prisma client import — only via @app/db/db.client"

# Pattern: import { PrismaClient... } or import { ..., PrismaClient, ... }
# from the generated js-client paths (NOT type-only imports).
# import type { Prisma } is ALLOWED (namespace types, no runtime).
# We target: non-type imports of PrismaClient class from generated paths.

CHECK2_VIOLATIONS=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"

  # The adapter is the legitimate consumer
  [[ "$REL_PATH" == "web-1/src/application/db/adapters/prisma.adapter.ts" ]] && continue
  # Skip generated client directories
  [[ "$REL_PATH" == *"/prisma/js-client/"* ]] && continue
  [[ "$REL_PATH" == *"/prisma-app-logs/js-client/"* ]] && continue
  # Skip type declaration files
  [[ "$file" == *.d.ts ]] && continue
  # Skip audit scripts
  [[ "$REL_PATH" == "tests/audit/"* ]] && continue

  # Detect runtime (non-type) import of PrismaClient from generated client paths.
  # Matches: import { PrismaClient... } from '...js-client'
  # Does NOT match: import type { ... } (pure type import — no runtime footprint)
  if grep -qP "^import\s+(?!type\s+)\{[^}]*PrismaClient[^}]*\}\s+from\s+['\"].*js-client['\"]" "$file" 2>/dev/null; then
    LINES=$(grep -nP "^import\s+(?!type\s+)\{[^}]*PrismaClient[^}]*\}\s+from\s+['\"].*js-client['\"]" "$file" | cut -d: -f1 | sort -u | tr '\n' ',' | sed 's/,$//')
    CHECK2_VIOLATIONS="${CHECK2_VIOLATIONS}${REL_PATH}:${LINES}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION (runtime Prisma import) — ${REL_PATH} at line(s): ${LINES}"
    print_info  "  Fix: use DB_CLIENT from @app/db/db.client instead of importing PrismaClient directly"
    print_info  "  NOTE: import type { Prisma } for namespace types is allowed"
  fi
done < <(find "${WEB1_SRC}" -type f -name "*.ts" -print0 \
  | grep -zv "node_modules")

if [[ -z "$CHECK2_VIOLATIONS" ]]; then
  print_success "No direct runtime PrismaClient imports found outside adapter"
fi

print_separator

# ─── CHECK 3: web-1/src/infrastructure/ must not exist ───────────────────────

print_header "Check 3: web-1/src/infrastructure/ must not exist (D1 lock)"

INFRA_DIR="${WEB1_SRC}/infrastructure"

if [[ -d "$INFRA_DIR" ]]; then
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "VIOLATION (infrastructure dir) — ${INFRA_DIR} exists"
  print_info  "  D1 decision: no repository/infrastructure layer. Remove the directory."
  print_info  "  Use DB_CLIENT.use.<model> directly in domain/operations/ instead."
else
  print_success "web-1/src/infrastructure/ does not exist — D1 intact"
fi

print_separator

# ─── Result ──────────────────────────────────────────────────────────────────

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "prisma-access audit FAILED — ${VIOLATIONS} violation(s) found"
  echo ""
  exit 1
fi

print_success "prisma-access audit PASSED — direct-Prisma pattern consistent (D1)"
exit 0
