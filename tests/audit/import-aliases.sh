#!/usr/bin/env bash
# import-aliases.sh — Guard against deep-relative imports into application/ or
# domain/ in web-1. After BDX W1.1 these MUST use the @app/* and @domain/* path
# aliases (web-1/tsconfig.json), mirroring the existing @kernel/* alias.
#
# INTENT:
#   Deep-relative imports (`../../../application/...`) are noise: fragile to file
#   moves, hard to read, and they obscure module boundaries. @app/@domain aliases
#   give one stable, refactor-safe spelling. This ratchet locks the win so the
#   noise cannot creep back.
#
# WHAT IT CHECKS:
#   Any `from '(../){2,}(application|domain)/...'` or dynamic
#   `import('(../){2,}(application|domain)/...')` in web-1/src is a violation.
#   (Single-level `../x` siblings are allowed; the codemod targets cross-module.)
#
# ALLOWLIST:
#   - src/READONLY-shared-kernel/  — vendored kernel copy (its own relative graph)
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
WEB1_SRC="${ROOT}/web-1/src"

print_boxed_header "Import aliases: @app/@domain enforcement (web-1)" "🔗"

VIOLATIONS=0

if [ -d "$WEB1_SRC" ]; then
  MATCHES=$(grep -rnE "(from|import\()[[:space:]]*['\"](\.\./){2,}(application|domain)/" "$WEB1_SRC" \
    --include=*.ts --include=*.tsx 2>/dev/null \
    | grep -v "/READONLY-shared-kernel/" || true)

  if [ -n "$MATCHES" ]; then
    VIOLATIONS=$(printf '%s\n' "$MATCHES" | grep -c . || true)
    print_error "Deep-relative imports into application/ or domain/ (use @app/@domain):"
    printf '%s\n' "$MATCHES" | head -40
  fi
fi

if [ "$VIOLATIONS" -gt 0 ]; then
  print_error "import-aliases: ${VIOLATIONS} violation(s)."
  exit 1
fi

print_success "import-aliases: 0 deep-relative imports into application/domain."
exit 0
