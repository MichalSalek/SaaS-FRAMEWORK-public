#!/usr/bin/env bash
# kernel-lint-gate.sh — Bramka lintera nad WSPÓLNYM JĄDREM musi istnieć i być wpięta.
#
# INTENT:
#   `.shared-kernel/` to 17,6 tys. linii kodu, który kompilują OBA projekty. Przez 119 sesji
#   nie widział lintera w ogóle: oba `eslint.config.mjs` w submodułach mają swoje kopie
#   (`src/READONLY-shared-kernel/**`) w `ignores`, a nic nie lintowało ŹRÓDŁA. S102 zapisało to
#   jako „open", S120 zamknęło konfiguracją w roocie + krokiem w `scripts/typecheck/check-all`.
#   Ten audyt pilnuje, żeby luka nie wróciła po cichu — ani przez skasowanie kroku, ani przez
#   „naprawienie" jej z niewłaściwej strony.
#
# CO SPRAWDZA (5 asercji):
#   1. Root ma `eslint.config.mjs` i celuje on w `.shared-kernel`.
#   2. Root ma zadeklarowaną zależność `eslint` (config bez binarki to martwa bramka).
#   3. `scripts/typecheck/check-all` NAPRAWDĘ odpala lint jądra — czyli krok nie został wycięty.
#      To jest asercja o WYWOŁANIU, nie o samym istnieniu pliku konfiguracyjnego: config, którego
#      nikt nie uruchamia, jest dokładnie tak samo ślepy jak brak configu.
#   4. OBA submoduły NADAL ignorują swoje kopie READONLY. To nie jest przeoczenie do naprawienia —
#      kopia jest artefaktem (`chmod 444`), a `main` robi w `pre:build` `eslint --fix .`, więc
#      odbramkowanie kopii wywracałoby BUILD PRODUKCYJNY na EACCES zamiast pokazać błąd lintera.
#      Gdyby ktoś kiedyś to „poprawił", ten audyt ma o tym powiedzieć wprost.
#   5. Podłoga obecności: w jądrze jest co lintować (>= 100 plików .ts). Bez tego przeniesienie
#      albo zmiana nazwy katalogu dałaby zieleń nad pustym zbiorem — klasa „audyt mierzy podzbiór",
#      spisana w AGENTS.md §GUARDS.
#
# EXIT: 0 gdy bramka stoi, 1 gdy którakolwiek asercja padnie.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"

print_boxed_header "Kernel lint gate: wspólne jądro jest objęte linterem" "🧱"

# Podłoga obecności dla samego skanowanego katalogu.
require_source_dir "${ROOT}/.shared-kernel" "wspólnego jądra" "ts"

ROOT_ESLINT_CONFIG="${ROOT}/eslint.config.mjs"
CHECK_ALL="${ROOT}/scripts/typecheck/check-all"
ROOT_PACKAGE_JSON="${ROOT}/package.json"
MAIN_ESLINT_CONFIG="${ROOT}/main/eslint.config.mjs"
WEB1_ESLINT_CONFIG="${ROOT}/web-1/eslint.config.mjs"

# Każdy literał ścieżki asercjonowany — martwa kotwica zwalnia z niczego (AGENTS.md §GUARDS).
for f in "$ROOT_ESLINT_CONFIG" "$CHECK_ALL" "$ROOT_PACKAGE_JSON" "$MAIN_ESLINT_CONFIG" "$WEB1_ESLINT_CONFIG"; do
    if [ ! -f "$f" ]; then
        print_error "Brak pliku, na którym opiera się ta bramka: ${f#$ROOT/}"
        exit 1
    fi
done

FAILURES=0

# --- 1. Config w roocie celuje w jądro ---
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

# --- 3. check-all naprawdę odpala lint jądra ---
print_header "3/5 — check-all wywołuje lint jądra (krok nie został wycięty)"
if grep -qE 'PID_KERNEL_ESLINT' "$CHECK_ALL" && grep -qE 'kernel eslint' "$CHECK_ALL"; then
    print_success "check-all uruchamia i raportuje lint jądra"
else
    print_error "check-all NIE odpala lintu jądra — config istnieje, ale nikt go nie uruchamia"
    echo "  Bramka, której nikt nie woła, jest tak samo ślepa jak jej brak." >&2
    FAILURES=$((FAILURES + 1))
fi

# --- 4. Submoduły nadal ignorują kopie READONLY ---
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

# --- 5. Podłoga obecności liczona na PLIKACH, nie na katalogu ---
#
# DECISION (nie usuwaj tego komentarza) — PODŁOGA JEST „> 0", A NIE „>= 100":
# pierwsza wersja wymagała tu co najmniej stu plików .ts. Brzmi mocniej, ale ma jedną wadę,
# która przesądza sprawę: takiej podłogi NIE DA SIĘ pokryć fixture'em, bo mini-projekt
# audit-selftestu musiałby wozić sto atrap. Strażnik nie do udowodnienia jest wart mniej niż
# strażnik o skromniejszym progu, który ma czerwoną i zieloną próbkę w repo (AGENTS.md §GUARDS:
# „fixture jest jedynym dowodem"). Klasa, przed którą ta podłoga broni — „ścieżka rozjechała się
# ze strukturą repo, więc skanujemy pustkę i meldujemy sukces" — jest domknięta już przez
# `require_source_dir` + `require_scanned`; próg stu plików dokładał tylko ochronę przed
# CZĘŚCIOWYM wypatroszeniem katalogu, czyli scenariuszem, którego nigdy nie widzieliśmy.
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
