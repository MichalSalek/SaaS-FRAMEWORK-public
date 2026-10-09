#!/usr/bin/env bash
# operation-io-suffix.sh — Enforce the `_IO` suffix on OperationResult-returning
# domain operations (BDX W3.1 ratchet — no re-drift of the IO-boundary naming).
#
# INTENT:
#   Project convention: a domain operation that performs IO and returns the
#   discriminated `OperationResult<...>` envelope carries the `_IO` suffix on its
#   export name (e.g. `createGalleryRecord_IO`, `claimPairingSession_IO`). The
#   suffix is a one-glance signal at every call site (handlers, sibling ops) that
#   "this is the IO front-door of the domain — it returns success()/failure(),
#   never throws domain errors". An OperationResult-returning export WITHOUT the
#   suffix is an inconsistency that erodes that signal.
#
# WHAT IT CHECKS (hard fail):
#   Every `export const NAME = async (...)` or `export async function NAME (...)`
#   under web-1/src/domain/**/operations/** whose RETURN-TYPE ANNOTATION mentions
#   `OperationResult` MUST end in `_IO`. The check inspects only the signature
#   region (declaration → body opener `=> {`), so an `OperationResult` referenced
#   inside a body or a comment does not trigger a false positive.
#
# ALLOWLIST — two categories (each entry "relative/path.ts::exportName"):
#   1. PENDING (later BDX rounds): operations in domains NOT yet migrated to the
#      `_IO` convention. W3.1 scope is pairing/ + salon-staff/ ONLY; the remaining
#      domains (gallery/admin/user/account) are renamed in their own rounds. As
#      each round lands, its entries are removed here. Target: this list → empty.
#   2. INTENTIONAL EXEMPTIONS: none currently. (cleanupExpiredTokens_IO in
#      pairing-cleanup.operations.ts returns `{ deleted: number }`, NOT
#      OperationResult, so it is not detected at all — W3.3 made it a cron-op
#      (`_IO` suffix for IO-boundary convention parity) and it needs no entry here.)
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SCAN_ROOT="${ROOT}/web-1/src/domain"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$SCAN_ROOT" "domeny web-1"

print_boxed_header "Operation _IO suffix: IO-boundary naming audit" "🔤"

# ─── PENDING allowlist (later BDX rounds — shrinks to empty) ──────────────────
# Format: "<path-relative-to-ROOT>::<exportName>"
#
# EMPTY — the `_IO` convention is now 100% enforced across all domains. W3.1
# renamed pairing/ + salon-staff/; W3.1b renamed the final 20 ops in
# gallery/admin/user/account (all genuine IO-operations: DB / Stripe / Cloudinary
# I/O returning OperationResult). Zero pending debt, zero intentional exemptions —
# every OperationResult-returning export under operations/** carries `_IO`.
ALLOWLIST=()

is_allowlisted() {
  local needle="$1"
  local entry
  # `${ALLOWLIST[@]+...}` guards an empty array under `set -u` (older bash).
  for entry in "${ALLOWLIST[@]+"${ALLOWLIST[@]}"}"; do
    [[ "$entry" == "$needle" ]] && return 0
  done
  return 1
}

if [[ ! -d "$SCAN_ROOT" ]]; then
  print_info "No web-1/src/domain directory — nothing to audit"
  exit 0
fi

print_header "OperationResult-returning exports must end in _IO"

VIOLATIONS=0
VIOLATION_LIST=""
STALE_ALLOWLIST=""

# Collect every operation file (TS, excluding tests).
declare -a OP_FILES
mapfile -t OP_FILES < <(
  find "$SCAN_ROOT" -type f -name '*.ts' -path '*/operations/*' \
    -not -name '*.test.ts' \
    -not -path '*/node_modules/*' \
    -print0 | tr '\0' '\n' | grep -v '^$'
)

# AWK extracts each export's name + whether its SIGNATURE (decl → body opener)
# mentions OperationResult. Emits one line per OperationResult-returning export:
#   <lineno>\t<name>
# Body opener `=> {` (arrow) or `) {`/`): T {` (function) terminates the signature
# window, so OperationResult uses inside a body/comment are never counted.
extract_io_exports() {
  awk '
    # Start of an export declaration.
    # NOTE: POSIX/gawk ERE has no \b word boundary (\b = backspace), so the
    # async terminator is matched with an explicit non-identifier / EOL class.
    /^[[:space:]]*export[[:space:]]+const[[:space:]]+[A-Za-z0-9_]+[[:space:]]*=[[:space:]]*async([^A-Za-z0-9_]|$)/ {
      match($0, /export[[:space:]]+const[[:space:]]+[A-Za-z0-9_]+/)
      s = substr($0, RSTART, RLENGTH)
      sub(/.*[[:space:]]/, "", s)
      capturing = 1; name = s; startline = NR; sig = $0; next
    }
    /^[[:space:]]*export[[:space:]]+async[[:space:]]+function[[:space:]]+[A-Za-z0-9_]+/ {
      match($0, /function[[:space:]]+[A-Za-z0-9_]+/)
      s = substr($0, RSTART, RLENGTH)
      sub(/function[[:space:]]+/, "", s)
      capturing = 1; name = s; startline = NR; sig = $0; next
    }
    capturing {
      sig = sig "\n" $0
      # Body opener ends the signature window.
      if ($0 ~ /=>[[:space:]]*\{/ || $0 ~ /\)[[:space:]]*(:[^{]*)?\{[[:space:]]*$/) {
        if (sig ~ /OperationResult/) {
          print startline "\t" name
        }
        capturing = 0; sig = ""
      }
      # Safety: never let a runaway capture span the whole file.
      else if (NR - startline > 40) { capturing = 0; sig = "" }
    }
  ' "$1"
}

# Track which allowlist entries are actually hit (to flag stale ones).
declare -A ALLOW_HIT

for f in "${OP_FILES[@]}"; do
  [[ -z "$f" ]] && continue
  REL_PATH="${f#${ROOT}/}"
  while IFS=$'\t' read -r lineno name; do
    [[ -z "$name" ]] && continue
    [[ "$name" == *_IO ]] && continue
    KEY="${REL_PATH}::${name}"
    if is_allowlisted "$KEY"; then
      ALLOW_HIT["$KEY"]=1
      continue
    fi
    VIOLATIONS=$((VIOLATIONS + 1))
    VIOLATION_LIST="${VIOLATION_LIST}  ${REL_PATH}:${lineno}  ${name} → ${name}_IO"$'\n'
  done < <(extract_io_exports "$f")
done

# Detect stale allowlist entries (listed but no longer a violation — e.g. renamed).
for entry in "${ALLOWLIST[@]+"${ALLOWLIST[@]}"}"; do
  if [[ -z "${ALLOW_HIT[$entry]:-}" ]]; then
    STALE_ALLOWLIST="${STALE_ALLOWLIST}  ${entry}"$'\n'
  fi
done

if [[ "$VIOLATIONS" -gt 0 ]]; then
  print_error "OperationResult-returning operations missing the _IO suffix:"
  echo "$VIOLATION_LIST"
  print_info "Rename with the project's ts-morph rename (declaration + all call-sites),"
  print_info "or — if intentionally out of this round's scope — add to the PENDING allowlist."
fi

if [[ -n "$STALE_ALLOWLIST" ]]; then
  print_warning "Stale PENDING allowlist entries (no longer a violation — remove them):"
  echo "$STALE_ALLOWLIST"
  # Stale entries are a hard fail: a renamed/removed op must not linger in the
  # allowlist, otherwise the ratchet silently rots.
  VIOLATIONS=$((VIOLATIONS + 1))
fi

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "operation-io-suffix audit FAILED"
  echo ""
  exit 1
fi

print_success "operation-io-suffix audit PASSED — all OperationResult ops carry _IO"
exit 0
