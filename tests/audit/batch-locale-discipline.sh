#!/usr/bin/env bash
# batch-locale-discipline.sh — Guard: e-mail lifecycle locale resolution goes through the
# canonical `batchResolveLocales` helper, never a hand-rolled inline
# `eventLog.findMany({ ..., distinct: ['created_by_user_id'] })` block.
#
# INTENT:
#   turbo-review found the SAME inline locale-batch query (the Prisma take-before-distinct
#   trap, NO-take, distinct created_by_user_id, language select) re-implemented in 3 separate
#   e-mail ops (renewal-reminder / winback-deletion / onboarding-abandonment) while a canonical
#   `batchResolveLocales` helper already existed (trial-emails already used it). All three were
#   consolidated onto the helper. This ratchet keeps locale resolution single-sourced so the
#   take/distinct pitfall + fail-open semantics live in ONE place and a 4th inline copy cannot
#   silently drift back in.
#
# WHAT IT CHECKS (hard fail):
#   Any `distinct: ['created_by_user_id']` (the inline locale-batch query shape) in
#   web-1/src/domain/email or web-1/src/application/email-handler, OUTSIDE the canonical
#   `email-locale-batch.resolver.ts`. Comments are stripped first so a historical mention
#   in prose cannot false-match.
#
# EXIT: 0 PASS (only the helper carries the query), 1 if an inline copy reappeared.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
HELPER="email-locale-batch.resolver.ts"
SCAN_DIRS=("${ROOT}/web-1/src/domain/email" "${ROOT}/web-1/src/application/email-handler")
PATTERN="distinct:[[:space:]]*\[[[:space:]]*['\"]created_by_user_id['\"]"

print_boxed_header "Batch-locale: locale resolution via batchResolveLocales (no inline distinct)" "🌐"

VIOLATIONS=""
for dir in "${SCAN_DIRS[@]}"; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ "$f" == *"$HELPER" ]] && continue
    [[ "$f" == *.test.ts ]] && continue
    [[ "$f" == *"/READONLY-shared-kernel/"* ]] && continue
    # Strip block then line comments before matching (prose history mentions 'distinct').
    if sed '/\/\*/,/\*\//d' "$f" | sed 's|//.*$||g' | grep -qE "$PATTERN"; then
      VIOLATIONS="${VIOLATIONS}\n  ${f#"$ROOT"/}"
    fi
  done < <(grep -rlE "$PATTERN" "$dir" --include='*.ts' 2>/dev/null || true)
done

print_separator
if [[ -n "$VIOLATIONS" ]]; then
  echo ""
  print_error "batch-locale-discipline FAILED — inline locale-batch (distinct created_by_user_id) poza helperem:"
  echo -e "$VIOLATIONS" | while IFS= read -r l; do
    [[ -z "$l" ]] && continue
    print_error "  ${l}"
  done
  print_error "  FIX: użyj batchResolveLocales(userIds) z @app/email-handler/lifecycle/email-locale-batch.resolver"
  exit 1
fi
print_success "batch-locale-discipline PASSED — locale resolution centralizuje się w batchResolveLocales"
exit 0
