#!/usr/bin/env bash
# email-sweep-orderby.sh — Guard: a capped selection findMany in an email sweep
# operation MUST carry an orderBy (deterministic edge-drop), matching the
# winback-deletion I3 hardening (turbo-review S67).
#
# INTENT:
#   web-1 runs ~5 "lazy cron via traffic" email sweeps (trial / renewal / winback /
#   onboarding-abandonment / dunning-downgrade). Each fetches a SELECTION of accounts
#   or users capped by `take: <cap>` and then emails / downgrades them. Without an
#   `orderBy`, Postgres returns a NON-DETERMINISTIC subset for a LIMIT query, so at
#   scale the SAME first-cap rows win every sweep and the rows past the cap are
#   silently — and, for window-bounded sweeps (onboarding 24-48h, renewal 6-8d),
#   PERMANENTLY — starved of their email. winback already hardened this (orderBy
#   deleted_at asc + cap-hit warn, comment tag "I3"); S67 brought the four siblings
#   to parity. This ratchet keeps them there.
#
#   A NEW capped selection findMany in an email sweep op WITHOUT orderBy = regression.
#
# WHAT IT CHECKS (scope: web-1/src/domain/email/operations/*.operation.ts):
#   For each `.findMany({ … })` block, if it contains a CAP take (`take:` that is NOT
#   a lookup — i.e. not `take: <x>.length` and not `take: Math.min(`), the same block
#   MUST also contain `orderBy`. Lookup findMany (dedup by userIds, `take: ids.length`)
#   are exempt — order is irrelevant to a keyed IN() batch.
#
# ESCAPE: inline `// orderby-exempt: <reason>` inside the block skips it (no central
#   allowlist — the escape lives at the site, per section-discipline convention).
#
# RED-FIRST: deleting the `orderBy:` line from any of the five hardened sweeps makes
#   this script print a VIOLATION and exit 1 (verified by temporary removal).
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SWEEP_GLOB="${ROOT}/web-1/src/domain/email/operations"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$SWEEP_GLOB" "operacji e-mailowych"

print_boxed_header "Email sweep: capped selection findMany must orderBy" "📧"

VIOLATIONS=0
VIOLATION_LINES=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"
  # awk: walk each `.findMany(` block by brace depth; per block record whether it
  # has orderBy, a cap-take, an exempt escape, and the take's line number.
  RESULT="$(awk '
    function reset() { depth=0; inblk=0; hasOrder=0; hasCap=0; exempt=0; takeLine=0 }
    BEGIN { reset() }
    {
      raw=$0
      # Strip line comments so parens/braces inside prose (DECISION/SCDUN notes) and
      # trailing `// Safety cap` do not corrupt depth counting or keyword detection.
      code=raw; sub(/\/\/.*/, "", code)
      if (inblk==0 && code ~ /\.findMany\(/) { inblk=1; depth=0 }
      if (inblk==1) {
        if (code ~ /orderBy/) hasOrder=1
        if (raw ~ /orderby-exempt:/) exempt=1
        # keyed IN-lookup (id: { in: userIds }) = second-pass batch, order irrelevant.
        # Selection sweeps filter by domain fields (payment_status / createdAt-window /
        # stylist_account:null), never by an id-in-list — so an `in:` clause marks a lookup.
        if (code ~ /in:/) exempt=1
        # cap take = a take: that is NOT a keyed-lookup (.length / Math.min)
        if (code ~ /take:/ && code !~ /\.length/ && code !~ /Math\.min/) { hasCap=1; takeLine=NR }
        # Block scope via BRACE depth (Prisma findMany arg is an object literal).
        n=gsub(/\{/,"{",code); m=gsub(/\}/,"}",code)
        depth += n - m
        if (depth <= 0 && NR>1) {
          if (hasCap==1 && hasOrder==0 && exempt==0) print takeLine
          reset()
        }
      }
    }
  ' "$file")"
  if [[ -n "$RESULT" ]]; then
    while IFS= read -r ln; do
      [[ -z "$ln" ]] && continue
      VIOLATIONS=$((VIOLATIONS + 1))
      VIOLATION_LINES+="  ${REL_PATH}:${ln} — capped selection findMany without orderBy\n"
    done <<< "$RESULT"
  fi
done < <(find "$SWEEP_GLOB" -name '*.operation.ts' -type f -print0)

if [[ "$VIOLATIONS" -gt 0 ]]; then
  print_error "email-sweep-orderby: ${VIOLATIONS} capped findMany without orderBy"
  echo -e "$VIOLATION_LINES"
  echo "Add an orderBy (edge rows first, e.g. createdAt/deleted_at/current_period_end asc)"
  echo "so the per-sweep cap drops the least-urgent rows deterministically — parity with"
  echo "winback-deletion (I3). Genuine keyed-lookup findMany: add // orderby-exempt: <reason>."
  exit 1
fi

print_success "email-sweep-orderby passed — every capped email-sweep findMany orders deterministically"
exit 0
