#!/usr/bin/env bash
# kernel-lint-gate.sh — the linter gate over the SHARED KERNEL must exist and be wired in.

# INTENT:
#   `.shared-kernel/` is code that BOTH projects compile. The submodules' `eslint.config.mjs`
#   put their copies (`src/READONLY-shared-kernel/**`) in `ignores`, so only a root config plus
#   a step in `scripts/typecheck/check-all` lints the SOURCE. This audit keeps that gate from
#   quietly disappearing, or from being "fixed" from the wrong side.

# CHECKS (5 assertions):
#   1. Root has `eslint.config.mjs` and it targets `.shared-kernel`.
#   2. Root declares an `eslint` dependency (a config without a binary is a dead gate).
#   3. `scripts/typecheck/check-all` actually RUNS the kernel lint (an assertion about the call,
#      not the config file: a config nobody runs is as blind as no config).
#   4. BOTH submodules still ignore their READONLY copies. The copy is an artifact (`chmod 444`)
#      and `main` runs `eslint --fix .` in `pre:build`, so un-ignoring it breaks the PRODUCTION
#      BUILD with EACCES instead of showing a lint error.
#   5. Presence floor: there is something to lint in the kernel (see the DECISION at step 5).

# EXIT: 0 when the gate stands, 1 when any assertion fails.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"

print_boxed_header "Kernel lint gate: wspólne jądro jest objęte linterem" "🧱"

# Presence floor for the scanned directory itself.
require_source_dir "${ROOT}/.shared-kernel" "wspólnego jądra" "ts"

ROOT_ESLINT_CONFIG="${ROOT}/eslint.config.mjs"
CHECK_ALL="${ROOT}/scripts/typecheck/check-all"
ROOT_PACKAGE_JSON="${ROOT}/package.json"
MAIN_ESLINT_CONFIG="${ROOT}/main/eslint.config.mjs"
WEB1_ESLINT_CONFIG="${ROOT}/web-1/eslint.config.mjs"

# Every path literal is asserted: a dead anchor exempts nothing.
for f in "$ROOT_ESLINT_CONFIG" "$CHECK_ALL" "$ROOT_PACKAGE_JSON" "$MAIN_ESLINT_CONFIG" "$WEB1_ESLINT_CONFIG"; do
    if [ ! -f "$f" ]; then
        print_error "Brak pliku, na którym opiera się ta bramka: ${f#$ROOT/}"
        exit 1
    fi
done

FAILURES=0

# --- 1. The root config targets the kernel ---
print_header "1/5 — konfiguracja lintera w roocie celuje w .shared-kernel"
if grep -q "\.shared-kernel" "$ROOT_ESLINT_CONFIG"; then
    print_success "eslint.config.mjs w roocie obejmuje .shared-kernel"
else
    print_error "eslint.config.mjs w roocie NIE wspomina .shared-kernel — bramka jądra nie ma celu"
    FAILURES=$((FAILURES + 1))
fi

# --- 2. Binarka zadeklarowana ---
print_header "2/5 — root deklaruje zależność eslint"
if node -e '
const p = require(process.argv[1]);
const d = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
process.exit(d.eslint ? 0 : 1);
' "$ROOT_PACKAGE_JSON"; then
    print_success "eslint jest w zależnościach roota"
else
    print_error "Root nie deklaruje eslinta — config bez binarki to martwa bramka"
    FAILURES=$((FAILURES + 1))
fi

# --- 3. check-all actually runs the kernel lint ---
print_header "3/5 — check-all wywołuje lint jądra (krok nie został wycięty)"
if grep -qE 'PID_KERNEL_ESLINT' "$CHECK_ALL" && grep -qE 'kernel eslint' "$CHECK_ALL"; then
    print_success "check-all uruchamia i raportuje lint jądra"
else
    print_error "check-all NIE odpala lintu jądra — config istnieje, ale nikt go nie uruchamia"
    echo "  Bramka, której nikt nie woła, jest tak samo ślepa jak jej brak." >&2
    FAILURES=$((FAILURES + 1))
fi

# --- 4. The submodules still ignore the READONLY copies ---
print_header "4/5 — oba submoduły nadal ignorują swoje kopie READONLY (to jest zamierzone)"
for cfg in "$MAIN_ESLINT_CONFIG" "$WEB1_ESLINT_CONFIG"; do
    name="$(basename "$(dirname "$cfg")")"
    if grep -q "READONLY-shared-kernel" "$cfg"; then
        print_success "${name}: kopia READONLY pozostaje poza linterem submodułu"
    else
        print_error "${name}: kopia READONLY NIE jest już ignorowana"
        echo "  Kopia jest artefaktem (chmod 444), a lint kopii nie ma jak jej naprawić." >&2
        echo "  W main/ dodatkowo pre:build robi 'eslint --fix .', więc lint kopii wywraca" >&2
        echo "  BUILD PRODUKCYJNY na EACCES. Lintujemy ŹRÓDŁO (.shared-kernel) z roota." >&2
        FAILURES=$((FAILURES + 1))
    fi
done

# --- 5. Presence floor counted on FILES, not on the directory ---
#
# DECISION: the floor is "> 0", not ">= 100". A hundred-file floor cannot be covered by a fixture
# (the audit-selftest mini-project would have to carry a hundred stubs), and an unprovable guard
# is worth less than a modest one with a red and a green sample in the repo. The class the floor
# defends against (a path drifted from the repo layout, so we scan nothing and report success) is
# already closed by `require_source_dir` + `require_scanned`; a high threshold only added cover
# against partial gutting of the directory, which has never been seen.
print_header "5/5 — podłoga obecności: jest co lintować"
KERNEL_TS_COUNT=$(find "${ROOT}/.shared-kernel" -type f -name '*.ts' \
    -not -path '*/node_modules/*' | wc -l | tr -d ' ')
require_scanned "$KERNEL_TS_COUNT" "plików .ts w jądrze"
print_success "Jądro: ${KERNEL_TS_COUNT} plików .ts objętych bramką"

print_separator
if [ "$FAILURES" -gt 0 ]; then
    print_error "KERNEL LINT GATE: ${FAILURES} asercji nie przeszło"
    exit 1
fi
print_success "KERNEL LINT GATE: bramka lintera nad jądrem stoi i jest wpięta"
exit 0
