#!/usr/bin/env bash
# time-literals.sh — Guard against hardcoded `24 * 60 * 60 * 1000` and
# `60 * 60 * 1000` millisecond arithmetic outside the kernel SSOT.
#
# INTENT:
#   TIME (.shared-kernel/application/constants.config.ts → MS_PER_MINUTE /
#   MS_PER_HOUR / MS_PER_DAY / SECONDS_PER_DAY) is the single source of truth for
#   time-unit conversions. The same `24 * 60 * 60 * 1000` literal previously lived
#   in ~30 web-1 files (token TTLs, interceptor throttles, anomaly windows,
#   dunning math) — silent drift risk + magic-number arithmetic. Consumers now
#   build multiples from the kernel base, e.g. `7 * TIME.MS_PER_DAY`,
#   `WINDOW_HOURS * TIME.MS_PER_HOUR` — exact same value, no repeated arithmetic.
#
# WHAT IT CHECKS (scope: web-1/src AND main/src runtime code):
#   Raw `24 * 60 * 60 * 1000` or `60 * 60 * 1000` literals in .ts/.tsx source.
#
# DECISION (nie usuwaj tego komentarza): strażnik deklarował w README „poza jądrem",
#   ale skanował WYŁĄCZNIE `web-1/src` (886 plików .ts) — cały front (`main/src`,
#   1107 plików .ts/.tsx) był poza zasięgiem i świecił na zielono nad 8 realnymi
#   naruszeniami (shared.helpers, usePricingPlans, TrialCountdownBanner,
#   StylistDashboard.parts, AdminFeatureFlagsPage, UiLibrarySections,
#   account-recovery-state.helper, sessionTime.formatters). Zmierzone: przed
#   rozszerzeniem 886 plików / 0 violations, po rozszerzeniu 1994 pliki / 8 violations
#   (wszystkie naprawione na TIME.* z jądra — teraz 0). Rozszerzenie obejmuje też
#   `.tsx`, bo we froncie arytmetyka czasu żyje w komponentach, nie tylko w helperach.
#
# ALLOWLIST — intentional / out-of-scope (not violations):
#   - READONLY-shared-kernel/  — generated copy of the kernel (source-of-truth lives
#                                 in .shared-kernel/, not edited here). Both submodules.
#   - *.test.ts / *.test.tsx   — test assertions may reference literal values.
#   - prisma/ , prisma-app-logs/ — generated Prisma client typings (vendored).
#
# W4.1 NOTE: the old `*state.ts` blanket allowlist (interceptor throttle state files
#   holding `TWENTY_FOUR_HOURS`/`SIX_HOURS` consts) was REMOVED — those throttle
#   literals are gone (the throttle now lives in createSweepInterceptor as
#   `throttleMs: TIME.MS_PER_DAY` / `6 * TIME.MS_PER_HOUR`; the surviving
#   pairing/session/janitor state files hold only advisory-lock helpers, no time math).
#
# RED-FIRST: leaving a raw `24 * 60 * 60 * 1000` in any non-allowlisted web-1/src or
#   main/src file (e.g. a fresh `const TTL = 24 * 60 * 60 * 1000;` in an operation file)
#   makes this script print a VIOLATION and exit 1. Verified manually by temporarily
#   re-inlining a literal before sweeping — see commit notes.
#
# EXIT: 0 if PASS (baseline 0 outside allowlist), 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
WEB1_SRC="${ROOT}/web-1/src"
MAIN_SRC="${ROOT}/main/src"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$WEB1_SRC" "źródeł web-1"
require_source_dir "$MAIN_SRC" "źródeł main"

print_boxed_header "Time literals: TIME-constants SSOT audit" "⏱️"

# Pattern: ms/day and ms/hour millisecond arithmetic in any equivalent written form.
# DECISION (nie usuwaj tego komentarza): regex rozszerzony z wąskiej single-space-padded
# formy `24 * 60 * 60 * 1000` na warianty TEJ SAMEJ jednoznacznej arytmetyki czasu:
#   - dowolny whitespace wokół `*` w obrębie linii (\s* zamiast pojedynczej spacji) —
#     np. `24*60*60*1000`, `24 *60* 60 * 1000`.
#   - odwrócona kolejność czynników `1000 * 60 * 60 * 24` / `1000 * 60 * 60`.
# Świadomie NIE łapiemy gołych równoważników ms (86400000/3600000): te liczby bywają
# nie-czasowe (limit rozmiaru/licznik), więc gołe dopasowanie false-positowałoby na legit
# stałych. Łapiemy tylko jawną arytmetykę `*` (jednoznacznie czas). grep działa per-linia,
# więc wielolinijkowe łamanie arytmetyki nie jest wykrywane (rzadkie; prettier trzyma w 1 linii).
# Cały ten zestaw to ta sama wartość co TIME.MS_PER_DAY / TIME.MS_PER_HOUR — należy
# budować ją z kernel-SSOT (TIME.*), nie inline.
TIME_LITERAL_REGEX='(24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|60\s*\*\s*60\s*\*\s*1000|1000\s*\*\s*60\s*\*\s*60\s*\*\s*24|1000\s*\*\s*60\s*\*\s*60)'

VIOLATIONS=0
VIOLATION_LINES=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"

  # ── Allowlist ──
  # Generated kernel copy — SSOT lives in .shared-kernel/, not edited here.
  [[ "$REL_PATH" == web-1/src/READONLY-shared-kernel/* ]] && continue
  [[ "$REL_PATH" == main/src/READONLY-shared-kernel/* ]] && continue
  # Test files (both submodules; front tests live in .test.tsx too).
  [[ "$REL_PATH" == *.test.ts ]] && continue
  [[ "$REL_PATH" == *.test.tsx ]] && continue
  # DECISION (nie usuwaj tego komentarza): test-utils/ (typed fixtures, test helpers) to
  # test-only infrastructure — NIE runtime code, ktore audyt deklaratywnie pilnuje. Ten sam
  # powod co allowlist *.test.ts: fixtures moga inline'owac literalna wartosc czasu (np.
  # session.expires = now + 30 dni) bez ryzyka driftu produkcyjnego. Wykryte przez rozszerzony
  # regex (forma odwrocona 1000*60*60*24) — celowo dopisane do allowlisty, nie do gate'u runtime.
  [[ "$REL_PATH" == web-1/src/test-utils/* ]] && continue
  # Vendored Prisma client typings.
  [[ "$REL_PATH" == web-1/src/prisma/* ]] && continue
  [[ "$REL_PATH" == web-1/src/prisma-app-logs/* ]] && continue
  # (W4.1: `*state.ts` blanket allowlist removed — interceptor throttle literals
  #  moved into createSweepInterceptor as TIME.* multiples; no state file has time math.)

  if grep -qP "$TIME_LITERAL_REGEX" "$file" 2>/dev/null; then
    LINES=$(grep -nP "$TIME_LITERAL_REGEX" "$file")
    LINE_NUMS=$(echo "$LINES" | cut -d: -f1 | sort -un | tr '\n' ',' | sed 's/,$//')
    VIOLATION_LINES="${VIOLATION_LINES}${REL_PATH}:${LINE_NUMS}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION — ${REL_PATH} at line(s): ${LINE_NUMS}"
    echo "$LINES" | head -3 | while IFS= read -r line; do
      print_info "    $(echo "$line" | sed 's/^[[:space:]]*//')"
    done
    print_info "  Fix: import { TIME } from '@kernel/application/constants.config'"
    print_info "       and use TIME.MS_PER_DAY / TIME.MS_PER_HOUR (multiply for N units)"
  fi
done < <(find "$WEB1_SRC" "$MAIN_SRC" -type f \( -name "*.ts" -o -name "*.tsx" \) -print0 2>/dev/null \
  | grep -zv "node_modules\|\.next\|/out/\|/dist/")

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "time-literals audit FAILED — ${VIOLATIONS} file(s) with raw time literals"
  echo ""
  exit 1
fi

print_success "time-literals audit PASSED — time math uses TIME constants (SSOT)"
exit 0
