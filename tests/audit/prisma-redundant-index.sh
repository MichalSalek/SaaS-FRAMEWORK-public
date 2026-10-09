#!/usr/bin/env bash
# prisma-redundant-index.sh — Guard against redundant (left-prefix-covered) @@index entries.
#
# INTENT:
#   A plain btree `@@index([a, b])` already serves every query that a narrower
#   `@@index([a])` would serve (Postgres uses the leftmost column(s) of a composite
#   btree). Keeping the narrower one is pure write-amplification + storage bloat with
#   zero read benefit. Same for `@@index([a])` when a `@@unique([a, ...])` (or a
#   field-level `@unique` on `a`, or the `@id`) already covers `a` as a left prefix.
#
#   This guard flags any PLAIN `@@index([cols])` whose (column, sort-direction) list is
#   a STRICT LEFT-PREFIX of another btree index / unique / @id in the SAME model. It is
#   the forcing-function that keeps the schema free of the redundant single-column /
#   short-composite indexes that accrete when later optimization passes add wider
#   covering composites but forget to drop the now-subsumed narrow ones.
#
# WHAT IT DOES *NOT* DO (deliberate scope):
#   - Never recommends dropping a `@@unique` / field `@unique` / `@id` — those enforce
#     invariants, not just read paths. Only PLAIN `@@index` is ever reported.
#   - GIN / trigram indexes (`type: Gin`, `gin_trgm_ops`) are never redundant vs a btree
#     (different access method) and are excluded on both sides of the comparison.
#   - Does not judge "trailing column after a unique prefix is pointless" (e.g.
#     `@@index([unique_col, x])`) — that is a per-case judgment call (needs to know the
#     query returns <=1 row), not a mechanical left-prefix rule. Handle those by hand.
#
# ESCAPE (documented deliberate retention):
#   Put `// redundant-index-allow: <reason>` as a trailing comment on the @@index line
#   (or on the line directly above it). The index is then reported as an allowlisted
#   warning instead of a failure. Use ONLY when a narrower index is genuinely wanted
#   despite the covering composite (rare; document why).
#
# SCHEMA: web-1/src/prisma/schema.prisma (main) + web-1/src/prisma-app-logs/schema.prisma.
#
# NEGATIVE TEST PROTOCOL (RED-first):
#   Add `@@index([user_id])` to a model that already has `@@index([user_id, expires])`
#   (e.g. temporarily to Session), run the script, confirm it exits 1 and names the
#   redundant index, then revert. Verified during turbo-review DB session 2026-07-18.
#
# EXIT: 0 if PASS (no redundant plain @@index, or all escaped), 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SCHEMAS=(
  "${ROOT}/web-1/src/prisma/schema.prisma"
  "${ROOT}/web-1/src/prisma-app-logs/schema.prisma"
)

print_boxed_header "Prisma redundant index: no plain @@index left-prefix-covered by another" "🧹"

VIOLATIONS=0

for SCHEMA in "${SCHEMAS[@]}"; do
  if [[ ! -f "$SCHEMA" ]]; then
    print_error "Schema not found: $SCHEMA"
    exit 1
  fi

  REPORT=$(python3 - "$SCHEMA" <<'PYEOF'
import re, sys

schema_path = sys.argv[1]
lines = open(schema_path).read().split('\n')

def parse_cols(inside):
    """Return list of (col, sort) from an index column list, splitting only top-level commas."""
    cols = []
    for part in re.split(r',(?![^()]*\))', inside):
        part = part.strip()
        if not part:
            continue
        nm = re.match(r'(\w+)', part)
        if not nm:
            continue
        col = nm.group(1)
        sort = 'Desc' if 'sort: Desc' in part else 'Asc'
        cols.append((col, sort))
    return cols

# Walk file line by line, tracking current model and line numbers (1-based).
cur_model = None
brace_depth = 0
# per model: list of dicts {cols, kind, gin, lineno, escaped}
models = {}
prev_line_escape = False

for i, raw in enumerate(lines):
    lineno = i + 1
    stripped = raw.strip()

    mstart = re.match(r'^model\s+(\w+)\s*\{', stripped)
    if mstart:
        cur_model = mstart.group(1)
        models[cur_model] = []
        prev_line_escape = False
        continue
    if cur_model and stripped == '}':
        cur_model = None
        prev_line_escape = False
        continue
    if not cur_model:
        continue

    has_escape = ('redundant-index-allow:' in raw) or prev_line_escape
    # remember whether THIS line is a lone escape comment for the NEXT line
    prev_line_escape = stripped.startswith('//') and 'redundant-index-allow:' in raw

    # @@index / @@unique
    im = re.match(r'^@@(index|unique)\(\[(.*?)\]', stripped)
    if im:
        kind = im.group(1)
        cols = parse_cols(im.group(2))
        gin = ('type: Gin' in raw) or ('gin_trgm_ops' in raw)
        models[cur_model].append({
            'cols': cols, 'kind': kind, 'gin': gin,
            'lineno': lineno, 'escaped': has_escape,
        })
        continue

    # field-level @unique / @id  -> single-column covering (btree)
    fu = re.match(r'^(\w+)\s+\w+.*@unique\b', stripped)
    if fu and not stripped.startswith('@@'):
        models[cur_model].append({
            'cols': [(fu.group(1), 'Asc')], 'kind': 'unique', 'gin': False,
            'lineno': lineno, 'escaped': False,
        })
    fid = re.match(r'^(\w+)\s+\w+.*@id\b', stripped)
    if fid and not stripped.startswith('@@'):
        models[cur_model].append({
            'cols': [(fid.group(1), 'Asc')], 'kind': 'id', 'gin': False,
            'lineno': lineno, 'escaped': False,
        })

violations = []
allowed = []
for model, idxs in models.items():
    btree = [x for x in idxs if not x['gin']]
    for a in idxs:
        if a['kind'] != 'index' or a['gin']:
            continue  # only PLAIN @@index can be reported as droppable
        colsA = a['cols']
        covered_by = None
        for b in btree:
            if b is a:
                continue
            colsB = b['cols']
            if len(colsA) >= len(colsB):
                continue
            if colsB[:len(colsA)] == colsA:  # strict left-prefix, col+sort match
                covered_by = b
                break
        if covered_by:
            ca = ','.join(c + ('DESC' if d == 'Desc' else '') for c, d in colsA)
            cb = ','.join(c + ('DESC' if d == 'Desc' else '') for c, d in covered_by['cols'])
            entry = f"{model}|{a['lineno']}|[{ca}]|[{cb}]|{covered_by['kind']}"
            if a['escaped']:
                allowed.append(entry)
            else:
                violations.append(entry)

for v in violations:
    print('VIOLATION|' + v)
for a in allowed:
    print('ALLOWED|' + a)
PYEOF
)

  SCHEMA_REL="${SCHEMA#"${ROOT}/"}"
  if [[ -n "$REPORT" ]]; then
    while IFS='|' read -r tag model lineno cols coveredby kind; do
      [[ -z "$tag" ]] && continue
      if [[ "$tag" == "ALLOWED" ]]; then
        print_warning "ALLOWLISTED redundant index — ${model} ${cols} (${SCHEMA_REL}:${lineno})"
      else
        VIOLATIONS=$((VIOLATIONS + 1))
        print_error "REDUNDANT INDEX — ${model} @@index(${cols}) at ${SCHEMA_REL}:${lineno}"
        print_info  "  Covered by ${kind} ${coveredby} (left-prefix). The wider one already"
        print_info  "  serves every query on ${cols}; drop the narrow @@index (write-amp + bloat)."
        print_info  "  Deliberate? add trailing // redundant-index-allow: <reason>"
      fi
    done <<< "$REPORT"
  fi
done

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "prisma-redundant-index audit FAILED — ${VIOLATIONS} redundant plain @@index"
  echo ""
  exit 1
fi

print_success "prisma-redundant-index audit PASSED — no left-prefix-covered plain @@index"
exit 0
