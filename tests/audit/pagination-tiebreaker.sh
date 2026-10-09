#!/bin/bash
# pagination-tiebreaker.sh — Detect paginated Prisma queries that sort by a
# non-unique column WITHOUT a unique tiebreaker (cursor/offset drift bug class).
#
# Anti-pattern:  findMany({ skip, take, orderBy: { created_at: 'desc' } })
#                → created_at is non-unique → rows with equal timestamps may be
#                  duplicated or skipped across pages.
# Safe pattern:  orderBy: [{ created_at: 'desc' }, { id: 'desc' }]   (array form,
#                trailing unique key) OR a single sort on a unique column (id).
#
# Heuristic, BLOCKING: flags object-form single-field orderBy on a non-unique
# field within a window of skip:/cursor:/take: pagination. Array-form orderBy is
# assumed correct (carries a tiebreaker). This gate IS in run-all.sh and BLOCKS
# (exit 1 on any flagged candidate) — recurring class first caught in turbo-review
# r29/r30, now enforced.
#
# Recurring class origin: TQM R1 discovery (SCCAP-K2: moderation-reports,
# admin-user-timeline, ai-crawler-list — all fixed to array form).
set -e
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/web-1/src"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$SRC_DIR" "źródeł web-1"

# ── Fields treated as unique enough to stand alone as a sort key (no tiebreaker
# needed). The model's own primary key.
# DECISION (nie usuwaj tego komentarza): the regex `^(id|.*_id)$` treats ANY
# `*_id` column (including foreign keys, which are NON-unique) as a standalone
# safe sort key. This is a KNOWN coverage gap: a paginated sort on a bare FK
# column (e.g. `orderBy: { user_id: 'desc' }`) would drift but is silently
# skipped here. Tightening to only the model's own `id` would generate false
# positives (the heuristic cannot resolve which `*_id` is the PK per model from
# grep alone), so we accept the gap rather than weaken signal-to-noise. FK-only
# paginated sorts are caught by manual review in turbo-review.
UNIQUE_SORT_RE='^(id|.*_id)$'

# ── Allowlist: "file:line" entries that are intentionally single-field-sorted
# and verified non-drifting (e.g. sort on a column with a UNIQUE constraint).
TIEBREAKER_ALLOWLIST=(
  # example: "web-1/src/domain/foo/bar.operations.ts:42"
)

print_boxed_header "Pagination: cursor/offset tiebreaker audit (BLOCKING)"

# Object-form orderBy: `orderBy: { FIELD: 'asc'|'desc' }` on a single line.
HITS=$(grep -rnE "orderBy:[[:space:]]*\{[[:space:]]*[a-zA-Z_][a-zA-Z0-9_]*:[[:space:]]*['\"](asc|desc)" \
  "${SRC_DIR}" --include="*.ts" 2>/dev/null || true)

if [[ -z "$HITS" ]]; then
  print_success "No single-field object-form orderBy found"
  exit 0
fi

FLAGGED=0

while IFS= read -r line; do
  FILE=$(echo "$line" | cut -d: -f1)
  LINE_NUM=$(echo "$line" | cut -d: -f2)
  REL=$(echo "$FILE" | sed "s|${ROOT}/||")

  # Extract the sort field name from `orderBy: { FIELD:`
  FIELD=$(echo "$line" | sed -nE "s/.*orderBy:[[:space:]]*\{[[:space:]]*([a-zA-Z_][a-zA-Z0-9_]*):.*/\1/p")
  [[ -z "$FIELD" ]] && continue

  # Unique column standing alone is fine.
  if [[ "$FIELD" =~ $UNIQUE_SORT_RE ]]; then
    continue
  fi

  # Nested single-row relation fetch: `orderBy: {...}` immediately followed by
  # `take: 1` is a "latest/first row" lookup (e.g. last message in a thread),
  # NOT multi-page pagination — no drift possible. Skip.
  NEXT2=$(sed -n "$((LINE_NUM + 1)),$((LINE_NUM + 2))p" "$FILE")
  if echo "$NEXT2" | grep -qE "take:[[:space:]]*1[,[:space:]]*$"; then
    continue
  fi

  # Allowlist check.
  ALLOWED=0
  for allowed in "${TIEBREAKER_ALLOWLIST[@]}"; do
    [[ "${REL}:${LINE_NUM}" == "$allowed" ]] && ALLOWED=1 && break
  done
  if [[ "$ALLOWED" -eq 1 ]]; then
    print_success "${REL}:${LINE_NUM} — single sort on '${FIELD}' (allowlisted)"
    continue
  fi

  # Only a concern for OFFSET/CURSOR pagination (skip:/cursor:) — the dup/skip
  # drift class. A bare take: is a top-N limit, not multi-page pagination, so it
  # is NOT flagged. Look ±12 lines for genuine pagination markers.
  LO=$(( LINE_NUM > 12 ? LINE_NUM - 12 : 1 ))
  HI=$(( LINE_NUM + 12 ))
  WINDOW=$(sed -n "${LO},${HI}p" "$FILE")
  if grep -qE "(skip:|cursor:)" <<< "$WINDOW"; then
    print_error "TIEBREAKER MISSING: ${REL}:${LINE_NUM} — paginated query sorts by non-unique '${FIELD}' without a unique tiebreaker (use orderBy: [{ ${FIELD}: ... }, { id: ... }])"
    FLAGGED=1
  fi
done <<< "$HITS"

if [[ $FLAGGED -eq 1 ]]; then
  print_error "Pagination tiebreaker audit found candidates — fix to array form (BLOCKING gate, in run-all.sh)"
  exit 1
fi

print_success "Pagination tiebreaker audit passed — paginated queries carry unique tiebreakers"
exit 0
