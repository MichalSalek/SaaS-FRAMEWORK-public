#!/bin/bash

# DECISION (nie usuwaj tego komentarza) — S113, po przeglądzie:
# Wszystkie cztery regexy tokenów mają `[A-Z0-9_]`, NIE `[A-Z_]`. Nazwy zdarzeń w tym
# repo niosą cyfry (D1/D3/D7/D14/D23/D29/D30/D37/D60, 24H, 7D), więc wariant bez cyfr
# nie widział 20 z 338 zdarzeń INFO — a bratni `event-log-registration.sh` ostrzega
# przed dokładnie tym w swoim nagłówku. Zmiana nie wykryła dziś żadnego naruszenia
# (te 20 to zdarzenia audytowe maili, nigdy nie kopertowane), ale zamyka ślepą plamę,
# która rosła z każdym nowym zdarzeniem z dniem w nazwie.

# I18N EVENTS — UI COVERAGE AUDIT
# In run-all (npm run audit:all / git:push). Named: npm run audit:events-i18n-coverage.
#
# Verifies that every INFO event that REACHES THE UI (the `event` field of the
# `{ event, data }` HTTP response envelope) has a translation key in ALL locales
# (pl/en/de). Without a key, next-intl renders the raw token (e.g. "PAIRING_NOT_FOUND")
# in the snackbar instead of a human message.
#
# Complements events-i18n-parity.sh:
#   - parity     = "every key present in one locale is present in all locales"
#   - coverage   = "every UI-emitted event HAS a key at all" (this script)
#
# DETECTION (deterministic, FAIL-SAFE — only asserts events it can confidently prove
# reach the envelope; never false-positives, because the audit blocks commits):
#   An INFO event is considered UI-emitted iff its `APP_EVENTS.INFO.X.Y` token appears as:
#     (1) an argument to a respond*() helper (error-mapper error paths + handler success paths),
#     (2) the baked-in default of a respond*() helper called WITHOUT an event arg
#         (respondForbidden→ACCESS_DENIED_INFO, respondSuccess→SUCCESS, etc.),
#     (3) the values of a *map variable* passed as the event arg (e.g. pairingCodeEventMap[reason]),
#     (4) `event: APP_EVENTS.INFO.X.Y` INSIDE a `.json({...})` call (res.status().json envelope).
#   Excluded (NOT UI — would false-positive otherwise): `eventName:` audit-log payloads
#   (recordAuditEvent_IO), `where: { event: ... }` Prisma eventLog queries, and any
#   APP_EVENTS.INFO.* merely referenced for server-side logging.
#   Events listed in `eventsDisallowedForUI` (read DYNAMICALLY from cqrs.config.ts —
#   suppressed query-success/noise events) are subtracted.
#
# Comments (// and /* */) are stripped before scanning so commented-out tokens never count.

set -u

source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)
LOCALES_DIR="$PROJECT_ROOT/main/src/locales"
APP_EVENTS_FILE="$PROJECT_ROOT/.shared-kernel/domain/events/app-events.const.ts"
CQRS_FILE="$PROJECT_ROOT/.shared-kernel/domain/commands-and-queries/cqrs.config.ts"
BACKEND_SRC="$PROJECT_ROOT/web-1/src"

print_boxed_header "I18N EVENTS — UI COVERAGE"

# Preconditions
for f in "$APP_EVENTS_FILE" "$CQRS_FILE"; do
    [[ -f "$f" ]] || { print_error "required file not found: $f"; exit 1; }
done
for locale in pl en de; do
    [[ -f "$LOCALES_DIR/$locale/events.json" ]] || { print_error "events.json missing for locale '$locale'"; exit 1; }
done
command -v node >/dev/null 2>&1 || { print_error "node is required for this audit"; exit 1; }

# The analysis is delegated to Node: it needs JSON parsing of the locale files,
# resolution of APP_EVENTS.INFO property paths to their string VALUES (which differ
# from the property name for a few events, e.g. CANNOT_DELETE_MAIN_POLICY →
# 'ADMIN_CANNOT_DELETE_MAIN_POLICY'), and balanced-paren scanning of respond*()/.json()
# calls. Pure grep/awk cannot do path→value resolution reliably. Node is a hard repo dep.
RESULT=$(APP_EVENTS_FILE="$APP_EVENTS_FILE" CQRS_FILE="$CQRS_FILE" \
         BACKEND_SRC="$BACKEND_SRC" LOCALES_DIR="$LOCALES_DIR" \
         node --input-type=module <<'NODE'
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const APP_EVENTS_FILE = process.env.APP_EVENTS_FILE;
const CQRS_FILE = process.env.CQRS_FILE;
const BACKEND_SRC = process.env.BACKEND_SRC;
const LOCALES_DIR = process.env.LOCALES_DIR;

// Strip // line comments (but not http://) and /* */ block comments.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// 1. Resolve APP_EVENTS.INFO.<GROUP>.<PROP> -> string value by evaluating the const.
let js = readFileSync(APP_EVENTS_FILE, 'utf8')
  .replace(/export const APP_EVENTS =/, 'const APP_EVENTS =')
  .replace(/as const;?\s*$/, ';')
  .replace(/\/\/[^\n]*/g, '');
let APP_EVENTS;
try {
  APP_EVENTS = new Function(js + '\nreturn APP_EVENTS;')();
} catch (e) {
  console.log('FATAL\tcould not evaluate APP_EVENTS const: ' + e.message);
  process.exit(0);
}
const pathToValue = {};
for (const [g, o] of Object.entries(APP_EVENTS.INFO || {}))
  for (const [p, v] of Object.entries(o)) pathToValue[`APP_EVENTS.INFO.${g}.${p}`] = v;

// 2. Read eventsDisallowedForUI DYNAMICALLY (so Lane G / future additions auto-apply).
const cqrs = readFileSync(CQRS_FILE, 'utf8');
const disallowedBlock = (cqrs.split('eventsDisallowedForUI')[1] || '').split('] as const)')[0] || '';
const disallowed = new Set(
  [...disallowedBlock.matchAll(/APP_EVENTS\.INFO\.[A-Z0-9_]+\.[A-Z0-9_]+/g)]
    .map((m) => pathToValue[m[0]])
    .filter(Boolean)
);

// 3. Scan backend source for UI-emitted INFO events.
let files = [];
try {
  files = execSync(
    `grep -rlE 'respond|\\.json\\(' "${BACKEND_SRC}" --include='*.ts' | grep -v READONLY-shared-kernel`,
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  ).split('\n').filter(Boolean);
} catch (e) {
  files = (e.stdout || '').split('\n').filter(Boolean);
}

const callInner = (src, openIdx) => {
  let i = openIdx, depth = 1;
  const start = i;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    i++;
  }
  return src.slice(start, i - 1);
};

const helperDefault = {
  respondForbidden: 'ACCESS_DENIED_INFO',
  respondUnauthorized: 'UNAUTHORIZED',
  respondPlanLimitReached: 'PLAN_LIMIT_REACHED_INFO',
  respondStaffAlreadyExists: 'STAFF_ALREADY_EXISTS',
  respondValidationFailed: 'VALIDATION_FAILED',
  respondGeneralError: 'GENERAL_ERROR',
  respondAccountNotFound: 'ACCOUNT_NOT_FOUND',
  respondUserNotFound: 'USER_NOT_FOUND',
  respondSuccess: 'SUCCESS',
  respondCreated: 'SUCCESS',
};

const emitted = new Set();
const addVal = (v) => { if (v && !disallowed.has(v)) emitted.add(v); };

const respondRe = /respond([A-Z][A-Za-z]*)\s*\(/g;
const jsonRe = /\.json\s*\(/g;

for (const f of files) {
  let raw;
  try { raw = readFileSync(f, 'utf8'); } catch { continue; }
  const src = stripComments(raw);

  // (1)+(2)+(3) respond*() helpers
  let m;
  respondRe.lastIndex = 0;
  while ((m = respondRe.exec(src))) {
    const helper = 'respond' + m[1];
    const inner = callInner(src, m.index + m[0].length);
    const toks = [...inner.matchAll(/APP_EVENTS\.INFO\.[A-Z0-9_]+\.[A-Z0-9_]+/g)].map((x) => x[0]);
    if (toks.length) {
      for (const t of toks) addVal(pathToValue[t]);
    } else if (helperDefault[helper]) {
      addVal(helperDefault[helper]); // (2) baked-in default
    }
    // (3) map variable passed as event arg: respondX(res, someMap[expr], ...)
    const idMatch = inner.match(/^\s*res\s*,\s*([A-Za-z_]\w*)\s*\[/);
    if (idMatch) {
      const def = src.split(idMatch[1] + ' =')[1];
      if (def) {
        const block = def.slice(0, def.indexOf('}') + 1);
        for (const t of block.matchAll(/APP_EVENTS\.INFO\.[A-Z0-9_]+\.[A-Z0-9_]+/g)) addVal(pathToValue[t[0]]);
      }
    }
  }

  // (4) res.json({ ... event: APP_EVENTS.INFO.X.Y ... }) envelope ONLY
  let j;
  jsonRe.lastIndex = 0;
  while ((j = jsonRe.exec(src))) {
    const inner = callInner(src, j.index + j[0].length);
    for (const t of inner.matchAll(/\bevent:\s*(APP_EVENTS\.INFO\.[A-Z0-9_]+\.[A-Z0-9_]+)/g))
      addVal(pathToValue[t[1]]);
  }
}

// 4. Compare against every locale's events.json keys.
const locales = ['pl', 'en', 'de'];
const keysByLocale = {};
for (const loc of locales)
  keysByLocale[loc] = new Set(Object.keys(JSON.parse(readFileSync(`${LOCALES_DIR}/${loc}/events.json`, 'utf8'))));

const emittedSorted = [...emitted].sort();
let missingTotal = 0;
const lines = [];
for (const v of emittedSorted) {
  const missingIn = locales.filter((loc) => !keysByLocale[loc].has(v));
  if (missingIn.length) {
    missingTotal++;
    lines.push(`MISSING\t${v}\t${missingIn.join(',')}`);
  }
}

console.log(`META\t${emitted.size}\t${disallowed.size}\t${files.length}`);
for (const l of lines) console.log(l);
NODE
)

# Parse Node output
META_LINE=$(echo "$RESULT" | grep -E '^META' | head -1)
FATAL_LINE=$(echo "$RESULT" | grep -E '^FATAL' | head -1)

if [[ -n "$FATAL_LINE" ]]; then
    print_error "$(echo "$FATAL_LINE" | cut -f2-)"
    exit 1
fi

EMITTED_COUNT=$(echo "$META_LINE" | cut -f2)
DISALLOWED_COUNT=$(echo "$META_LINE" | cut -f3)
SCANNED_FILES=$(echo "$META_LINE" | cut -f4)
MISSING_LINES=$(echo "$RESULT" | grep -E '^MISSING' || true)
MISSING_COUNT=$(echo "$MISSING_LINES" | grep -c '^MISSING' || true)
[[ -z "$EMITTED_COUNT" ]] && EMITTED_COUNT=0

echo -e "${BOLD}UI-emitted INFO events:${NC} ${EMITTED_COUNT}  (suppressed via eventsDisallowedForUI: ${DISALLOWED_COUNT}; scanned ${SCANNED_FILES} files)"
echo ""

if [[ "$MISSING_COUNT" -eq 0 ]]; then
    print_header "SUMMARY"
    echo -e "${GREEN}PASSED:${NC} every UI-emitted INFO event has a key in all locales (pl/en/de)"
    exit 0
fi

print_header "MISSING I18N KEYS (event reaches UI but has no translation)"
echo -e "${GRAY}event → locales missing the key${NC}\n"
echo "$MISSING_LINES" | while IFS=$'\t' read -r _ event locs; do
    echo -e "  ${RED}-${NC} ${BOLD}${event}${NC} ${GRAY}(missing in: ${locs})${NC}"
done

echo ""
print_header "SUMMARY"
echo -e "${RED}FAILED:${NC} ${MISSING_COUNT} UI-emitted event(s) have no translation key (user would see the raw token)"
echo -e "${YELLOW}Fix: add the key(s) to main/src/locales/{pl,en,de}/events.json${NC}"
echo -e "${YELLOW}     (or, if the event must not show a snackbar, add it to eventsDisallowedForUI in cqrs.config.ts)${NC}"
exit 1
