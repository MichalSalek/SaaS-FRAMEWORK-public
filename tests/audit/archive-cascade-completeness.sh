#!/usr/bin/env bash
# archive-cascade-completeness.sh — Guard: every cascade child of an account root
# is captured by the terminal-delete archive snapshot (or explicitly allow-listed).
#
# INTENT (terminal-delete archive model):
#   Terminal-delete (self-GDPR, admin-takedown, 90d MOVE) hard-deletes the User row.
#   Postgres ON DELETE CASCADE then wipes every satellite hanging off User /
#   StylistAccount / ClientAccount from the LIVE tables. Just before that, a full
#   snapshot is written to DeletedUser.body via `userRelationsArchiveEnabler`
#   (web-1/src/domain/user/user.config.ts) so the archive is SELF-SUFFICIENT: it does
#   not depend on any row the cascade removes.
#
#   The failure mode this guard closes: a NEW feature adds a model with a cascade FK
#   to an account root but nobody adds it to the enabler → its rows vanish on delete
#   with ZERO archive copy. That is EXACTLY how the whole "karta klientki / Visual CRM"
#   layer (VisitRecord / VisitResultPhoto / crm_note) was silently dropped until S69.
#   TSC cannot catch it (the enabler is a plain object literal). This audit is the
#   missing compiler check.
#
# WHAT IT CHECKS (hard fail):
#   Every list-relation field (`SomeModel[]`) declared on model User, StylistAccount or
#   ClientAccount MUST appear either (a) as a key inside userRelationsArchiveEnabler, or
#   (b) in the ALLOWLIST below (relations we deliberately do NOT archive, each with a
#   reason). A list-relation that is neither = a data-loss gap → fail.
#
# SCOPE / LIMITATION (deliberate — read before trusting this as "full coverage"):
#   This is a DIRECT-relation membership check on the three account roots, by name — NOT a
#   transitive cascade-graph walk. It does NOT descend into the cascade children of an
#   archived relation (e.g. GalleryRecord's own `session_container_photos` list, or any
#   deeper edge): include-DEPTH inside userRelationsArchiveEnabler is the enabler author's
#   responsibility, not this guard's. It catches the COMMON, high-value class — "a new
#   top-level model was hung off an account root and forgotten from the archive" (exactly how
#   the whole karta-klientki layer was lost) — which a plain grep/TSC never would. A full
#   DMMF/AST cascade-graph walk is a deliberate future upgrade, not a prerequisite for this
#   guard's value. Do NOT read a PASS here as "every byte a hard-delete touches is archived".
#
# EXIT: 0 if PASS, 1 if any uncovered direct cascade child found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SCHEMA="${ROOT}/web-1/src/prisma/schema.prisma"
CONFIG="${ROOT}/web-1/src/domain/user/user.config.ts"

# Account roots whose cascade children must be archived before hard-delete.
ROOTS=("User" "StylistAccount" "ClientAccount")

# Relations deliberately NOT archived. Format: "relation_field|reason".
# onDelete:SetNull survivors (row lives on, FK nulled) + other-users' data that merely
# references the deleted account (not the deleted user's own data to retain).
ALLOWLIST=(
  "announcements|SetNull — Announcement survives, created_by nulled"
  "runtime_config_updates|SetNull — RuntimeConfig survives, updated_by nulled"
  "favorited_by|other users' bookmarks OF this stylist — their data, not the deleted user's"
)

print_boxed_header "Archive cascade completeness: every account-root cascade child is archived (or allow-listed)" "🗄️"

# ─── Extract list-relation field names (`Field Model[]`) from a model block ──────
extract_list_relations() {
  local model="$1"
  awk -v model="$model" '
    $0 ~ ("^model " model "[[:space:]]*\\{") { f=1; next }
    f && /^\}/ { f=0 }
    f {
      line=$0
      sub(/\/\/.*/, "", line)               # strip inline comments
      # match: <field_name>  <Type>[]  (list relation)
      if (match(line, /^[[:space:]]*[a-z_][A-Za-z0-9_]*[[:space:]]+[A-Za-z0-9_]+\[\]/)) {
        gsub(/^[[:space:]]+/, "", line)
        print $1
      }
    }' "$SCHEMA"
}

# ─── Extract relation keys used inside userRelationsArchiveEnabler ───────────────
# Grabs every `word:` key within the enabler object (all nesting levels), which is a
# superset of relation names — safe: we only test membership, extra keys never cause
# a false FAIL (a schema list-relation absent here is what fails).
extract_enabler_keys() {
  awk '
    /export const userRelationsArchiveEnabler[[:space:]]*=[[:space:]]*\{/ { f=1 }
    f {
      # end of the top-level const: a line that is exactly "};"
      if ($0 ~ /^\};/) { f=0 }
      if (match($0, /[a-z_][A-Za-z0-9_]*[[:space:]]*:/)) {
        key=substr($0, RSTART, RLENGTH)
        gsub(/[[:space:]:]/, "", key)
        print key
      }
    }' "$CONFIG"
}

is_allowlisted() {
  local needle="$1" entry
  for entry in "${ALLOWLIST[@]}"; do
    [[ "${entry%%|*}" == "$needle" ]] && return 0
  done
  return 1
}

ENABLER_KEYS="$(extract_enabler_keys | sort -u)"
VIOLATIONS=0
COVERED=0

for ROOT_MODEL in "${ROOTS[@]}"; do
  RELATIONS="$(extract_list_relations "$ROOT_MODEL" | sort -u)"
  [[ -z "$RELATIONS" ]] && { print_error "No list-relations found on model ${ROOT_MODEL} — schema parse broke, update this audit"; VIOLATIONS=$((VIOLATIONS+1)); continue; }
  while read -r REL; do
    [[ -z "$REL" ]] && continue
    if grep -qx "$REL" <<< "$ENABLER_KEYS"; then
      COVERED=$((COVERED+1))
    elif is_allowlisted "$REL"; then
      : # deliberately not archived
    else
      VIOLATIONS=$((VIOLATIONS+1))
      print_error "${ROOT_MODEL}.${REL} — cascade child NOT in userRelationsArchiveEnabler and NOT allow-listed"
      print_info  "  Fix: add \`${REL}: ...\` to userRelationsArchiveEnabler (user.config.ts) so its rows land in DeletedUser.body,"
      print_info  "       OR add \"${REL}|<reason>\" to ALLOWLIST here if it must NOT be archived (SetNull survivor / other-user data)."
    fi
  done <<< "$RELATIONS"
done

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "archive-cascade-completeness FAILED — ${VIOLATIONS} cascade child(ren) would vanish with no archive copy"
  echo ""
  exit 1
fi

print_success "archive-cascade-completeness PASSED — ${COVERED} cascade relation(s) archived, rest allow-listed"
exit 0
