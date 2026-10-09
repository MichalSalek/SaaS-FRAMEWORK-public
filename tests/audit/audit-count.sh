#!/usr/bin/env bash
# audit-count.sh — Meta-guard: keep the audit registry self-consistent.
#
# INTENT:
#   The audit suite is registered in FOUR places that silently drift apart:
#     1. the .sh files in tests/audit/ (the audits themselves),
#     2. the SCRIPTS=() array in run-all.sh (what `npm run audit:all` runs),
#     3. the `audit:*` scripts in package.json (individually runnable),
#     4. the count declared in tests/audit/README.md.
#   When a new audit is added but not wired into run-all (or README rots), the
#   suite reports "all green" while silently NOT running a guard. This meta-guard
#   fails the moment those four drift.
#
# WHAT IT CHECKS (hard fail):
#   1. Every run-all SCRIPTS entry has a matching .sh file (no dangling reference).
#   2. Every .sh file (excl _utils/run-all) is EITHER in run-all OR explicitly
#      listed in STANDALONE_ALLOWLIST (intentional: runs separately, not in audit:all).
#   3. Every package.json `audit:*` script (excl `audit`, `audit:all`) points to an
#      existing .sh file (no dangling named script).
#   4. README.md declares the canonical counts via the machine marker
#        <!-- AUDIT-COUNT: total=<N> runall=<M> --> and they match reality.
#   5. Every run-all SCRIPTS entry has a documentation row in the README table
#      (matched by the backticked filename, e.g. `ssot-routes.sh`) — an audit
#      that runs but is invisible in docs rots into "nobody knows what this guards".
#
# STANDALONE_ALLOWLIST — audits intentionally NOT in run-all/audit:all:
#   - stale-artifacts.sh  (advisory; runs separately, does not block push)
#
# EXIT: 0 if PASS, 1 if drift found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
AUDIT_DIR="${ROOT}/tests/audit"
RUNALL="${AUDIT_DIR}/run-all.sh"
PKG="${ROOT}/package.json"
README="${AUDIT_DIR}/README.md"

print_boxed_header "Audit registry meta-guard: count consistency" "🧮"

# Audits intentionally outside run-all (run separately).
STANDALONE_ALLOWLIST=("stale-artifacts.sh")

is_standalone() {
  local needle="$1" e
  for e in "${STANDALONE_ALLOWLIST[@]}"; do
    [[ "$e" == "$needle" ]] && return 0
  done
  return 1
}

VIOLATIONS=0

# ─── Gather the three machine sources ────────────────────────────────────────
ON_DISK=$(find "$AUDIT_DIR" -maxdepth 1 -name '*.sh' \
  ! -name '_utils.sh' ! -name 'run-all.sh' -exec basename {} \; | sort)
# WYŁĄCZNIE tablica SCRIPTS=() — nie cały plik. Poprzednia wersja czytała
# każde wystąpienie "<nazwa>.sh" w run-all.sh, więc PRZENIESIENIE audytu do
# komentarza (albo wpisanie go w nagłówkowym opisie) wyciszało go, nie ruszając
# licznika: meta-guard raportował spójny rejestr nad audytem, który już nie
# chodził. Ekstrakcja idzie od linii `SCRIPTS=(` do pierwszego `)` w kolumnie 1.
RUNALL_ENTRIES=$(awk '/^SCRIPTS=\(/{inside=1; next} inside && /^\)/{inside=0} inside' "$RUNALL" \
  | sed 's|#.*||' | grep -oE '"[a-z0-9-]+\.sh"' | tr -d '"' | sort -u)
PKG_ENTRIES=$(node -e "
  const s=require('${PKG}').scripts;
  Object.entries(s)
    .filter(([k])=>k.startsWith('audit:') && k!=='audit' && k!=='audit:all')
    .forEach(([,v])=>{const m=v.match(/([a-z0-9-]+\.sh)/); if(m) console.log(m[1]);});
" | sort -u)

# ─── Parallel-session isolation (2026-09-05) ─────────────────────────────────
# This repo is edited by several sessions in ONE working tree. A fresh audit that
# another session dropped on disk — untracked in git AND wired nowhere yet — must
# not trip THIS gate: it does not travel with this push anyway. Counting it here
# blocked an unrelated webhook push on 2026-08-31 (untracked spacing-tokens.sh,
# 102/103 green, audit-count the only red). An untracked file that the working
# tree ALREADY references in run-all/package.json stays in the census: the tree
# claims it, so the registry must agree — the reverse drift is still caught.
# No git (tarball checkout, selftest mini-project) → the plain disk census.
TRACKED=$(git -C "$ROOT" ls-files --cached -- 'tests/audit/*.sh' 2>/dev/null \
  | xargs -rn1 basename 2>/dev/null | sort || true)
if [[ -z "$TRACKED" ]]; then
  SH_FILES="$ON_DISK"
else
  SH_FILES=""
  while read -r f; do
    [[ -z "$f" ]] && continue
    if grep -qxF "$f" <<< "$TRACKED" \
       || grep -qxF "$f" <<< "$RUNALL_ENTRIES" \
       || grep -qxF "$f" <<< "$PKG_ENTRIES"; then
      SH_FILES+="${f}"$'\n'
    else
      print_info "pominięto ${f}: nieśledzony w git i niezarejestrowany — praca innej sesji, nie jedzie w tym pushu"
    fi
  done <<< "$ON_DISK"
  SH_FILES=$(printf '%s' "$SH_FILES" | sort)
fi

TOTAL_SH=$(echo "$SH_FILES" | grep -c . || true)
RUNALL_COUNT=$(echo "$RUNALL_ENTRIES" | grep -c . || true)

# ─── CHECK 1: run-all entries all have a .sh file ────────────────────────────
print_header "Check 1: run-all entries resolve to a .sh file"
DANGLING_RUNALL=$(comm -13 <(echo "$SH_FILES") <(echo "$RUNALL_ENTRIES") || true)
if [[ -n "$DANGLING_RUNALL" ]]; then
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "run-all.sh references audits with no .sh file:"
  echo "$DANGLING_RUNALL" | while read -r f; do [[ -n "$f" ]] && print_info "    $f"; done
else
  print_success "All run-all entries have a backing .sh file"
fi

# ─── CHECK 2: every .sh is in run-all OR standalone-allowlisted ──────────────
print_header "Check 2: every .sh is wired (run-all or standalone-allowlist)"
NOT_WIRED=$(comm -23 <(echo "$SH_FILES") <(echo "$RUNALL_ENTRIES") || true)
CH2=0
while read -r f; do
  [[ -z "$f" ]] && continue
  if ! is_standalone "$f"; then
    VIOLATIONS=$((VIOLATIONS + 1)); CH2=$((CH2 + 1))
    print_error "Audit not in run-all and not standalone-allowlisted: $f"
    print_info  "  Add it to SCRIPTS=() in run-all.sh, or to STANDALONE_ALLOWLIST here if intentional."
  fi
done <<< "$NOT_WIRED"
[[ "$CH2" -eq 0 ]] && print_success "Every .sh is wired into run-all or explicitly standalone"

# ─── CHECK 3: package.json audit:* all resolve to a .sh file ─────────────────
print_header "Check 3: package.json audit:* scripts resolve to a .sh file"
DANGLING_PKG=$(comm -13 <(echo "$SH_FILES") <(echo "$PKG_ENTRIES") || true)
if [[ -n "$DANGLING_PKG" ]]; then
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "package.json audit:* scripts point to missing .sh files:"
  echo "$DANGLING_PKG" | while read -r f; do [[ -n "$f" ]] && print_info "    $f"; done
else
  print_success "All package.json audit:* scripts resolve to a .sh file"
fi

# ─── CHECK 4: README marker matches reality ──────────────────────────────────
print_header "Check 4: README.md AUDIT-COUNT marker matches reality"
MARKER=$(grep -oE '<!-- AUDIT-COUNT: total=[0-9]+ runall=[0-9]+ -->' "$README" | head -1 || true)
if [[ -z "$MARKER" ]]; then
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "README.md is missing the machine marker"
  print_info  "  Add exactly: <!-- AUDIT-COUNT: total=${TOTAL_SH} runall=${RUNALL_COUNT} -->"
else
  README_TOTAL=$(echo "$MARKER" | grep -oE 'total=[0-9]+' | cut -d= -f2)
  README_RUNALL=$(echo "$MARKER" | grep -oE 'runall=[0-9]+' | cut -d= -f2)
  if [[ "$README_TOTAL" != "$TOTAL_SH" || "$README_RUNALL" != "$RUNALL_COUNT" ]]; then
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "README marker drift — marker says total=${README_TOTAL} runall=${README_RUNALL}, actual total=${TOTAL_SH} runall=${RUNALL_COUNT}"
    print_info  "  Update marker to: <!-- AUDIT-COUNT: total=${TOTAL_SH} runall=${RUNALL_COUNT} -->"
  else
    print_success "README marker matches: total=${TOTAL_SH} runall=${RUNALL_COUNT}"
  fi
fi

# ─── CHECK 5: every run-all script has a README table row ────────────────────
print_header "Check 5: every run-all audit is documented in README.md"
MISSING_DOC=()
while read -r f; do
  [[ -z "$f" ]] && continue
  if ! grep -qF "\`$f\`" "$README"; then
    MISSING_DOC+=("$f")
  fi
done <<< "$RUNALL_ENTRIES"
if [[ "${#MISSING_DOC[@]}" -gt 0 ]]; then
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "run-all audits with no README.md table row (${#MISSING_DOC[@]}):"
  for f in "${MISSING_DOC[@]}"; do
    print_info "    $f"
  done
  print_info "  Add a row to the audits table in tests/audit/README.md (backticked \`<name>.sh\` + what it checks)."
else
  print_success "Every run-all audit has a README documentation row"
fi

# ── CHECK: tree-guards.list wskazuje na istniejace skrypty ─────────────────
# Lista jest SSOT dwoch konsumentow pre-commitu, a NIC jej dotad nie walidowalo:
# literowka albo skasowany skrypt dawaly ciche `continue` w jednym hooku
# i twarde COMMIT BLOCKED w drugim, zaleznie od tego, ktorym sie commituje.
TREE_LIST="${ROOT}/scripts/hooks/tree-guards.list"
if [[ -f "$TREE_LIST" ]]; then
  TG_BAD=0
  TG_SEEN=0
  while IFS= read -r g || [[ -n "$g" ]]; do
    g="${g%%#*}"; g="$(echo "$g" | tr -d '[:space:]')"
    [[ -z "$g" ]] && continue
    TG_SEEN=$((TG_SEEN + 1))
    if [[ ! "$g" =~ ^[a-z0-9-]+$ ]]; then
      print_error "tree-guards.list: wpis '$g' nie jest nazwa audytu ([a-z0-9-])"
      TG_BAD=1
    elif [[ ! -f "${ROOT}/tests/audit/${g}.sh" ]]; then
      print_error "tree-guards.list wymienia '$g', a tests/audit/${g}.sh nie istnieje"
      TG_BAD=1
    fi
  done < "$TREE_LIST"
  [[ "$TG_BAD" -eq 1 ]] && exit 1
  [[ "$TG_SEEN" -eq 0 ]] && { print_error "tree-guards.list nie zawiera ANI JEDNEGO wpisu — hooki nie uruchomia zadnego straznika drzewa"; exit 1; }
  print_success "tree-guards.list — ${TG_SEEN} wpisow, kazdy wskazuje na istniejacy skrypt"
else
  # Caly ten check byl opakowany w `[[ -f ]]` BEZ galezi `else`, wiec skasowanie
  # SSOT-listy przechodzilo tu na zielono — a rownoczesnie rozbrajalo szesc
  # ratchetow w hooku. Jedyny walidator listy nie moze milczec, gdy listy nie ma.
  print_error "brak ${TREE_LIST} — jedyne zrodlo straznikow drzewa dla hookow roota i submodulu"
  exit 1
fi

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "audit-count meta-guard FAILED — ${VIOLATIONS} drift issue(s)"
  echo ""
  exit 1
fi

print_success "audit-count meta-guard PASSED — registry self-consistent (total=${TOTAL_SH}, run-all=${RUNALL_COUNT})"
exit 0
