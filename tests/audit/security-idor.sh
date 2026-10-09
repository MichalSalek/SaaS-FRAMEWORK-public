#!/bin/bash
# security-idor.sh — Detect IDOR-prone ...body spread in API handlers.
# Anti-pattern: { session_field, ...body } (body LAST overrides session).
# Safe pattern:  { ...body, session_field } (session LAST overrides body).
# No session field near ...body → FAIL (no session protection at all).
set -e
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
HANDLERS_DIR="${ROOT}/web-1/src/pages/api"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$HANDLERS_DIR" "handlerów API"

# ── Allowlist: files where ...body without a nearby session field is intentional
# (e.g. public endpoints, admin-only internal routes). Paths relative to ROOT.
IDOR_ALLOWLIST=(
  # example: "web-1/src/pages/api/v1/public/some-endpoint/index.ts"
)

# ── Session-derived field pattern (grep extended regex).
# These are fields that MUST come from currentUser / accountCheck / session,
# never from the request body.
SESSION_FIELD_RE='account_id|created_by_account_id|created_by_user_id|user_id|requesting_account_id|issued_by_user_id|current_user_id|current_stylist_account_id|stylist_account_id'

print_boxed_header "Security: IDOR body-spread audit"

HITS=$(grep -rn '\.\.\.body' "${HANDLERS_DIR}" --include="*.ts" 2>/dev/null || true)

if [[ -z "$HITS" ]]; then
  print_success "No ...body spread found in API handlers"
  exit 0
fi

FAIL=0

while IFS= read -r line; do
  FILE=$(echo "$line" | cut -d: -f1)
  LINE_NUM=$(echo "$line" | cut -d: -f2)
  REL=$(echo "$FILE" | sed "s|${ROOT}/||")

  # ── Check allowlist
  ALLOWED=0
  for allowed_path in "${IDOR_ALLOWLIST[@]}"; do
    if [[ "$REL" == "$allowed_path" ]]; then
      ALLOWED=1
      break
    fi
  done
  if [[ "$ALLOWED" -eq 1 ]]; then
    print_success "${REL}:${LINE_NUM} — ...body spread (allowlisted, skipped)"
    continue
  fi

  # Look at lines AFTER ...body (within 5 lines) for session-derived fields.
  # If a session field appears after ...body in the same object literal,
  # the session value overrides body — SAFE.
  AFTER_WINDOW=$(sed -n "$((LINE_NUM + 1)),$((LINE_NUM + 5))p" "$FILE" | grep -v '^\s*//')
  SESSION_AFTER=$(echo "$AFTER_WINDOW" | grep -cE "${SESSION_FIELD_RE}" || true)

  if [[ "$SESSION_AFTER" -gt 0 ]]; then
    print_success "${REL}:${LINE_NUM} — ...body spread BEFORE session field (safe)"
  else
    # Check if session field appears BEFORE ...body (within 5 lines) — UNSAFE
    BEFORE_WINDOW=$(sed -n "$((LINE_NUM > 5 ? LINE_NUM - 5 : 1)),$((LINE_NUM - 1))p" "$FILE" | grep -v '^\s*//')
    SESSION_BEFORE=$(echo "$BEFORE_WINDOW" | grep -cE "${SESSION_FIELD_RE}" || true)

    if [[ "$SESSION_BEFORE" -gt 0 ]]; then
      print_error "IDOR RISK: ${REL}:${LINE_NUM} — ...body spread AFTER session field (body overrides session)"
      FAIL=1
    else
      print_error "IDOR RISK: ${REL}:${LINE_NUM} — ...body spread with NO session field nearby (no session protection)"
      FAIL=1
    fi
  fi
done <<< "$HITS"

if [[ $FAIL -eq 1 ]]; then
  print_error "IDOR audit FAILED — body spread overrides or lacks session-derived fields"
  exit 1
fi

print_success "IDOR audit passed — all body spreads are safe"
exit 0
