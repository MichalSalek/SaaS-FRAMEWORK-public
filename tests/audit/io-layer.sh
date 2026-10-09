#!/usr/bin/env bash
# io-layer.sh — Enforce the FDX FAZA 2 promise-first IO front-door (no re-drift).
#
# INTENT:
#   After FDX FAZA 2 there is exactly ONE public way to declare a backend call:
#   `defineEndpoint` / `defineQuery` / `definePathEndpoint` from
#   `main/src/application/http/io.ts` (promise-first — request in → Promise<Res>
#   out, NO `toPromise` wrapper at the call site). The old `createIOFunction`
#   family is DELETED. The data layer also lives in `domain/**` / `application/**`,
#   never in `UI/**`. This audit fails on any regression of those three rules.
#
# RULES (each a hard fail):
#   1. createIOFunction / createEndpointIO / createQueryIOFunction /
#      createPathParamIOFunction used ANYWHERE in main/src (factories are gone).
#   2. A `toPromise(` CALL site in UI/** or domain/** outside the allowlist. The
#      promise-first front-door already absorbs `toPromise` internally; only the
#      load-bearing raw-callback IO exceptions (becomeUser / switchBackUser, which
#      keep a precisely-ordered successCallback — see their DECISION comments) may
#      still wrap with `toPromise` at the hook.
#   3. `ENDPOINTS` or `createIOFunction` imported directly in UI/** — transport
#      belongs to the domain/application layer, never the view layer. A UI file
#      reaching for ENDPOINTS means it is hand-rolling IO instead of importing a
#      domain `_IO` function.
#
# ALLOWLIST for rule 2 (`toPromise(` call sites that are intentional):
#   - main/src/application/http/io.ts           — the front-door defines it here
#   - main/src/application/http/toPromise.adapter.ts — the adapter itself
#   - main/src/UI/features/admin/hooks/useBecomeUser.ts        — raw-callback IO exception
#   - main/src/UI/features/admin/hooks/useSwitchBackBecomeUser.ts — raw-callback IO exception
#
# EXIT: 0 if no violations, 1 if any found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/main/src"
UI_DIR="${SRC_DIR}/UI"
DOMAIN_DIR="${SRC_DIR}/domain"

print_boxed_header "IO layer: promise-first front-door audit" "🔌"

VIOLATIONS=0

# Source files to scan (TS/TSX), excluding generated kernel + test snapshots.
declare -a SRC_FILES
mapfile -t SRC_FILES < <(
  find "$SRC_DIR" \
    \( -name '*.ts' -o -name '*.tsx' \) -type f \
    -not -path '*/node_modules/*' \
    -print0 | tr '\0' '\n' | grep -v '^$'
)

if [[ ${#SRC_FILES[@]} -eq 0 ]]; then
  print_info "No TS/TSX files found in main/src — nothing to audit"
  exit 0
fi

rel() { echo "${1#${ROOT}/}"; }

# ─── Rule 1: deprecated IO factories must not be used anywhere ───
print_header "Rule 1 — deprecated createX IO factories (must be 0 uses)"

FACTORY_RE='\bcreate(IOFunction|EndpointIO|QueryIOFunction|PathParamIOFunction)\b'
FACTORY_HITS=""

for f in "${SRC_FILES[@]}"; do
  [[ -z "$f" ]] && continue
  # Match the identifier only outside comment lines (skip lines starting with // or *).
  while IFS=: read -r lineno content; do
    [[ -z "$lineno" ]] && continue
    trimmed="$(echo "$content" | sed 's/^[[:space:]]*//')"
    case "$trimmed" in
      //* | \** ) continue ;;  # comment line — ignore (DECISION / doc references)
    esac
    FACTORY_HITS="${FACTORY_HITS}$(rel "$f"):${lineno}: ${trimmed}"$'\n'
  done < <(grep -nE "$FACTORY_RE" "$f" 2>/dev/null || true)
done

if [[ -n "$FACTORY_HITS" ]]; then
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "Deprecated IO factory used — migrate to defineEndpoint/defineQuery/definePathEndpoint (io.ts):"
  echo "$FACTORY_HITS"
else
  print_success "no createX IO factory usage (front-door only)"
fi

# ─── Rule 2: toPromise() call sites in UI/domain only on allowlist ───
print_header "Rule 2 — toPromise() call sites in UI/domain (allowlist only)"

TOPROMISE_ALLOW=(
  "main/src/application/http/io.ts"
  "main/src/application/http/toPromise.adapter.ts"
  "main/src/UI/features/admin/hooks/useBecomeUser.ts"
  "main/src/UI/features/admin/hooks/useSwitchBackBecomeUser.ts"
)

TOPROMISE_HITS=""
declare -a SCAN_FILES
mapfile -t SCAN_FILES < <(
  find "$UI_DIR" "$DOMAIN_DIR" \
    \( -name '*.ts' -o -name '*.tsx' \) -type f \
    -print0 | tr '\0' '\n' | grep -v '^$'
)

for f in "${SCAN_FILES[@]}"; do
  [[ -z "$f" ]] && continue
  REL_PATH="$(rel "$f")"

  ALLOWED=0
  for allowed in "${TOPROMISE_ALLOW[@]}"; do
    if [[ "$REL_PATH" == "$allowed" ]]; then
      ALLOWED=1
      break
    fi
  done
  [[ "$ALLOWED" -eq 1 ]] && continue

  # `toPromise(` = a CALL. Imports (`import { toPromise }`) and type-imports
  # (`import type { IOError } from './toPromise.adapter'`) do not match `toPromise(`.
  if grep -qE '\btoPromise\(' "$f" 2>/dev/null; then
    LINES=$(grep -nE '\btoPromise\(' "$f" | cut -d: -f1 | tr '\n' ',' | sed 's/,$//')
    TOPROMISE_HITS="${TOPROMISE_HITS}${REL_PATH}:${LINES}"$'\n'
  fi
done

if [[ -n "$TOPROMISE_HITS" ]]; then
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "toPromise() call site outside allowlist — use the promise-first IO directly (drop the wrapper):"
  echo "$TOPROMISE_HITS"
else
  print_success "no toPromise() call sites in UI/domain outside allowlist"
fi

# ─── Rule 3: UI must not import ENDPOINTS / createIOFunction directly ───
print_header "Rule 3 — UI/** must not import ENDPOINTS or createIOFunction (IO belongs to domain/application)"

UI_IMPORT_RE='import[^;]*(\bENDPOINTS\b|createIOFunction)'
UI_IMPORT_HITS=""
declare -a UI_FILES
mapfile -t UI_FILES < <(
  find "$UI_DIR" \( -name '*.ts' -o -name '*.tsx' \) -type f \
    -print0 | tr '\0' '\n' | grep -v '^$'
)

for f in "${UI_FILES[@]}"; do
  [[ -z "$f" ]] && continue
  if grep -qE "$UI_IMPORT_RE" "$f" 2>/dev/null; then
    LINES=$(grep -nE "$UI_IMPORT_RE" "$f" | cut -d: -f1 | tr '\n' ',' | sed 's/,$//')
    UI_IMPORT_HITS="${UI_IMPORT_HITS}$(rel "$f"):${LINES}"$'\n'
  fi
done

if [[ -n "$UI_IMPORT_HITS" ]]; then
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "UI imports transport primitive directly — move the IO into domain/** and import the _IO function:"
  echo "$UI_IMPORT_HITS"
else
  print_success "no ENDPOINTS / createIOFunction imports in UI/**"
fi

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "IO layer audit FAILED — ${VIOLATIONS} rule(s) violated"
  echo ""
  echo "Front-door: declare backend calls with defineEndpoint / defineQuery /"
  echo "definePathEndpoint from main/src/application/http/io.ts (promise-first)."
  exit 1
fi

print_success "IO layer audit passed — promise-first front-door intact, no createX, no stray toPromise/ENDPOINTS"
exit 0
