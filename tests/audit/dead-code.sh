#!/usr/bin/env bash
# dead-code.sh — Guard: zero unreachable files in main/src (knip).
#
# INTENT (FQC W0.5b):
#   A file no module imports from any entry (pages/, next config) is dead weight —
#   it rots, misleads grep/navigation, and inflates the mental model. knip walks the
#   import graph from the configured entries (main/knip.json) and reports files
#   reachable from nothing.
#
# SCOPE (main/knip.json):
#   - entry: none explicit — the @next/next plugin auto-detects pages/, next config
#     and middleware as graph roots (App-Router i18n request.ts removed: orphan, no
#     createNextIntlPlugin wired in next.config; the project is Pages-Router with
#     messages provided via getStaticProps + NextIntlClientProvider in _app.tsx).
#   - ignore: src/READONLY-shared-kernel/** — propagated kernel copy, used by the
#     backend; "unused from frontend" is an artifact, not real dead code.
#   - ignore: src/UI/layouts/guards/useOnboardingPlanGuard.ts — DRAFT gate,
#     deliberately NOT wired (2026-07-09, header of that file: blocker = brak
#     wiarygodnego sygnału "plan resolved"; owner decision w
#     docs/PLANS_TODO/ONBOARDING_MANDATORY_GATE.md). Remove this ignore when the
#     guard gets wired into AppLayout or the draft is deleted.
#   - ignore: src/UI/shared/hooks/usePlaygroundVariant.ts — the owner-vote seam
#     (/dev/playground, README there). Product components import it only while a
#     vote is open; between votes it has no importer by design, and deleting it
#     would throw away the workshop the next vote starts from (S124).
#   - ignoreDependencies: dotenv-run-script / ts-morph / madge (CLI/script tooling).
#
# This ratchet checks FILES only (knip --include files). Unused exports/deps are a
# broader, riskier sweep (API surface, framework-implicit deps) tracked separately.
# A new unreachable file = fail (delete it, or wire it to an entry).
set -euo pipefail
source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)

print_boxed_header "DEAD-CODE AUDIT (knip — unused files)" "🧹"

cd "$PROJECT_ROOT/main"

if [[ ! -d node_modules/knip ]]; then
  print_warning "knip nie zainstalowany (devDep) — pomijam audyt dead-code."
  exit 0
fi

if KNIP_OUT=$(npx --no-install knip --include files --no-progress 2>&1); then
  print_success "dead-code: zero unreachable plików (knip)."
  exit 0
fi

# Post-filter: an untracked file created by another live session (WIP not yet
# wired to an entry) is not part of any push, so it must not trip this pre-push
# guard. knip runs from main/ → flagged paths are relative to main/ (a git
# submodule work-tree). Only TRACKED unreachable files are real dead code.
# (cwd is $PROJECT_ROOT/main from the cd above → git ls-files resolves here.)
FLAGGED=$(echo "$KNIP_OUT" | grep -oE 'src/[^ ]+\.(ts|tsx)' | sort -u)
TRACKED_DEAD=""
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    TRACKED_DEAD="${TRACKED_DEAD}${f}"$'\n'
  fi
done <<< "$FLAGGED"

if [[ -z "$(echo "$TRACKED_DEAD" | sed '/^$/d')" ]]; then
  print_success "dead-code: zero unreachable TRACKED plików (untracked WIP innej sesji pominięty)."
  exit 0
fi

print_error "dead-code: knip wykrył unreachable TRACKED pliki w main/src:"
echo "$TRACKED_DEAD" | sed '/^$/d'
print_info "Fix: usuń martwy plik (git history zachowuje) lub podepnij go do entry (pages/)."
exit 1
