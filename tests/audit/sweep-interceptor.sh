#!/usr/bin/env bash
# sweep-interceptor.sh — Guard: request-sweep interceptors MUST use the
# createSweepInterceptor factory (BDX W4.1), not a hand-rolled throttle skeleton.
#
# INTENT:
#   web-1 runs ~13 "lazy cron via traffic" sweeps (cleanup / expiry / janitor) as
#   fire-and-forget request interceptors. Before W4.1 each one re-implemented the
#   SAME skeleton: in-memory throttle gate (shouldAttempt*/updateTimestamp*) →
#   mark-before-await → performance.now timing → try/run/recordSweepRun → catch→
#   reportIssueBackend → NEVER throw. That skeleton + ~6 `*-state.ts` throttle files
#   were collapsed into one factory: createSweepInterceptor({ name, throttleMs, run }).
#
#   This ratchet keeps the win: a NEW sweep that re-introduces a manual throttle
#   (shouldAttempt* / updateTimestamp* / a `recordSweepRun`/`withSweepTiming` call
#   wired by hand) instead of going through createSweepInterceptor = a regression.
#
# DECISION (nie usuwaj tego komentarza): odkrywanie plików przeniesione z NAZWY na
#   TREŚĆ. Poprzednia wersja robiła `find web-1/src -name '*interceptor*.ts'` — 17
#   plików — więc sweep, którego plik nie ma „interceptor" w nazwie, był dla strażnika
#   niewidzialny. Zmierzone: `email-lifecycle.orchestrator.ts` eksportuje
#   `emailLifecycleInterceptor`, jest ZAREJESTROWANY w `schedule-maintenance-sweeps.ts`
#   obok trzynastu rodzeństw budowanych fabryką, i ręcznie odtwarza cały szkielet
#   (shouldRunEmailSweep → withSweepTiming → updateLastSweepTimestamp → catch →
#   reportIssueBackend, never-throw) — a strażnik świecił na zielono. Teraz odkrywanie
#   ma DWA sygnały, oba treściowe:
#     (A) REJESTR — nazwy przekazane do `runAfterResponse(() => xInterceptor())`
#         w `schedule-maintenance-sweeps.ts` rozwiązane do plików definiujących
#         (`export const <nazwa>`). To definicyjna lista request-sweepów: 13 plików.
#     (B) MARKERY — dowolny `.ts` w web-1/src, którego KOD (komentarze zdjęte przez
#         grep_code_stripped) niesie ślady ręcznego throttle'a/timingu sweepa.
#         Łapie sweep jeszcze nie podpięty do rejestru.
#   Zmierzone: PRZED = 17 plików odkrytych po nazwie, 0 violations (orchestrator poza
#   zasięgiem). PO = 13 z rejestru ∪ 9 z markerów = 19 unikatów objętych skanem, w tym
#   orchestrator; z wyłączoną allowlistą strażnik go REALNIE łapie (red-first sprawdzony
#   przez chwilowe usunięcie wpisu: VIOLATION na liniach 30,31,33,192,202,204).
#
# WHAT IT CHECKS (scope: web-1/src runtime code, discovered by content — see above):
#   Every discovered sweep MUST import createSweepInterceptor — otherwise it is
#   hand-rolling the skeleton.
#
# ALLOWLIST — intentional standalone / sweep infrastructure (not violations):
#   - create-sweep-interceptor.ts  — the factory itself (defines the skeleton).
#   - health/sweep-monitoring.utils.ts — DEFINES recordSweepRun/withSweepTiming
#       (the markers' own declaration site), plus the SweepName SSOT. Not a sweep.
#   - stripe-event-janitor.interceptor.ts — DOCUMENTED EXCEPTION. Its 60s window +
#       cross-instance optimistic row-claim (UPDATE…WHERE retry_count=N, inside
#       sweepUnprocessedStripeEvents) are the real dedup, not a per-instance in-memory
#       throttle. Stays out of the in-memory factory by design (DECISION comment in
#       the interceptor). Cross-instance — must NOT be folded into createSweepInterceptor.
#   - stripe-event-janitor.state.ts — throttle state OF that allowlisted janitor.
#   - lifecycle/email-lifecycle.orchestrator.ts — DOCUMENTED EXCEPTION (see below).
#   - email-handler/email-lifecycle.state.ts — throttle state OF that orchestrator.
#   - pages/api/v1/internal/sweep-tick/index.ts — the external sweep CLOCK (S122,
#       Better Stack monitor). It only READS the email sweep's throttle
#       (shouldRunEmailSweep) to decide whether to wake the DB, and then calls
#       runMaintenanceSweeps, i.e. the registered interceptors. It owns no sweep body
#       and no throttle state of its own.
#   - startup/cached-counts-backfill{,-state}.ts — one-shot STARTUP backfill, not a
#       request sweep (absent from schedule-maintenance-sweeps.ts, no SweepName,
#       no recordSweepRun); it merely shares the shouldAttempt*/update*Attempt naming.
#
# EMAIL-LIFECYCLE ESCAPE — why the factory does NOT fit (verified against
# create-sweep-interceptor.ts, not assumed):
#   The factory marks its throttle timestamp BEFORE awaiting `run` ("mark-before-await",
#   per-instance pile-in dedup) and unconditionally — a run that throws still burns the
#   window. The orchestrator does the OPPOSITE, twice, on purpose:
#     1. QUIET HOURS (21:00-09:00 UTC) are checked AFTER the throttle gate but BEFORE
#        the timestamp is touched, so a request landing inside quiet hours does NOT
#        consume the 6h window. Folded into `run`, the factory would already have marked
#        it → a request at 08:55 UTC would push the daily email sweep to ~14:55.
#     2. `updateLastSweepTimestamp()` runs ONLY after a SUCCESSFUL sweep (explicit
#        in-file comment: "failed sweep should retry on next trigger"). Under the factory
#        a failed email sweep would be throttled out for a full 6h instead of retrying
#        on the next eligible request.
#   Both are email-DELIVERY timing guarantees, not skeleton boilerplate; the factory has
#   no seam for either without forking its core dedup contract for one caller. Pile-in
#   from the late mark is covered by EventLog dedup (documented in the orchestrator).
#   → allowlisted WITH a DECISION comment in the file. Re-evaluate only if the factory
#     ever grows an explicit `markPolicy` seam.
#
# RED-FIRST: dropping a fresh `if (!shouldAttemptFoo()) return;` + a manual
#   `recordSweepRun('foo', ...)` into ANY new web-1/src .ts (whatever its filename)
#   WITHOUT importing createSweepInterceptor makes this script print a VIOLATION and
#   exit 1 — likewise registering a factory-less interceptor in schedule-maintenance-sweeps.
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
WEB1_SRC="${ROOT}/web-1/src"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$WEB1_SRC" "źródeł web-1"

SWEEP_REGISTRY="${WEB1_SRC}/application/interceptors/schedule-maintenance-sweeps.ts"
if [[ ! -f "$SWEEP_REGISTRY" ]]; then
  print_error "Brak rejestru sweepów: ${SWEEP_REGISTRY#${ROOT}/}"
  print_info  "  Strażnik odkrywa sweepy przez rejestr — bez niego mierzyłby połowę domeny."
  exit 1
fi

print_boxed_header "Sweep interceptors: createSweepInterceptor enforcement" "🧹"

# Allowlist — files (relative to ROOT) that legitimately do NOT use the factory.
# Every entry is justified in the header block above.
ALLOWLIST=(
  "web-1/src/application/interceptors/create-sweep-interceptor.ts"
  "web-1/src/application/health/sweep-monitoring.utils.ts"
  "web-1/src/application/stripe/webhooks/janitor/stripe-event-janitor.interceptor.ts"
  "web-1/src/application/stripe/webhooks/janitor/stripe-event-janitor.state.ts"
  "web-1/src/application/email-handler/lifecycle/email-lifecycle.orchestrator.ts"
  "web-1/src/application/email-handler/email-lifecycle.state.ts"
  "web-1/src/pages/api/v1/internal/sweep-tick/index.ts"
  "web-1/src/application/startup/cached-counts-backfill.ts"
  "web-1/src/application/startup/cached-counts-backfill-state.ts"
)

# Manual-throttle / hand-wired-sweep markers. Presence of any of these in CODE
# (comments stripped) means the file is (or pretends to be) a sweep.
SWEEP_MARKER_REGEX='recordSweepRun|withSweepTiming|shouldAttempt[A-Za-z]*|shouldRun[A-Za-z]*Sweep|update[A-Za-z]*Timestamp|update[A-Za-z]*Attempt'

# ── Discovery signal A: the sweep REGISTRY ───────────────────────────────────
# Names handed to runAfterResponse(() => xInterceptor()) resolved to the file that
# declares them (`export const <name>`). Definitional list of request sweeps.
REGISTERED_NAMES=$(grep -oP 'runAfterResponse\(\(\)\s*=>\s*\K[A-Za-z0-9_]+(?=\s*\(\))' \
  "$SWEEP_REGISTRY" | sort -u)
REGISTERED_COUNT=$(echo "$REGISTERED_NAMES" | grep -c . || true)

DISCOVERED=""
UNRESOLVED=""
for name in $REGISTERED_NAMES; do
  DEF_FILE=$(grep -rl --include="*.ts" "export const ${name}" "$WEB1_SRC" 2>/dev/null \
    | grep -v "READONLY-shared-kernel\|\.test\.ts" | head -1 || true)
  if [[ -z "$DEF_FILE" ]]; then
    UNRESOLVED="${UNRESOLVED}${name} "
    continue
  fi
  DISCOVERED="${DISCOVERED}${DEF_FILE}"$'\n'
done

# ── Discovery signal B: sweep MARKERS in code (comments stripped) ─────────────
# Catches a hand-rolled sweep that is not (yet) wired into the registry.
mapfile -t CANDIDATE_FILES < <(find "$WEB1_SRC" -type f -name "*.ts" 2>/dev/null \
  | grep -v "node_modules\|\.next\|/out/\|/dist/\|READONLY-shared-kernel\|\.test\.ts")
MARKER_FILES=$(grep_code_stripped "$SWEEP_MARKER_REGEX" "${CANDIDATE_FILES[@]}" \
  | cut -d: -f1 | sort -u || true)
DISCOVERED="${DISCOVERED}${MARKER_FILES}"$'\n'

SCAN_LIST=$(echo "$DISCOVERED" | grep -v '^$' | sort -u || true)
SCANNED=$(echo "$SCAN_LIST" | grep -c . || true)
# Floor obecności: zero odkrytych sweepów = zepsute odkrywanie, nie „czysto".
require_scanned "$SCANNED" "sweepów (rejestr + markery)"

VIOLATIONS=0

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  REL_PATH="${file#${ROOT}/}"

  # Skip allowlisted standalone / infrastructure files.
  SKIP=0
  for allowed in "${ALLOWLIST[@]}"; do
    if [[ "$REL_PATH" == "$allowed" ]]; then
      SKIP=1
      break
    fi
  done
  [[ "$SKIP" -eq 1 ]] && continue

  # It IS a sweep → it MUST import createSweepInterceptor.
  if ! grep -qE "createSweepInterceptor" "$file" 2>/dev/null; then
    LINES=$(grep_code_stripped "$SWEEP_MARKER_REGEX" "$file" | cut -d: -f2 | sort -un \
      | tr '\n' ',' | sed 's/,$//')
    [[ -z "$LINES" ]] && LINES="(registered sweep, no factory import)"
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION — ${REL_PATH} hand-rolls a sweep throttle at line(s): ${LINES}"
    print_info  "  Fix: build it with createSweepInterceptor({ name, throttleMs, run })"
    print_info  "       (web-1/src/application/interceptors/create-sweep-interceptor.ts)."
    print_info  "       True cross-instance dedup (advisory lock / row-claim) goes INSIDE run."
    print_info  "       A genuine misfit → ALLOWLIST here + a DECISION comment in the file."
  fi
done <<< "$SCAN_LIST"

print_separator
echo "  Sweepy z rejestru (schedule-maintenance-sweeps.ts): ${REGISTERED_COUNT}"
echo "  Plików objętych skanem (rejestr ∪ markery): ${SCANNED}"
echo "  Allowlist (udokumentowane wyjątki + infrastruktura): ${#ALLOWLIST[@]}"

if [[ -n "$UNRESOLVED" ]]; then
  print_warning "Zarejestrowane interceptory bez pliku definicji: ${UNRESOLVED}"
  print_info    "  Rejestr odwołuje się do nazwy, której nie ma jako 'export const' — sprawdź barrel."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "sweep-interceptor audit FAILED — ${VIOLATIONS} hand-rolled sweep interceptor(s)"
  echo ""
  exit 1
fi

print_success "sweep-interceptor audit PASSED — all sweeps use createSweepInterceptor (${#ALLOWLIST[@]} documented exceptions)"
exit 0
