#!/usr/bin/env bash
# respond-arg-order.sh — Guard against swapped arguments in respondForbidden /
# respondUnauthorized (event passed where the payload belongs).
#
# INTENT:
#   The `respond*` family in web-1/src/application/http/http.responses.utils.ts
#   is NOT uniform, and that asymmetry is a live footgun:
#
#     respondForbidden(res, data, event = ACCESS_DENIED_INFO)   <- data SECOND
#     respondUnauthorized(res, data, event = UNAUTHORIZED)      <- data SECOND
#     respondNotFound(res, event, data)                         <- event SECOND
#     respondConflict/TooManyRequests/BadRequest(res, event, …) <- event SECOND
#
#   Writing the event second in the two odd ones COMPILES CLEANLY, because the
#   payload parameter is a bare generic that happily accepts a string. The
#   result is a silently wrong envelope: `event` falls back to its generic
#   default and `data` carries a STRING with the event name.
#
#   This is not hypothetical. MESSAGING_NOT_ALLOWED shipped that way: sending a
#   message into a revoked conversation answered 403 with
#   `{"event":"ACCESS_DENIED_INFO","data":"MESSAGING_NOT_ALLOWED"}`, so the
#   frontend — which picks its translated copy off the event — dropped
#   "messages only work in an active connection" and showed a generic
#   "access denied" instead. Neither tsc, nor eslint, nor assertResponseShape
#   could see it: after the swap the event is still a valid INFO event, it is
#   just the wrong one.
#
# SCOPE: web-1/src/**/*.ts — every call site of the two asymmetric helpers.
#   Matching is multi-line (these calls are usually formatted across 4 lines).
#
# WHY NOT JUST REORDER THE SIGNATURE: swapping the parameters of the two odd
#   helpers would make the family uniform, but it rewrites ~25 currently-correct
#   call sites across three files for a defect that has occurred once. This
#   ratchet buys the same protection at zero blast radius. If the signature is
#   ever unified, delete this audit in the same change.
#
# EXIT: 0 if PASS, 1 if any call passes APP_EVENTS.* as the payload argument.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/web-1/src"

print_boxed_header "Respond arg order: event must not land in the payload slot" "🔀"

if [[ ! -d "$SRC_DIR" ]]; then
  print_success "No web-1/src — nothing to scan"
  exit 0
fi

print_header "Scanning web-1/src for respondForbidden/respondUnauthorized(res, APP_EVENTS.*)"

# Slurp each file so the regex can span the usual multi-line formatting.
# `res` is always the first argument, so anchoring on it keeps this precise.
# Zielen nad ZEREM nie istnieje: bez licznika przeskanowanych plikow ten audyt
# nie odroznia „brak naruszen" od „skaner sie nie uruchomil". Ta sama klasa, ktora
# ta fala domknela w `ink-focus-ring` (zdjete `|| true`) i w strazniku deployu.
SCANNED=$(find "$SRC_DIR" -name '*.ts' -type f | wc -l | tr -d ' ')
if [[ "$SCANNED" -eq 0 ]]; then
  print_error "Respond arg order FAILED — zero przeskanowanych plikow w ${SRC_DIR}"
  exit 1
fi

VIOLATIONS=$(
  find "$SRC_DIR" -name '*.ts' -type f -print0 \
    | xargs -0 perl -0777 -ne '
        while (/respond(?:Forbidden|Unauthorized)\s*\(\s*res\s*,\s*(APP_EVENTS\.[A-Za-z0-9_.]+)/g) {
          my $matched = $1;
          my $line = 1 + substr($_, 0, pos($_)) =~ tr/\n//;
          print "$ARGV:$line: $matched passed as payload\n";
        }
      '
)

print_separator

if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | grep -c '' || true)
  print_error "Respond arg order FAILED — ${COUNT} call(s) put the event in the payload slot:"
  echo ""
  echo "$VIOLATIONS"
  echo ""
  echo "Fix: respondForbidden/respondUnauthorized take (res, data, event)."
  echo "     Pass the payload second and the event THIRD:"
  echo "       respondForbidden(res, undefined, APP_EVENTS.INFO.X.Y)"
  echo "     (respondNotFound/Conflict/TooManyRequests are the other way round —"
  echo "      event second — which is exactly why this guard exists.)"
  exit 1
fi

print_success "Respond arg order PASSED — no event passed as a payload"
exit 0
