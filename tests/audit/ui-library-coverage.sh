#!/usr/bin/env bash
# ui-library-coverage.sh — Guard: every shared component is documented in the
# /ui component library registry (or explicitly allowlisted with a rationale).
#
# INTENT:
#   main/src/UI/features/ui-library/ is the living catalog of shared components:
#   what exists, how it looks (live renders), and how to use it (whenToUse).
#   When a component lands in components/ but never gets a registry entry, the
#   next /ui session can't see it — and reinvents it. This audit fails the
#   moment a component goes undocumented, so the catalog can't silently rot
#   (S28 census found ~25 such gaps; FDX FAZA 6 / W6.4 closed them).
#
# WHAT IT CHECKS:
#   Every component "main file" under main/src/UI/components/ must have its
#   importPath referenced in uiLibrary.registry.ts, OR be on the allowlist.
#   A component "main file" is:
#     - components/<Name>/<Name>.{atom|molecule|organism|composition}.tsx
#       (folder whose primary component matches the folder name), or
#     - components/<Name>.{atom|molecule|organism|composition}.tsx
#       (bare top-level composition file, e.g. ErrorBoundary, InfiniteScrollTrigger)
#   Helper / sub-files (CardHeader, AppDrawer sections, FilterTraitSection, etc.)
#   are NOT main files and are out of scope — they ship via their parent's entry.
#
# ALLOWLIST — purely-systemic / context-heavy components (intentionally NO entry,
#   or an entry WITHOUT a live render — registry still references them, but they
#   are exempt from the "must be referenced" failure when they have no sensible
#   standalone render). Each line: <ComponentName>  # rationale.
#
#   NOTE: the allowlist exempts a component from REQUIRING a registry reference.
#   Most allowlisted components ARE still documented (noRenderReason entry) —
#   the allowlist exists so a brand-new purely-systemic component (no visual,
#   no sensible demo) can ship without forcing a fake render. Today every
#   component is referenced, so the allowlist is a forward-looking safety net.
#
# EXIT: 0 if PASS (all components referenced or allowlisted), 1 if any gap.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
COMPONENTS_DIR="${ROOT}/main/src/UI/components"
REGISTRY="${ROOT}/main/src/UI/features/ui-library/uiLibrary.registry.ts"

print_boxed_header "UI library coverage: registry vs components/" "🧩"

if [[ ! -f "$REGISTRY" ]]; then
  print_error "Registry not found: ${REGISTRY#${ROOT}/}"
  exit 1
fi

# ─── Git-tracked filter (deterministic under parallel sessions) ──────────────
# main/ is a git submodule. A component directory created by another live
# session but not yet committed is UNTRACKED WIP — it is not part of any push,
# so it must not trip this pre-push guard. (That was the "flaky" fail: the audit
# raced a /ui session mid-work, so audit:all saw the component appear between
# passes.) We enforce documentation only on components that are actually tracked
# in the tree. When a session `git add`s + pushes an undocumented component it
# becomes tracked and the guard fires for them — exactly where the gap belongs.
# Fallback: if git can't enumerate (empty set), disable the filter so the audit
# never silently passes everything.
# DECISION (nie usuwaj tego komentarza) — DEGRADACJA FILTRA MUSI BYĆ GŁOŚNA:
# wcześniej stało tu `2>/dev/null || true`, a pusty wynik po cichu wyłączał filtr. To
# sklejało dwa RÓŻNE stany w jeden: „git odpowiedział, że nie ma śledzonych plików" oraz
# „git w ogóle nie odpowiedział" (index.lock zajęty przez równoległą sesję, wyczerpane
# deskryptory przy 105 strażnikach naraz, zepsuty gitlink submodułu). W drugim przypadku
# strażnik cicho ZMIENIA podstawę pomiaru — zaczyna liczyć wszystko z dysku zamiast tego,
# co jest w drzewie gita — i nikt się o tym nie dowiaduje ani z wyniku, ani z logu.
# Strażnik, który po cichu mierzy coś innego niż deklaruje, jest gorszy od jego braku.
# Teraz każdy z tych stanów zostawia ślad w logu, więc następna nieodtwarzalna awaria
# sama powie, czy filtr był sprawny.
USE_TRACKED_FILTER=1
TRACKED_TSX=""
if ! TRACKED_RAW="$(git -C "${ROOT}/main" ls-files 'src/UI/components/' 2>&1)"; then
  print_warning "git ls-files nie odpowiedziało — filtr śledzonych plików WYŁĄCZONY"
  print_info "  git: ${TRACKED_RAW}"
  print_info "  Skutek: skan liczy komponenty z DYSKU, więc niezacommitowana praca"
  print_info "  równoległej sesji może wywołać fałszywy alarm. To nie jest Twój błąd."
  USE_TRACKED_FILTER=0
else
  TRACKED_TSX="$(echo "$TRACKED_RAW" | grep -E '\.tsx$' || true)"
  if [[ -z "$TRACKED_TSX" ]]; then
    print_warning "git ls-files zwróciło zero plików .tsx — filtr śledzonych WYŁĄCZONY"
    print_info "  W tym repo to stan nienormalny (komponenty są w drzewie gita)."
    USE_TRACKED_FILTER=0
  fi
fi

is_tracked() {
  # $1 = absolute path to a .tsx under main/src/UI/components
  [[ "$USE_TRACKED_FILTER" -eq 0 ]] && return 0
  local rel="${1#${ROOT}/main/}"
  grep -qxF "$rel" <<< "$TRACKED_TSX"
}

# ─── Allowlist (component folder/file basename, without extension) ───────────
# Purely-systemic components that may ship WITHOUT a registry reference.
# Keep each rationale honest — this is the escape hatch, not a dumping ground.
ALLOWLIST=(
  # (currently empty — every component is referenced in the registry, most of
  #  the systemic ones via a noRenderReason entry. Add a name here ONLY for a
  #  new purely-systemic component with no sensible catalog render.)
)

is_allowlisted() {
  local name="$1"
  for allowed in "${ALLOWLIST[@]}"; do
    [[ "$name" == "$allowed" ]] && return 0
  done
  return 1
}

# ─── Collect referenced importPaths from the registry ────────────────────────
# Entries look like: importPath: 'src/UI/components/Button/Button.atom',
# Prettier may wrap a long path onto the next line, so match across the newline:
#   importPath:\n      'src/UI/components/.../X.organism',
# Perl slurps the whole file and captures the quoted value after `importPath:`.
# The registry is split across uiLibrary.registry*.ts (the data file hit its
# line cap in S126); an entry in any of them counts. The glob is anchored on the
# main registry, whose existence is asserted above.
REGISTRY_FILES=("${REGISTRY%.ts}"*.ts)
REFERENCED=$(perl -0777 -ne \
  "while (/importPath:\\s*'([^']+)'/g) { print \"\$1\\n\" }" "${REGISTRY_FILES[@]}")

registry_references() {
  # $1 = path fragment to look for (e.g. src/UI/components/Button/Button.atom)
  # Here-string, NOT `echo | grep -q`: under `set -o pipefail` grep -q exits on the
  # first match, echo gets EPIPE on the rest of the list and the pipeline reports
  # FAILURE for a real match. That was the „flaky” UNDOCUMENTED verdict
  # (HeaderUserMenu, TrialCountdownBanner) — it hit whichever entry sat early
  # enough in the list for grep to quit before echo finished writing (S109).
  grep -qxF "$1" <<< "$REFERENCED"
}

# ─── Enumerate component main files ──────────────────────────────────────────
LAYER_RE='\.(atom|molecule|organism|composition)\.tsx$'
MISSING=""
TOTAL=0
COVERED=0
ALLOWED=0

# 1) Folder components: components/<Name>/<Name>.<layer>.tsx
while IFS= read -r dir; do
  name="$(basename "$dir")"
  main_file="$(find "$dir" -maxdepth 1 -type f -name "${name}.*.tsx" 2>/dev/null \
    | grep -E "/${name}${LAYER_RE}" | head -1 || true)"
  [[ -z "$main_file" ]] && continue
  # Skip untracked WIP (another live session's uncommitted component)
  is_tracked "$main_file" || continue

  TOTAL=$((TOTAL + 1))
  layer="$(basename "$main_file" | sed -E "s/^${name}\.//; s/\.tsx$//")"
  import_path="src/UI/components/${name}/${name}.${layer}"

  if registry_references "$import_path"; then
    COVERED=$((COVERED + 1))
  elif is_allowlisted "$name"; then
    ALLOWED=$((ALLOWED + 1))
    print_info "allowlisted (no entry required) — ${name}"
  else
    MISSING="${MISSING}${name} (${import_path})"$'\n'
    print_error "UNDOCUMENTED — ${name}: no registry entry, not allowlisted"
    print_info "  Fix: add an entry in uiLibrary.registry.ts (render demo, or"
    print_info "       noRenderReason), or allowlist with a rationale here."
  fi
done < <(find "$COMPONENTS_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

# 2) Bare top-level composition files: components/<Name>.<layer>.tsx
while IFS= read -r file; do
  # Skip untracked WIP (another live session's uncommitted component)
  is_tracked "$file" || continue
  base="$(basename "$file")"
  name="$(echo "$base" | sed -E "s/${LAYER_RE}//")"
  layer="$(echo "$base" | sed -E "s/^${name}\.//; s/\.tsx$//")"
  import_path="src/UI/components/${name}.${layer}"

  TOTAL=$((TOTAL + 1))
  if registry_references "$import_path"; then
    COVERED=$((COVERED + 1))
  elif is_allowlisted "$name"; then
    ALLOWED=$((ALLOWED + 1))
    print_info "allowlisted (no entry required) — ${name}"
  else
    MISSING="${MISSING}${name} (${import_path})"$'\n'
    print_error "UNDOCUMENTED — ${name}: no registry entry, not allowlisted"
    print_info "  Fix: add an entry in uiLibrary.registry.ts, or allowlist here."
  fi
done < <(find "$COMPONENTS_DIR" -maxdepth 1 -type f -name "*.tsx" \
  | grep -E "${LAYER_RE}" | sort)

print_separator
print_info "Components scanned: ${TOTAL} | referenced: ${COVERED} | allowlisted: ${ALLOWED}"

if [[ -n "$MISSING" ]]; then
  COUNT=$(echo "$MISSING" | sed '/^$/d' | grep -c '^' || true)
  echo ""
  print_error "ui-library-coverage FAILED — ${COUNT} undocumented component(s):"
  echo "$MISSING" | sed '/^$/d' | while IFS= read -r line; do
    print_error "  - ${line}"
  done
  echo ""
  exit 1
fi

print_success "ui-library-coverage PASSED — every component is referenced or allowlisted"
exit 0
