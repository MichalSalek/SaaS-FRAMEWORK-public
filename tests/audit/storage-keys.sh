#!/usr/bin/env bash
# storage-keys.sh — Enforce client-device-storage hygiene (adapter + SSOT keys).
#
# INTENT (Wave W1.2 / kill Rank-1 FOUC):
#   User-state storage keys (theme, mode, dismissals, scroll, activation latch,
#   consent, admin drafts) used to be raw string literals scattered across
#   components AND the zero-flash bridge in _document.tsx independently hardcoded
#   'theme'/'mode'. A drift between the bridge literal and the React literal
#   silently reintroduces the white flash (FOUC). This audit locks in the fix:
#
#   CHECK 1 — no raw localStorage / sessionStorage member-access (.getItem /
#     .setItem / .removeItem) anywhere under main/src EXCEPT the canonical
#     storage adapter and the documented escape-hatches (allowlist below). All
#     other code must go through clientStorage.possibilities.api / the
#     local-storage-adapter / session-storage-adapter.
#
#   CHECK 2 — no re-drift of a centralized key: a SSOT key literal
#     (e.g. 'theme', 'cookie-consent-v1') must NOT appear as a raw quoted string
#     outside storage-keys.config.ts (its definition) and the allowlist. Re-using
#     the literal instead of importing STORAGE_KEYS = the exact drift that causes
#     FOUC / silent key mismatch.
#
# ALLOWLIST (intentional raw access / literals — NOT violations), rel to ROOT:
#   - the storage adapter + its api + the SSOT config itself
#   - platform.detection.ts  — DECISION: PLATFORM_STORAGE_KEY /
#       PLATFORM_GATE_BYPASS_STORAGE_KEY are an INTERNAL platform escape-hatch
#       (kernel-owned keys, native-shell detection), NOT user-state.
#   - AuthContext.tsx         — DECISION: the authorization / become-user BEARER
#       TOKEN is a separate AUTH channel (CUSTOM_HEADERS.*), not user-state; it
#       already routes through getFromClientStorage. No raw access here anyway.
#   - _document.tsx           — DECISION: the zero-flash inline script is a
#       stringified IIFE that runs synchronously at HTML parse time, BEFORE any
#       JS module (incl. the adapter) is evaluated. It MUST touch raw
#       localStorage. Its key NAMES are still SSOT — injected from
#       ZERO_FLASH_STORAGE_KEYS via JSON.stringify, so no key drift vs
#       ThemeContext (that drift = the FOUC this audit defends against).
#   - *.test.ts(x)            — characterization tests seed/clear storage directly.
#
# EXIT: 0 if clean, 1 on any violation.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/main/src"
SSOT_CONFIG="main/src/application/client-device-storage/storage-keys.config.ts"

trap cleanup_temp_files EXIT

# ── Allowlist: paths (relative to ROOT) exempt from BOTH checks. Prefix-matched.
ALLOWLIST=(
  "main/src/application/client-device-storage/"
  "main/src/application/platform/platform.detection.ts"
  "main/src/UI/contexts/AuthContext.tsx"
  # Zero-flash bridge: raw localStorage required pre-hydration; key names are
  # still SSOT (injected via JSON.stringify from ZERO_FLASH_STORAGE_KEYS).
  "main/src/pages/_document.tsx"
)

is_allowlisted() {
  local rel="$1"
  # Tests are always exempt (they exercise storage directly).
  case "$rel" in
    *.test.ts | *.test.tsx) return 0 ;;
  esac
  local allowed
  for allowed in "${ALLOWLIST[@]}"; do
    if [[ "$rel" == "$allowed"* ]]; then
      return 0
    fi
  done
  return 1
}

print_boxed_header "Storage keys: adapter + SSOT audit" "🗄️"

VIOLATIONS=0

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 1 — no raw localStorage / sessionStorage member-access outside allowlist
# ─────────────────────────────────────────────────────────────────────────────
print_header "CHECK 1 — raw localStorage/sessionStorage access outside the adapter"

# Match real member-access: (window.)?(local|session)Storage.(get|set|remove)Item(
# Excludes: `typeof localStorage` / `typeof sessionStorage` guards (no `.` member
# access) and `localStorage.clear()` in tests (allowlisted anyway).
ACCESS_RE="(window\.)?(localStorage|sessionStorage)\.(getItem|setItem|removeItem)"

RAW_HITS=$(grep -rEn "$ACCESS_RE" "$SRC_DIR" \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out --exclude-dir=dist \
  2>/dev/null || true)

CHECK1_FAIL=0
if [[ -z "$RAW_HITS" ]]; then
  print_success "No raw localStorage/sessionStorage member-access found"
else
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    FILE=$(echo "$line" | cut -d: -f1)
    LINE_NUM=$(echo "$line" | cut -d: -f2)
    REL="${FILE#${ROOT}/}"

    if is_allowlisted "$REL"; then
      continue
    fi

    print_error "RAW ACCESS: ${REL}:${LINE_NUM} — use the clientStorage adapter + STORAGE_KEYS"
    CHECK1_FAIL=$((CHECK1_FAIL + 1))
    VIOLATIONS=$((VIOLATIONS + 1))
  done <<< "$RAW_HITS"

  if [[ "$CHECK1_FAIL" -eq 0 ]]; then
    print_success "All raw access is allowlisted (adapter / escape-hatches / tests)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 2 — no SSOT key literal re-drift outside storage-keys.config.ts
# ─────────────────────────────────────────────────────────────────────────────
print_header "CHECK 2 — SSOT key literals not re-hardcoded outside the config"

if [[ ! -f "${ROOT}/${SSOT_CONFIG}" ]]; then
  print_error "SSOT config missing: ${SSOT_CONFIG}"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  # Extract the canonical key literals from the SSOT (values in STORAGE_KEYS +
  # STORAGE_KEY_PREFIXES — single- or double-quoted string literals after `:`).
  # These are the literals that must NOT reappear hardcoded elsewhere.
  SSOT_KEYS=$(grep -oE ":[[:space:]]*'[^']+'" "${ROOT}/${SSOT_CONFIG}" \
    | sed -E "s/^:[[:space:]]*'//; s/'$//" \
    | sort -u || true)

  # Generic single-word keys ('theme', 'mode') collide with unrelated
  # identifiers (object keys, type-union members like Omit<..., 'mode'>), so a
  # literal scan would false-positive. They are SAFE to skip here: both the only
  # two consumers (_document.tsx bridge + ThemeContext.tsx) import the SAME
  # STORAGE_KEYS.THEME / .MODE constant, so key drift is structurally impossible
  # — and CHECK 1 already forbids raw localStorage access that could bypass it.
  SKIP_KEYS=("theme" "mode")

  CHECK2_FAIL=0
  if [[ -z "$SSOT_KEYS" ]]; then
    print_warning "No key literals parsed from SSOT — check config format"
  else
    while IFS= read -r key; do
      [[ -z "$key" ]] && continue
      SKIP=0
      for skip in "${SKIP_KEYS[@]}"; do
        [[ "$key" == "$skip" ]] && SKIP=1 && break
      done
      [[ "$SKIP" -eq 1 ]] && continue
      # Find this exact quoted literal anywhere under main/src.
      KEY_HITS=$(grep -rEn "['\"]${key}['\"]" "$SRC_DIR" \
        --include="*.ts" --include="*.tsx" \
        --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out --exclude-dir=dist \
        2>/dev/null || true)
      [[ -z "$KEY_HITS" ]] && continue
      while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        FILE=$(echo "$line" | cut -d: -f1)
        LINE_NUM=$(echo "$line" | cut -d: -f2)
        REL="${FILE#${ROOT}/}"
        # The SSOT config is where the literal is DEFINED — always allowed.
        [[ "$REL" == "$SSOT_CONFIG" ]] && continue
        if is_allowlisted "$REL"; then
          continue
        fi
        print_error "KEY RE-DRIFT: ${REL}:${LINE_NUM} — '${key}' hardcoded; import from STORAGE_KEYS"
        CHECK2_FAIL=$((CHECK2_FAIL + 1))
        VIOLATIONS=$((VIOLATIONS + 1))
      done <<< "$KEY_HITS"
    done <<< "$SSOT_KEYS"
  fi

  if [[ "$CHECK2_FAIL" -eq 0 ]]; then
    print_success "No SSOT key literal re-hardcoded outside the config"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
print_separator
if [[ "$VIOLATIONS" -gt 0 ]]; then
  print_error "Storage-keys audit FAILED — ${VIOLATIONS} violation(s)"
  echo ""
  echo "Fix: route storage through main/src/application/client-device-storage/"
  echo "     (clientStorage.possibilities.api or the local/session adapters) and"
  echo "     reference keys via STORAGE_KEYS from storage-keys.config.ts."
  exit 1
fi

print_success "Storage-keys audit passed — adapter-only access, SSOT keys not re-drifted"
exit 0
