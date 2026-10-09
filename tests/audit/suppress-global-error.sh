#!/usr/bin/env bash
# suppress-global-error.sh — Guard: every useMutation with a custom onError
# that calls pushNewSnackbar MUST declare `meta: { suppressGlobalError: true }`.
#
# INTENT:
#   MutationCache.onError in queryClient.config.ts is a global fallback that
#   fires a generic snackbar for any failed mutation that does NOT have
#   `meta.suppressGlobalError === true`. A hook that also calls pushNewSnackbar
#   in its own onError (or per-call mutate() onError) MUST suppress the global
#   handler — otherwise the user sees TWO snackbars: the custom one AND the
#   generic fallback. See DD-M3 in queryClient.config.ts.
#
# DETECTION STRATEGY:
#   A file is flagged when ALL of the following are true:
#     1. It contains `useMutation(`
#     2. It contains `onError` (in the mutation config or per-call options)
#     3. It contains `pushNewSnackbar`
#     4. It does NOT contain `suppressGlobalError`
#
#   This covers both patterns:
#     (a) hook-level onError with pushNewSnackbar (meta must be in the hook)
#     (b) page/component file that calls mutate(..., { onError: () => pushNewSnackbar(...) })
#         — the hook file must still declare meta; page files in COMPONENT_ALLOWLIST
#           are excluded if their corresponding hook already carries the meta
#
# ALLOWLIST — files that own per-call onError + pushNewSnackbar but whose
# companion hook already has suppressGlobalError in the hook file:
#   These are UI page/component files (NOT hooks) that use mutate(..., {onError}).
#   The hook they call already carries `meta: { suppressGlobalError: true }`.
#   Listing here keeps the audit focused on HOOKS; page files are secondary callers.
#
# EXIT: 0 = PASS (no violations), 1 = FAIL (violations found)

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
UI_DIR="${ROOT}/main/src/UI"

# ---------------------------------------------------------------------------
# ALLOWLIST: page / component files where pushNewSnackbar appears in per-call
# mutate() options. Their hook counterpart already carries suppressGlobalError.
# Add new entries here with a short comment explaining why they are allowed.
# ---------------------------------------------------------------------------
ALLOWLIST=(
  # DeleteSelfPage calls mutate({onError: pushNewSnackbar}) — useDeleteSelf hook carries meta.
  "main/src/UI/features/auth/DeleteSelfPage.composition.tsx"
  # AdminNotesPage: per-call onError for useSaveNote + useSetMainNote — both hooks carry meta.
  "main/src/UI/features/admin/AdminNotesPage.composition.tsx"
  # AdminPoliciesPage: per-call onError for useSavePolicy + useSetMainPolicy — hooks carry meta.
  "main/src/UI/features/admin/AdminPoliciesPage.composition.tsx"
  # TraitsTab: per-call onError for useUpdateTrait, useDeleteTrait, useCreateTrait — hooks carry meta.
  "main/src/UI/features/admin/components/TraitsTab.organism.tsx"
  # AdminSupportThreadPage: per-call onError for useAdminReplyToThread — hook carries meta.
  "main/src/UI/features/admin/AdminSupportThreadPage.composition.tsx"
  # AdminModerationPage: per-call onError for useResolveReport + useApplyStrike — hooks carry meta.
  "main/src/UI/features/admin/AdminModerationPage.composition.tsx"
  # ReportModal: per-call onError for useReportGalleryRecord — hook carries meta.
  "main/src/UI/features/moderation/components/ReportModal.organism.tsx"
)

# ---------------------------------------------------------------------------
print_boxed_header "suppressGlobalError ratchet: no double-toast mutations" "🔔"
# ---------------------------------------------------------------------------

VIOLATIONS=0

# Collect all .ts and .tsx files under main/src/UI
declare -a TS_FILES
mapfile -t TS_FILES < <(find "$UI_DIR" -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 | tr '\0' '\n' | grep -v '^$')

if [[ ${#TS_FILES[@]} -eq 0 ]]; then
  print_info "No .ts/.tsx files found in main/src/UI — nothing to audit"
  exit 0
fi

print_header "Scanning for useMutation + onError + pushNewSnackbar without suppressGlobalError"

FOUND_VIOLATIONS=""

for ts_file in "${TS_FILES[@]}"; do
  [[ -z "$ts_file" ]] && continue

  # Must have all three: useMutation, onError, pushNewSnackbar
  grep -q "useMutation" "$ts_file" 2>/dev/null  || continue
  grep -q "onError"     "$ts_file" 2>/dev/null  || continue
  grep -q "pushNewSnackbar" "$ts_file" 2>/dev/null || continue

  # DECISION (nie usuwaj tego komentarza): detection is FILE-level (a single
  # marker anywhere in the file satisfies the whole file). We deliberately do NOT
  # parse useMutation-block boundaries: the audit covers BOTH the hook-level
  # onError pattern AND the page/component `mutate(.., {onError})` pattern where
  # onError lives in a separate call entirely, and files can host several hooks —
  # block-boundary parsing in bash would be brittle and break those patterns.
  # The ONE clean tightening we DO apply: require the real config token
  # `suppressGlobalError: true` AFTER stripping `//` line-comments, so a file that
  # only MENTIONS suppressGlobalError in a comment (e.g. "useToggleFavorite carries
  # meta.suppressGlobalError") no longer falsely satisfies the correct path. All
  # real usages are the literal `: true` form (verified 2026-06-25, zero new
  # violations), so this is low-false-positive. Residual known gap: a file with a
  # genuine `suppressGlobalError: true` on hook A could still hide a missing-meta
  # mutation B elsewhere in the same file — accepted (per-block parsing not worth
  # the fragility on this surface).
  if sed 's|//.*$||g' "$ts_file" 2>/dev/null | grep -q "suppressGlobalError: true"; then
    REL_PATH="${ts_file#${ROOT}/}"
    print_success "OK — ${REL_PATH}"
    continue
  fi

  # No suppressGlobalError found — check allowlist
  REL_PATH="${ts_file#${ROOT}/}"

  ALLOWED=0
  for allowed_file in "${ALLOWLIST[@]}"; do
    if [[ "$REL_PATH" == "$allowed_file" ]]; then
      ALLOWED=1
      break
    fi
  done

  if [[ "$ALLOWED" -eq 1 ]]; then
    print_success "allowlisted — ${REL_PATH} (per-call onError; companion hook carries meta)"
    continue
  fi

  VIOLATIONS=$((VIOLATIONS + 1))
  FOUND_VIOLATIONS="${FOUND_VIOLATIONS}${REL_PATH}"$'\n'
  print_error "VIOLATION — ${REL_PATH}: has custom onError+pushNewSnackbar but missing meta: { suppressGlobalError: true }"
done

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "suppressGlobalError audit FAILED — ${VIOLATIONS} file(s) missing meta"
  echo ""
  echo "Files with violations:"
  echo "$FOUND_VIOLATIONS"
  echo "Fix: add  meta: { suppressGlobalError: true }  to the useMutation config in each hook,"
  echo "     OR add the file to the ALLOWLIST in this script with a justification comment"
  echo "     (only if the companion hook already carries the meta and this file is a page/component)."
  exit 1
fi

print_success "suppressGlobalError audit passed — no double-toast mutations detected"
exit 0
