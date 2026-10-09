#!/usr/bin/env bash
# naming-case.sh — Enforce kebab-case filenames in web-1 application/ + domain/.
#
# INTENT:
#   web-1 backend files are kebab-case by convention (domain/ was already 100%
#   kebab; BDX W3.4 renamed the last 8 camelCase stragglers in application/).
#   A camelCase basename is a drift signal — this ratchet keeps it from creeping back.
#
# WHAT IT CHECKS:
#   Any *.ts file under web-1/src/application or web-1/src/domain whose BASENAME
#   contains an uppercase letter is a violation. (React components .tsx and Prisma
#   generated clients are excluded — different conventions.)
#
# ALLOWLIST:
#   - *.tsx           (React components — PascalCase by convention)
#   - *.d.ts          (ambient declarations)
#   - js-client/      (Prisma generated)
#   - READONLY-shared-kernel/  (vendored kernel copy — its own naming)
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"

print_boxed_header "Naming case: kebab-case filenames (web-1 application/domain)" "🔤"

VIOLATIONS=0
for base in application domain; do
  DIR="${ROOT}/web-1/src/${base}"
  [ -d "$DIR" ] || continue
  MATCHES=$(find "$DIR" -name '*.ts' ! -name '*.d.ts' -type f 2>/dev/null \
    | grep -v '/js-client/' \
    | grep -v '/READONLY-shared-kernel/' \
    | while read -r f; do
        bn="$(basename "$f")"
        if grep -q '[A-Z]' <<<"$bn"; then
          echo "$f"
        fi
      done || true)
  if [ -n "$MATCHES" ]; then
    VIOLATIONS=$((VIOLATIONS + $(printf '%s\n' "$MATCHES" | grep -c .)))
    print_error "camelCase filenames in ${base}/ (use kebab-case):"
    printf '%s\n' "$MATCHES"
  fi
done

if [ "$VIOLATIONS" -gt 0 ]; then
  print_error "naming-case: ${VIOLATIONS} camelCase filename(s)."
  exit 1
fi

print_success "naming-case: all application/domain .ts filenames are kebab-case."
exit 0
