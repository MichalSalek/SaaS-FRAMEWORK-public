#!/usr/bin/env bash
# prisma-fk-index.sh — Guard FK fields (from @relation) have a left-prefix index.
#
# INTENT:
#   Every column declared in @relation(fields: [X, ...]) must have a corresponding
#   @@index([X, ...]) / @@unique([X, ...]) / or @unique on the field itself with X
#   as the LEFT prefix. Without it, Postgres falls back to sequential scans on every
#   CASCADE/SET NULL operation and every join on that FK column.
#
#   Soft-FK columns (no @relation directive, documented DECISION in schema) are
#   intentionally excluded — they are append-only audit logs where the FK semantics
#   are soft (no ON DELETE cascade) and the index is already present by separate choice.
#
# WHAT IT CHECKS:
#   For each model in schema.prisma:
#     1. Collect FK field names from all @relation(fields: [...]) directives.
#     2. Collect indexed left-prefix columns from @@index([...]), @@unique([...]),
#        @unique field annotation.
#     3. Report any FK field that has NO left-prefix index / unique in that model.
#
# SCHEMA: web-1/src/prisma/schema.prisma (main schema only; app-logs schema is
#         simple event-log, FK-less — excluded deliberately).
#
# NEGATIVE TEST PROTOCOL:
#   To verify the script catches violations, temporarily add a relation without an
#   index to schema.prisma, run the script, confirm it exits 1, then revert.
#   Example done during BDX FAZA 1 (2026-06-14): added _NegTestFkNoIndex.parent_id
#   @relation without @@index([parent_id]) → script reported MISSING FK INDEX →
#   reverted → script passed.
#
# ALLOWLIST (known intentional gaps — DECISION in docs/DOMAIN/SCHEMA_DECISIONS.md):
#   (none — every FK relation field has a left-prefix index.)
#
# EXIT: 0 if PASS (all FK fields indexed or allowlisted), 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SCHEMA="${ROOT}/web-1/src/prisma/schema.prisma"

print_boxed_header "Prisma FK index: relation fields have left-prefix indexes" "🔑"

if [[ ! -f "$SCHEMA" ]]; then
  print_error "Schema not found: $SCHEMA"
  exit 1
fi

VIOLATIONS=0

# ─── Allowlist: known FK gaps (add @@index to resolve, then remove from list) ──
# Format: "Model.field_name"
FK_INDEX_ALLOWLIST=(
  # (empty — all FK relation fields carry a left-prefix @@index/@@unique.)
)

# ─── Parse schema with Python (awk/sed for multi-line model blocks is fragile) ──

MISSING=$(python3 - "$SCHEMA" <<'PYEOF'
import re, sys

schema_path = sys.argv[1]
with open(schema_path) as f:
    content = f.read()

# Split on model boundaries (preserve content)
# Each split item: model_name + body until next model/enum/generator/datasource
model_blocks = re.split(r'\nmodel\s+', '\n' + content)

results = []

for block in model_blocks[1:]:  # skip preamble before first model
    lines = block.split('\n')
    model_name = lines[0].strip().rstrip(' {').strip()

    # ── Collect FK fields from @relation(fields: [...]) ──────────────────────
    # A @relation can span one line: @relation(fields: [a, b], references: [...])
    # Join all lines to handle rare line-wraps, but only within this model block.
    block_text = '\n'.join(lines)
    fk_fields = []
    for m in re.finditer(r'@relation\([^)]*fields:\s*\[([^\]]+)\]', block_text):
        for field in m.group(1).split(','):
            field = field.strip()
            if field:
                fk_fields.append(field)

    if not fk_fields:
        continue  # no FK relations in this model

    # ── Collect indexed/unique left-prefix columns ────────────────────────────
    indexed = set()

    for line in lines:
        # @@index([col1, col2, ...]) or @@unique([col1, ...])
        # May have sort/ops decorators: col(sort: Desc), col(ops: raw("..."))
        m = re.search(r'@@(?:index|unique)\(\[([^\]]+)\]', line)
        if m:
            first_col = m.group(1).split(',')[0].strip()
            # Strip trailing modifiers like (sort: Desc) or (ops: raw(...))
            first_col = re.sub(r'\(.*\)', '', first_col).strip()
            indexed.add(first_col)

        # @unique on a field line:  "  field_name SomeType @unique"
        m2 = re.search(r'^\s+(\w+)\s+\S+.*@unique\b', line)
        if m2:
            indexed.add(m2.group(1))

        # @id field — primary key, inherently unique and indexed
        m3 = re.search(r'^\s+(\w+)\s+\S+.*@id\b', line)
        if m3:
            indexed.add(m3.group(1))

    # ── Check each FK field ───────────────────────────────────────────────────
    for fk in fk_fields:
        if fk not in indexed:
            results.append(f'{model_name}.{fk}')

if results:
    print('\n'.join(results))
PYEOF
)

if [[ -n "$MISSING" ]]; then
  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue

    # Check allowlist
    ALLOWED=0
    for allowed_entry in "${FK_INDEX_ALLOWLIST[@]}"; do
      if [[ "$entry" == "$allowed_entry" ]]; then
        ALLOWED=1
        break
      fi
    done

    if [[ "$ALLOWED" -eq 1 ]]; then
      MODEL=$(echo "$entry" | cut -d. -f1)
      FIELD=$(echo "$entry" | cut -d. -f2)
      print_warning "ALLOWLISTED FK gap — ${MODEL}.${FIELD} (add @@index to resolve)"
    else
      VIOLATIONS=$((VIOLATIONS + 1))
      MODEL=$(echo "$entry" | cut -d. -f1)
      FIELD=$(echo "$entry" | cut -d. -f2)
      print_error "MISSING FK INDEX — ${MODEL}.${FIELD}"
      print_info  "  Fix: add @@index([${FIELD}]) (or @@unique / @unique) in model ${MODEL}"
      print_info  "  Why: every @relation(fields:[${FIELD}]) without a left-prefix index"
      print_info  "       causes sequential scans on CASCADE/SET NULL and JOIN operations."
    fi
  done <<< "$MISSING"
else
  print_success "All FK fields (from @relation) have left-prefix indexes"
fi

if [[ "${#FK_INDEX_ALLOWLIST[@]}" -gt 0 && "$VIOLATIONS" -eq 0 ]]; then
  print_info "  ${#FK_INDEX_ALLOWLIST[@]} allowlisted gap(s) — resolve before removing from allowlist"
fi

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "prisma-fk-index audit FAILED — ${VIOLATIONS} FK field(s) missing index"
  echo ""
  exit 1
fi

print_success "prisma-fk-index audit PASSED — FK index coverage complete"
exit 0
