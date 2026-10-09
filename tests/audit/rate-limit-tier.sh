#!/usr/bin/env bash
# rate-limit-tier.sh — Guard: new sensitive endpoints must opt into STRICT rate limiting.
#
# INTENT (BDX W1.4):
#   Sensitive operations (auth/login, account deletion, recovery, pairing,
#   email-change, data export) are abuse + brute-force surfaces. They MUST sit in
#   RATE_LIMIT_CONFIG.STRICT_ENDPOINTS (5 req/s) rather than the default tier
#   (10 req/s). This ratchet fires when a NEW handler whose primary `eventName`
#   names one of those operations is added WITHOUT being covered by a STRICT prefix
#   — so a freshly-added login/delete/export endpoint can't silently ship at the
#   loose default tier.
#
# WHAT IT CHECKS:
#   For every handler under web-1/src/pages/api/** whose handler-level `eventName`
#   matches SENSITIVE_KEYWORDS, derive its route from the file path and verify the
#   route is covered by a STRICT_ENDPOINTS prefix (resolved from the SSOT:
#   rateLimit.middleware.ts STRICT_ENDPOINTS + routing.config.ts ROUTES_API).
#
# BASELINE ALLOWLIST:
#   The current tree already has sensitive-named handlers that are intentionally
#   NOT STRICT — admin-RBAC-gated mutations (delete-color/trait/policy, purge,
#   user-delete-any), already-authenticated pairing management (revoke/get), and
#   authenticated session-delete. These are the GREEN baseline: listed below so the
#   audit passes today and only catches NEWLY-added sensitive endpoints. To add a
#   new sensitive endpoint: either add its route to STRICT_ENDPOINTS (preferred for
#   public/unauthenticated surfaces) OR, if it is RBAC/auth-gated and STRICT is
#   unnecessary, add its path here with a one-line justification.
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
WEB1_SRC="${ROOT}/web-1/src"
ROUTING="${WEB1_SRC}/READONLY-shared-kernel/domain/routing/routing.config.ts"
RL="${WEB1_SRC}/application/http/rate-limit.middleware.ts"
API_VER="/api/v1/"

print_boxed_header "Rate-limit tier: sensitive endpoints → STRICT" "🚦"

# Sensitive operation keywords (matched against the handler-level eventName).
SENSITIVE_KEYWORDS="LOGIN|DELETE|RECOVER|PAIRING|EMAIL_CHANGE|EXPORT"

# ── Baseline allowlist (relative to ROOT) — exact handler file paths that are ──
# sensitive-by-name but intentionally NOT STRICT (RBAC/auth-gated). GREEN baseline.
BASELINE_ALLOWLIST=(
  # Admin-RBAC-gated mutations — admin role gate is the primary control.
  "web-1/src/pages/api/v1/admin/announcements/delete/index.ts"
  "web-1/src/pages/api/v1/admin/delete-color/index.ts"
  "web-1/src/pages/api/v1/admin/delete-policy/index.ts"
  "web-1/src/pages/api/v1/admin/delete-trait/index.ts"
  "web-1/src/pages/api/v1/admin/deleted-user/purge/index.ts"
  "web-1/src/pages/api/v1/admin/user/delete/any/index.ts"
  # Authenticated owner-scoped gallery mutations.
  "web-1/src/pages/api/v1/gallery/delete-asset-from-vendor/index.ts"
  "web-1/src/pages/api/v1/gallery/delete-record/index.ts"
  # Authenticated pairing management (read + revoke) — session-gated.
  "web-1/src/pages/api/v1/pairing/get-access-status/index.ts"
  "web-1/src/pages/api/v1/pairing/get-my-pairs/index.ts"
  "web-1/src/pages/api/v1/pairing/revoke-access/index.ts"
  "web-1/src/pages/api/v1/pairing/revoke-all-sessions/index.ts"
  "web-1/src/pages/api/v1/pairing/revoke-session/index.ts"
  # Authenticated session-delete (self sessions) — session-gated.
  "web-1/src/pages/api/v1/session/delete/all/index.ts"
  "web-1/src/pages/api/v1/session/delete/exactly/index.ts"
  # Authenticated self-delete REQUEST (the public token CONFIRM side IS strict).
  "web-1/src/pages/api/v1/user/delete/self/index.ts"
)

is_baseline_allowlisted() {
  local rel="$1"
  for allowed in "${BASELINE_ALLOWLIST[@]}"; do
    [[ "$rel" == "$allowed" ]] && return 0
  done
  return 1
}

# ── Resolve STRICT_ENDPOINTS to literal URL prefixes ──────────────────────────
STRICT_PREFIXES_FILE="$(mktemp)"
trap 'rm -f "$STRICT_PREFIXES_FILE"' EXIT

# Extract the STRICT_ENDPOINTS array block, then each token (ROUTES_API.X[.split..]
# or a bare '/literal'), and resolve ROUTES_API.X against the ROUTES_API object.
awk '/STRICT_ENDPOINTS:/{f=1} f{print} /\] as string\[\]/{if(f)exit}' "$RL" \
  | grep -oP "(ROUTES_API\.[A-Z_]+(\.split\([^)]*\)\[0\])?|'/[^']+')" \
  | while IFS= read -r tok; do
      if [[ "$tok" == ROUTES_API.* ]]; then
        name=$(grep -oP "ROUTES_API\.\K[A-Z_]+" <<<"$tok")
        # Resolve within the ROUTES_API object only (lines 95-302 boundary marked
        # by `export const ROUTES_API = Object.freeze({` ... `} as const);`).
        val=$(awk '/export const ROUTES_API/{f=1} f' "$ROUTING" \
          | grep -oP "^\s*${name}:\s*\`\K[^\`]+" | head -1)
        val="${val//\$\{API_VER\}/$API_VER}"
        if grep -q "split" <<<"$tok"; then
          val="${val%%\[token\]*}"
        fi
        [[ -n "$val" ]] && echo "$val" >> "$STRICT_PREFIXES_FILE"
      else
        echo "${tok//\'/}" >> "$STRICT_PREFIXES_FILE"
      fi
    done

STRICT_COUNT=$(sort -u "$STRICT_PREFIXES_FILE" | grep -c . || true)
print_info "Resolved ${STRICT_COUNT} STRICT_ENDPOINTS prefix(es) from SSOT"

is_strict_covered() {
  local url="$1"
  local pfx
  while IFS= read -r pfx; do
    [[ -z "$pfx" ]] && continue
    [[ "$url" == "$pfx"* ]] && return 0
  done < <(sort -u "$STRICT_PREFIXES_FILE")
  return 1
}

print_header "Sensitive handlers must be STRICT (or baseline-allowlisted)"

VIOLATIONS=0

while IFS= read -r f; do
  rel="${f#${ROOT}/}"

  # Handler-level eventName = first APP_EVENTS reference in the file.
  # `|| true`: grep exits non-zero when a handler has no eventName (e.g. the Better
  # Auth catch-all) — under `set -o pipefail` that would abort the loop.
  ev=$( (grep -oP "eventName:\s*APP_EVENTS\.\K[A-Z_.]+" "$f" || true) | head -1)
  [[ -z "$ev" ]] && continue
  grep -qE "$SENSITIVE_KEYWORDS" <<<"$ev" || continue

  # Derive route from the file path.
  url=$(echo "$rel" \
    | sed -E 's#^web-1/src/pages(/api/.*)/index\.ts$#\1#; s#^web-1/src/pages(/api/.*)\.ts$#\1#')

  is_strict_covered "$url" && continue
  is_baseline_allowlisted "$rel" && continue

  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "VIOLATION — ${rel}"
  print_info  "  route ${url} · eventName ${ev} is sensitive but NOT in STRICT_ENDPOINTS"
  print_info  "  Fix: add the route to RATE_LIMIT_CONFIG.STRICT_ENDPOINTS (rate-limit.middleware.ts),"
  print_info  "       or (if RBAC/auth-gated) baseline-allowlist it in rate-limit-tier.sh with a reason."

done < <(find "$WEB1_SRC/pages/api" -type f -name "*.ts" 2>/dev/null | sort)

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "rate-limit-tier audit FAILED — ${VIOLATIONS} sensitive endpoint(s) not STRICT"
  echo ""
  exit 1
fi

print_success "rate-limit-tier audit PASSED — all sensitive endpoints are STRICT or baselined"
exit 0
