#!/usr/bin/env bash
# handler-shape.sh — Enforce the canonical API-route handler shape (BDX W2.x).
#
# INTENT:
#   After the W2.1–W2.4 handler convergence, every API route under
#   web-1/src/pages/api/v1 funnels through ONE of three sanctioned wrappers:
#     - defineHandler           (CQRS command/query handlers — the default)
#     - withPublicHandler /
#       withRawSecretHandler    (raw/internal/webhook handlers — W2.3)
#   plus a small, deliberate ALLOWLIST of multi-method / token-public routes that
#   call HTTPRequestHandlerMiddleware directly (auth allowlist, by design).
#
#   This ratchet freezes that convergence: it fails the moment a handler reaches
#   for the raw escape hatches (res.status, direct middleware) outside the
#   allowlist, re-introduces a local query-param parser (W2.4a centralised it),
#   or regresses an internal module back to `export default` (W2.4b: adapters use
#   named exports so the surface stays grep-able and tree-shakeable).
#
# CHECKS:
#   (a) raw `res.status(` in pages/api/v1/** outside the raw-handler allowlist.
#   (b) `HTTPRequestHandlerMiddleware` called directly in a v1 page handler
#       outside the token-public / multi-method allowlist (must use defineHandler).
#   (c) a local `parseQueryParams` definition in pages/api/** (use the shared
#       @app/http/parse-query-params helper instead — W2.4a).
#   (d) `export default` in web-1/src/** outside pages/** (+ excluded:
#       instrumentation.ts, middleware.ts, *.config.*, *.tsx, *.d.ts) — internal
#       modules must use named exports (catches the cloudinary-adapter regression).
#
# EXIT: 0 if PASS, 1 if any violation found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
V1_DIR="${ROOT}/web-1/src/pages/api/v1"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$V1_DIR" "handlerów API v1"
PAGES_DIR="${ROOT}/web-1/src/pages"
WEB1_SRC="${ROOT}/web-1/src"

print_boxed_header "Handler shape: API-route convergence ratchet" "🧩"

VIOLATIONS=0

# Path matcher: does $1 (a path relative to ROOT) start with any allowlist prefix?
# Usage: path_in_allowlist "$REL_PATH" "${ALLOWLIST[@]}"
path_in_allowlist() {
  local rel="$1"
  shift
  local prefix
  for prefix in "$@"; do
    if [[ "$rel" == "${prefix}"* ]]; then
      return 0
    fi
  done
  return 1
}

# ─── CHECK (a): raw res.status( in v1 outside raw-handler allowlist ──────────

print_header "Check (a): raw res.status( in pages/api/v1 (raw-handler allowlist only)"

# Routes that legitimately emit raw HTTP status codes (raw / multi-method).
# Relative to ROOT.
RES_STATUS_ALLOWLIST=(
  "web-1/src/pages/api/v1/internal/track-crawler/"
  "web-1/src/pages/api/v1/internal/health-public/"
  "web-1/src/pages/api/v1/internal/sweep-tick/"
  "web-1/src/pages/api/v1/webhooks/stripe/"
  "web-1/src/pages/api/v1/email/unsubscribe/"
  "web-1/src/pages/api/v1/public/newsletter-unsubscribe/"
  "web-1/src/pages/api/v1/public/newsletter-confirm/"
  "web-1/src/pages/api/v1/salon/staff/"
)

A_OK=1
if [[ -d "$V1_DIR" ]]; then
  while IFS= read -r -d $'\0' file; do
    REL_PATH="${file#${ROOT}/}"
    path_in_allowlist "$REL_PATH" "${RES_STATUS_ALLOWLIST[@]}" && continue
    if grep -qP "\bres\.status\(" "$file" 2>/dev/null; then
      LINES=$(grep -nP "\bres\.status\(" "$file" | cut -d: -f1 | tr '\n' ',' | sed 's/,$//')
      print_error "VIOLATION (a) — ${REL_PATH} at line(s): ${LINES}"
      print_info  "  Fix: use defineHandler + respond*() helpers, or add to RES_STATUS_ALLOWLIST if a deliberate raw handler"
      VIOLATIONS=$((VIOLATIONS + 1))
      A_OK=0
    fi
  done < <(find "$V1_DIR" -type f -name "*.ts" -print0 2>/dev/null)
fi
[[ "$A_OK" -eq 1 ]] && print_success "No raw res.status( outside the raw-handler allowlist"

print_separator

# ─── CHECK (b): direct HTTPRequestHandlerMiddleware in v1 outside allowlist ──

print_header "Check (b): direct HTTPRequestHandlerMiddleware in pages/api/v1 (allowlist only)"

# Token-public + multi-method routes that intentionally call the middleware
# directly (custom auth-skip allowlist). Relative to ROOT.
MIDDLEWARE_ALLOWLIST=(
  "web-1/src/pages/api/v1/email/unsubscribe/"
  "web-1/src/pages/api/v1/public/newsletter-unsubscribe/"
  "web-1/src/pages/api/v1/public/newsletter-confirm/"
  "web-1/src/pages/api/v1/salon/staff/"
)

B_OK=1
if [[ -d "$V1_DIR" ]]; then
  while IFS= read -r -d $'\0' file; do
    REL_PATH="${file#${ROOT}/}"
    path_in_allowlist "$REL_PATH" "${MIDDLEWARE_ALLOWLIST[@]}" && continue
    if grep -qP "\bHTTPRequestHandlerMiddleware\b" "$file" 2>/dev/null; then
      LINES=$(grep -nP "\bHTTPRequestHandlerMiddleware\b" "$file" | cut -d: -f1 | tr '\n' ',' | sed 's/,$//')
      print_error "VIOLATION (b) — ${REL_PATH} at line(s): ${LINES}"
      print_info  "  Fix: route through defineHandler (or add to MIDDLEWARE_ALLOWLIST if a deliberate auth-skip handler)"
      VIOLATIONS=$((VIOLATIONS + 1))
      B_OK=0
    fi
  done < <(find "$V1_DIR" -type f -name "*.ts" -print0 2>/dev/null)
fi
[[ "$B_OK" -eq 1 ]] && print_success "No direct HTTPRequestHandlerMiddleware outside the allowlist"

print_separator

# ─── CHECK (c): local parseQueryParams definition in pages/api/** ────────────

print_header "Check (c): local parseQueryParams definition in pages/api (use shared helper)"

C_OK=1
if [[ -d "$PAGES_DIR" ]]; then
  while IFS= read -r -d $'\0' file; do
    REL_PATH="${file#${ROOT}/}"
    # Match a local definition: `const parseQueryParams` or `function parseQueryParams`.
    if grep -qP "\b(const|function)\s+parseQueryParams\b" "$file" 2>/dev/null; then
      LINES=$(grep -nP "\b(const|function)\s+parseQueryParams\b" "$file" | cut -d: -f1 | tr '\n' ',' | sed 's/,$//')
      print_error "VIOLATION (c) — ${REL_PATH} at line(s): ${LINES}"
      print_info  "  Fix: import { parseQueryParams } from '@app/http/parse-query-params' and pass a declarative schema"
      VIOLATIONS=$((VIOLATIONS + 1))
      C_OK=0
    fi
  done < <(find "$PAGES_DIR" -type f -name "*.ts" -print0 2>/dev/null)
fi
[[ "$C_OK" -eq 1 ]] && print_success "No local parseQueryParams definitions in pages/api"

print_separator

# ─── CHECK (d): export default in web-1/src/** outside pages/** ──────────────

print_header "Check (d): export default in web-1/src outside pages (named exports only)"

D_OK=1
if [[ -d "$WEB1_SRC" ]]; then
  while IFS= read -r -d $'\0' file; do
    REL_PATH="${file#${ROOT}/}"

    # Scope: skip everything under pages/ (Next.js pages MUST default-export).
    [[ "$REL_PATH" == web-1/src/pages/* ]] && continue
    # Allowlisted file shapes (framework conventions / ambient declarations / React components).
    case "$REL_PATH" in
      *.tsx) continue ;;
      *.d.ts) continue ;;
      *.config.*) continue ;;
      */instrumentation.ts) continue ;;
      web-1/src/instrumentation.ts) continue ;;
      */middleware.ts) continue ;;
      web-1/src/middleware.ts) continue ;;
    esac

    # Match a real `export default` statement (line-anchored — skips JSDoc `* export default`).
    if grep -qP "^\s*export default\b" "$file" 2>/dev/null; then
      LINES=$(grep -nP "^\s*export default\b" "$file" | cut -d: -f1 | tr '\n' ',' | sed 's/,$//')
      print_error "VIOLATION (d) — ${REL_PATH} at line(s): ${LINES}"
      print_info  "  Fix: use a named export (export const / export { x }) for internal modules"
      VIOLATIONS=$((VIOLATIONS + 1))
      D_OK=0
    fi
  done < <(find "$WEB1_SRC" -type f -name "*.ts" -print0 2>/dev/null \
    | grep -zv "node_modules\|\.next\|/out/\|/dist/")
fi
[[ "$D_OK" -eq 1 ]] && print_success "No export default outside pages (internal modules use named exports)"

print_separator

# ─── Result ──────────────────────────────────────────────────────────────────

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "handler-shape audit FAILED — ${VIOLATIONS} violation(s) found"
  echo ""
  exit 1
fi

print_success "handler-shape audit PASSED — handlers converge on the canonical shape"
exit 0
