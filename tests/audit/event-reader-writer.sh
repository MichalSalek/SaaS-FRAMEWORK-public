#!/usr/bin/env bash
# event-reader-writer.sh — no EventLog READ filters by a key that NO code path
# ever WRITES.
#
# INTENT:
#   Real incident (2026-09-23): the daily admin signup digest
#   (web-1/src/domain/email/operations/admin-alerts.operation.ts) queried
#   `eventLog.findMany({ where: { event: APP_EVENTS.INFO.ACCOUNT.ACCOUNT_CREATED,
#   ... } })`, but nothing in the codebase ever WRITES ACCOUNT_CREATED — Better
#   Auth's signup hook writes USER_REGISTERED instead. The digest compiled,
#   typechecked, and ran on a schedule forever without ever firing. Nothing
#   mechanical would have caught it: tsc sees a valid `EVENT_INFO_TYPE`, no
#   test exercises a real signup + a real sweep together, and the read/write
#   sides sit in different files with no shared symbol to grep for. Fixed to
#   read USER_REGISTERED; this guard is the mechanical defence against the
#   next event that quietly drifts the same way.
#
# WHY A NODE/AST HELPER, NOT SAME-LINE BASH REGEX (AGENTS.md "GUARDS MEASURE
# THE RULE, NOT A KEYWORD"): a `where` clause here is routinely built as a
# separate `const where = {...}` and mutated afterwards
# (admin-audit-trail.operations.ts: `where.event = { contains: ... }`), and
# prettier wraps the object literal itself across several lines. Both shapes
# are invisible to a same-line grep. The real logic — walking the TypeScript
# AST via the `typescript` compiler API (root devDependency, no new
# dependency added) — lives in tests/audit/lib/event-reader-writer.mjs; full
# definitions of READ/WRITE/VALUE RESOLUTION/ESCAPE are documented in that
# file's header, not duplicated here.
#
# SCOPE: web-1/src + .shared-kernel (*.ts), excluding node_modules, .next,
#   js-client, READONLY-shared-kernel (the propagated read-only copies —
#   scanning them would double-count every finding), _fixtures, *.d.ts and
#   *.test.ts.
#
# WHAT IT ALLOWS:
#   - Any read whose value resolves to a key that SOME write mechanism
#     produces (recordAuditEvent_IO / writeRawEventLog_IO / a direct
#     `eventLog.create`|`createMany` / an `infoEvent:` literal in
#     email-schedule.config.ts / a sendTransactionalEmail 3rd-arg literal).
#   - `// event-reader-writer-allow: <reason>` on the offending line or the
#     line directly above it. The reason is MANDATORY — a bare marker is
#     itself a violation (an escape nobody had to justify is how a ratchet
#     rots into decoration), reported independent of whether the read it
#     was meant to cover is actually dead.
#
# HONEST SCOPE (what this does NOT prove — see the .mjs header for detail):
#   A key threaded through an IMPORTED array, a `.map()`/`.filter()`
#   projection, or a bare function parameter (`dunningRule.infoEvent`,
#   `args.infoEvent`) is DYNAMIC — reported in the stats, never silently
#   dropped, but not checked against the write set. That is a false-negative
#   risk accepted on purpose: resolving those would mean tracing values across
#   files/call sites, which risks the opposite failure (a false RED blocking
#   push on a read the tool merely failed to follow). `{ notIn: ... }` /
#   `{ contains: ... }` and similar operators do not name one key to check for
#   a writer, so they are OUT-OF-SCOPE, not violations.
#
# EXIT: 0 if PASS, 1 if a dead read site or an unexplained escape marker exists.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
HELPER="$(dirname "$0")/lib/event-reader-writer.mjs"
WEB1_SRC="${ROOT}/web-1/src"
KERNEL="${ROOT}/.shared-kernel"

print_boxed_header "Event-log reader/writer: no READ by a key nobody WRITES" "🪞"

require_source_dir "${WEB1_SRC}" "web-1 sources" "ts"
# KERNEL is NOT require_source_dir-gated: the .mjs helper treats both
# app-events.const.ts and email-schedule.config.ts as best-effort inputs (see
# its header) and walk()s a missing directory into an empty list rather than
# throwing, so a selftest sandbox that stubs only web-1/src (no .shared-kernel
# at all) is a legitimate must-fail/must-pass sample, not a broken one. In a
# real checkout get_project_root()'s own shape assertion already guarantees
# .shared-kernel exists before this script runs.
if [[ ! -d "${KERNEL}" ]]; then
  print_info "Brak ${KERNEL#"${ROOT}/"} w tym drzewie — pomijam kernel jako źródło (best-effort)."
fi

if [[ ! -f "${HELPER}" ]]; then
  print_error "Brak skanera AST: ${HELPER#"${ROOT}/"}"
  print_info "Skrypt pomocniczy zniknął lub się przeniósł — audyt NIE zgaduje werdyktu."
  exit 1
fi

print_header "Skan AST: web-1/src + .shared-kernel"

STDOUT_TMP="$(create_temp_file event_reader_writer_stdout)"
STDERR_TMP="$(create_temp_file event_reader_writer_stderr)"
trap cleanup_temp_files EXIT

set +e
node "${HELPER}" "${ROOT}" >"${STDOUT_TMP}" 2>"${STDERR_TMP}"
NODE_STATUS=$?
set -e

if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "${STDOUT_TMP}" >/dev/null 2>&1; then
  print_error "Skaner AST się wywrócił zamiast zwrócić wynik (exit ${NODE_STATUS})"
  echo "" >&2
  cat "${STDERR_TMP}" >&2
  echo "" >&2
  print_info "To NIE jest znalezisko — to martwy skaner. Napraw ${HELPER#"${ROOT}/"}, audyt nie zgaduje werdyktu nad pustym/niepoprawnym wyjściem."
  exit 1
fi

READ_SITES=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).readSitesWithEventFilter)" "${STDOUT_TMP}")
require_scanned "${READ_SITES}" "odczytów EventLog filtrowanych po evencie (where.event)"

# ─── Human-readable report, rendered from the JSON the helper printed ───────
node -e '
const fs = require("fs");
const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const root = r.root.endsWith("/") ? r.root : r.root + "/";
const rel = (p) => (p.startsWith(root) ? p.slice(root.length) : p);

console.log(`ℹ Plików przeskanowanych: ${r.filesScanned}`);
console.log(`ℹ Wywołań eventLog.<findMany|findFirst|findUnique|count|groupBy|aggregate>: ${r.readCallSitesTotal}`);
console.log(`ℹ Odczytów z filtrem po evencie: ${r.readSitesWithEventFilter} (rozstrzygniętych: ${r.resolvedCount}, dynamicznych: ${r.dynamicCount}, poza zakresem operatora: ${r.outOfScopeCount}, z escape: ${r.allowedCount})`);
console.log(`ℹ Kluczy z jakimkolwiek pisarzem: ${r.writeKeysCount} (app-events.const.ts wczytany: ${r.appEventsMapLoaded ? "tak" : "nie, fallback na nazwę własności"}; email-schedule.config.ts: ${r.scheduleFileExists ? `tak, ${r.scheduleInfoEventCount} infoEvent` : "brak — pomijam to źródło pisarzy"})`);

if (r.badEscapes.length > 0) {
  console.log("");
  console.log(`✗ ${r.badEscapes.length} escape marker bez powodu:`);
  for (const b of r.badEscapes) console.log(`    ${rel(b)}`);
}

if (r.violations.length > 0) {
  console.log("");
  console.log(`✗ ${r.violations.length} odczyt(ów) EventLog bez ŻADNEGO pisarza:`);
  for (const v of r.violations) {
    console.log(`    ${rel(v.file)}:${v.line} — klucz(e) bez pisarza: ${v.keys.join(", ")}`);
  }
}
' "${STDOUT_TMP}"

VIOLATIONS=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).violations.length)" "${STDOUT_TMP}")
BAD_ESCAPES=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).badEscapes.length)" "${STDOUT_TMP}")

print_separator

if [[ "${VIOLATIONS}" -gt 0 || "${BAD_ESCAPES}" -gt 0 ]]; then
  print_error "Event-log reader/writer FAILED — ${VIOLATIONS} martwy(ch) odczyt(ów), ${BAD_ESCAPES} nieuzasadniony(ch) escape"
  echo ""
  echo "  Fix: napisz brakujący event przez recordAuditEvent_IO/writeRawEventLog_IO"
  echo "       (albo, jeśli zapytanie celowało w zły klucz jak w incydencie z"
  echo "       2026-09-23, popraw sam odczyt na event, który faktycznie ktoś pisze)."
  echo ""
  echo "  Deliberate exception: '// event-reader-writer-allow: <reason>' na linii"
  echo "  odczytu albo linię wyżej (powód obowiązkowy)."
  exit 1
fi

print_success "Event-log reader/writer passed — ${READ_SITES} odczyt(ów) z filtrem po evencie, żaden bez pisarza"
exit 0
