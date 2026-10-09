#!/bin/bash

# SSOT Events Audit Script
# Checks if CQRS events are properly used in endpoints
# Updated to support APP_EVENTS constant (Object-based)
# 2026-07-10: INFO section is additionally swept REPO-WIDE for orphans (defined but
# referenced nowhere) — hard gate, baseline 0. See DECISION comments inline.

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Cleanup trap for interruption
TEMP_FILES=""
trap 'rm -f $TEMP_FILES; exit 1' INT TERM

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Shared utilities (extract_events_with_domain, extract_handler_events, extract_info_events)
source "$SCRIPT_DIR/_utils.sh"

CQRS_CONFIG="$PROJECT_ROOT/.shared-kernel/domain/commands-and-queries/cqrs.config.ts"
APP_EVENTS_CONST="$PROJECT_ROOT/.shared-kernel/domain/events/app-events.const.ts"
# DECISION (nie usuwaj tego komentarza):
# SLEPA PLAMA ZAMKNIETA — skan handlerow startowal z `pages/api/v1` (177 plikow),
# a handlery zyja rowniez POZA v1: `api/health/database.ts`,
# `api/health-check/index.ts`, `api/auth/[...all].ts`,
# `api/auth/native-oauth-start/[provider].ts`, `api/auth/dev-login/index.ts`,
# `api/auth/exchange-code/index.ts` — 6 plikow calkowicie niewidocznych.
# Kosztowalo to DWA razy:
#   (1) SZUM: kazdy przebieg meldowal 3 zdarzenia jako „UNUSED HANDLER EVENTS"
#       (DEV_LOGIN, INTERNAL_HEALTH_PUBLIC, USER_LOGOUT), a wszystkie trzy SA
#       uzywane — tyle ze w tych szesciu plikach. Ostrzezenie, ktore zawsze klamie,
#       uczy ignorowac ostrzezenia tej bramki w ogole.
#   (2) DZIURA W TWARDEJ BRAMCE: `UNDEFINED_HANDLER_COUNT` jest krytyczne i ma
#       lapac literowke w `eventName: APP_EVENTS.…`. W tych szesciu plikach nie
#       lapalo NICZEGO — literowka w handlerze logowania deweloperskiego albo
#       w bramce health przechodzila bez sladu.
# POMIAR: przed = 177 plikow skanowanych, 3 falszywe „UNUSED". Po = 183 pliki,
# 0 falszywych „UNUSED".
API_DIR="$PROJECT_ROOT/web-1/src/pages/api"

# Start timer
START_TIME=$(date +%s)

# Header with box
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║                          🔍 SSOT EVENTS AUDIT                               ║${NC}"
echo -e "${BOLD}║                        $(date '+%Y-%m-%d %H:%M:%S')                         ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo

# Validate required files exist
echo -e "${BLUE}📋 Validating environment...${NC}"

if [[ ! -f "$APP_EVENTS_CONST" ]]; then
    echo -e "  ${RED}❌ app-events.const.ts not found${NC}"
    echo -e "     Path: ...$(echo "$APP_EVENTS_CONST" | tail -c 50)"
    exit 1
fi

if [[ ! -d "$API_DIR" ]]; then
    echo -e "  ${RED}❌ API directory not found${NC}"
    echo -e "     Path: ...$(echo "$API_DIR" | tail -c 50)"
    exit 1
fi

echo -e "  ${GREEN}✅ All required files found${NC}"
echo

# Extract CQRS events by category from app-events.const.ts
echo -e "${BLUE}🔍 Scanning CQRS events from constants...${NC}"

# Extract COMMANDS, QUERIES, CONFIRMATIONS, and INFO events using shared awk-based parser.
# NOTE: Comparison uses leaf event names (not DOMAIN.EVENT) because leaf names
# are unique by construction in app-events.const.ts. If that invariant ever
# breaks, switch both SSOT and handler extraction to DOMAIN.EVENT format.
CQRS_COMMANDS=$(extract_handler_events "$APP_EVENTS_CONST" | awk -F'\t' '$1=="COMMANDS" {print $3}' | sort)
CQRS_QUERIES=$(extract_handler_events "$APP_EVENTS_CONST" | awk -F'\t' '$1=="QUERIES" {print $3}' | sort)
CQRS_CONFIRMATIONS=$(extract_handler_events "$APP_EVENTS_CONST" | awk -F'\t' '$1=="CONFIRMATIONS" {print $3}' | sort)
CQRS_INFO=$(extract_info_events "$APP_EVENTS_CONST" | awk -F'\t' '{print $3}' | sort)

# Combine COMMANDS, QUERIES, and CONFIRMATIONS for handler validation
HANDLER_EVENTS_ALLOWED=$(echo -e "$CQRS_COMMANDS\n$CQRS_QUERIES\n$CQRS_CONFIRMATIONS" | \
    grep -v "^$" | \
    sort | uniq || true)

if [[ -z "$HANDLER_EVENTS_ALLOWED" ]]; then
    echo -e "  ${YELLOW}⚠️  No CQRS handler events found in app-events.const.ts${NC}"
fi

if [[ -z "$CQRS_INFO" ]]; then
    echo -e "  ${YELLOW}⚠️  No INFO events found in app-events.const.ts${NC}"
fi

# Extract events used in endpoints by category
echo -e "${BLUE}🔍 Scanning endpoint implementations...${NC}"

# Handler events (eventName: APP_EVENTS.COMMANDS.DOMAIN.EVENT,
# QUERIES.DOMAIN.EVENT, or CONFIRMATIONS.EVENT — note: CONFIRMATIONS is flat, no DOMAIN level).
# Grep directly for eventName: APP_EVENTS pattern — no context window needed.
# DECISION (nie usuwaj tego komentarza):
# DRUGA POLOWA TEJ SAMEJ SLEPEJ PLAMY: samo poszerzenie katalogu nie wystarczylo,
# bo wzorzec wyciagania przyjmowal WYLACZNIE klucz `eventName:` (ksztalt
# `defineHandler`). Handler RAW sklada koperte recznie i pisze `event:` —
# `pages/api/v1/internal/health-public/index.ts:91` robi dokladnie to i dlatego
# INTERNAL_HEALTH_PUBLIC nadal raportowal sie jako „UNUSED" mimo poprawnego
# zasiegu. Alternatywa jest zakotwiczona w `APP_EVENTS.(COMMANDS|QUERIES|
# CONFIRMATIONS).`, wiec nie moze zlapac nic spoza SSOT (zmierzone: dokladnie
# 1 trafienie na `event:` w calym `pages/api`).
HANDLER_EVENTS_USED=$(find "$API_DIR" -name "*.ts" -type f 2>/dev/null | \
    xargs grep -hE "(eventName|event): APP_EVENTS\.(COMMANDS|QUERIES|CONFIRMATIONS)\." 2>/dev/null | \
    grep -v '^\s*//' | \
    sed -E "s/.*APP_EVENTS\.(COMMANDS|QUERIES)\.[A-Z_]+\.([A-Z_][A-Z0-9_]*).*/\2/" | \
    sed -E "s/.*APP_EVENTS\.CONFIRMATIONS\.([A-Z_][A-Z0-9_]*).*/\1/" | \
    sort | uniq || true)

# Response events (APP_EVENTS.INFO.DOMAIN.EVENT)
# Actual patterns: respondSuccess(res, data, APP_EVENTS.INFO...), eventName: APP_EVENTS.INFO...,
# respondCreated/respondNotFound/respondNotAcceptable with APP_EVENTS.INFO...
RESPONSE_EVENTS_USED=$(find "$API_DIR" -name "*.ts" -type f 2>/dev/null | \
    xargs grep -h "APP_EVENTS\.INFO\.[A-Z_]*\.[A-Z_]*" 2>/dev/null | \
    grep -vE '^\s*(//|\*)' | \
    grep -oE "APP_EVENTS\.INFO\.[A-Z_]+\.[A-Z_][A-Z0-9_]*" | \
    sed "s/.*APP_EVENTS\.INFO\.[A-Z_]*\.\([A-Z_][A-Z0-9_]*\)/\1/" | \
    sort | uniq || true)

if [[ -z "$HANDLER_EVENTS_USED" ]]; then
    echo -e "  ${YELLOW}⚠️  No handler events found in endpoint implementations${NC}"
fi

if [[ -z "$RESPONSE_EVENTS_USED" ]]; then
    echo -e "  ${YELLOW}⚠️  No response events found in endpoint implementations${NC}"
fi

# Count events
HANDLER_ALLOWED_COUNT=$(echo "$HANDLER_EVENTS_ALLOWED" | grep -v '^$' | wc -l)
HANDLER_USED_COUNT=$(echo "$HANDLER_EVENTS_USED" | grep -v '^$' | wc -l)
INFO_ALLOWED_COUNT=$(echo "$CQRS_INFO" | grep -v '^$' | wc -l)
RESPONSE_USED_COUNT=$(echo "$RESPONSE_EVENTS_USED" | grep -v '^$' | wc -l)

echo -e "${BOLD}📊 Discovery Results${NC}"
echo -e "  ${GREEN}✅ Handler events in CQRS:    ${BOLD}${HANDLER_ALLOWED_COUNT}${NC}"
echo -e "  ${GREEN}✅ Handler events used:       ${BOLD}${HANDLER_USED_COUNT}${NC}"
echo -e "  ${GREEN}✅ INFO events in CQRS:       ${BOLD}${INFO_ALLOWED_COUNT}${NC}"
echo -e "  ${GREEN}✅ Response events used:      ${BOLD}${RESPONSE_USED_COUNT}${NC}"
echo

# Create temp files for comparison
HANDLER_ALLOWED_TEMP=$(mktemp)
HANDLER_USED_TEMP=$(mktemp)
INFO_ALLOWED_TEMP=$(mktemp)
RESPONSE_USED_TEMP=$(mktemp)
TEMP_FILES="$HANDLER_ALLOWED_TEMP $HANDLER_USED_TEMP $INFO_ALLOWED_TEMP $RESPONSE_USED_TEMP"
trap 'rm -f $TEMP_FILES; exit 1' INT TERM
trap 'rm -f $TEMP_FILES' EXIT

echo "$HANDLER_EVENTS_ALLOWED" > "$HANDLER_ALLOWED_TEMP"
echo "$HANDLER_EVENTS_USED" > "$HANDLER_USED_TEMP"
echo "$CQRS_INFO" > "$INFO_ALLOWED_TEMP"
echo "$RESPONSE_EVENTS_USED" > "$RESPONSE_USED_TEMP"

# NEW: Validate cqrs.config.ts doesn't have hardcoded events (should use Object.values)
echo -e "${BLUE}🔍 Validating cqrs.config.ts integrity...${NC}"

# Check for hardcoded event strings in EVENTS object
# Look for string literals that are NOT inside Object.values() calls
# Pattern: 'STRING' or "STRING" but not Object.values(...)
HARDCODED_EVENTS=$(sed 's/\r$//' "$CQRS_CONFIG" | \
    sed -n '/export const EVENTS/,/} as const/p' | \
    grep -v '^\s*//' | \
    grep -v "import" | \
    sed 's/Object\.values([^)]*)/OBJECT_VALUES_PLACEHOLDER/g' | \
    grep -E "['\"][A-Z_][A-Z0-9_]*['\"]" || true)

HARDCODED_COUNT=$(echo "$HARDCODED_EVENTS" | grep -v '^$' | wc -l)

if [ "$HARDCODED_COUNT" -gt 0 ]; then
    echo -e "${RED}❌ HARDCODED EVENTS IN cqrs.config.ts (${BOLD}${HARDCODED_COUNT}${NC}${RED})${NC}"
    echo "$HARDCODED_EVENTS" | grep -v "^$" | head -5 | while IFS= read -r line; do
        [[ -n "$line" ]] || continue
        echo -e "  ${RED}❌ ${line}${NC}"
    done
    echo
    echo -e "  ${BLUE}💡 Actions:${NC}"
    echo -e "     • Use Object.values(APP_EVENTS.COMMANDS.DOMAIN) instead of hardcoded strings"
    echo -e "     • This ensures SSOT compliance"
    echo
else
    echo -e "  ${GREEN}✅ cqrs.config.ts uses Object.values (SSOT compliant)${NC}"
    echo
fi

# Handler events that by DESIGN have no endpoint of ours (documented out-of-band).
# DECISION (nie usuwaj tego komentarza): po zamknieciu slepej plamy zasiegu
# (pages/api zamiast pages/api/v1) i ksztaltu (`event:` obok `eventName:`)
# z trzech wiecznych „UNUSED" zostal jeden — i on JEST prawdziwy, tylko
# nienaprawialny: `USER_LOGOUT` obsluguje Better Auth na wlasnych trasach
# providera, poza naszym CQRS. Jest to udokumentowane w trzech miejscach
# (app-events.const.ts przy definicji, role-permissions.ts, user.dto.ts przy
# placeholderze DTO). Ostrzezenie, ktore NIGDY nie zgasnie, uczy ignorowac cala
# sekcje, wiec zdejmujemy je JAWNIE i z powodem — a nie przez sciszenie calego
# licznika. Kazde NOWE nieuzyte zdarzenie nadal zapali sie samo.
BY_DESIGN_HANDLERLESS=$(cat <<'HANDLERLESS'
USER_LOGOUT
HANDLERLESS
)

# Find unused handler events (defined but not used)
UNUSED_HANDLER_EVENTS=$(comm -23 "$HANDLER_ALLOWED_TEMP" "$HANDLER_USED_TEMP" | grep -v '^$' | grep -vxF "$BY_DESIGN_HANDLERLESS" || true)
UNUSED_HANDLER_COUNT=$(echo "$UNUSED_HANDLER_EVENTS" | grep -v '^$' | wc -l)

# Find undefined handler events (used but not defined in COMMANDS/QUERIES)
UNDEFINED_HANDLER_EVENTS=$(comm -13 "$HANDLER_ALLOWED_TEMP" "$HANDLER_USED_TEMP" | grep -v '^$' || true)
UNDEFINED_HANDLER_COUNT=$(echo "$UNDEFINED_HANDLER_EVENTS" | grep -v '^$' | wc -l)

# Find ORPHANED INFO events — repo-wide sweep (defined but referenced NOWHERE in code).
# DECISION (nie usuwaj tego komentarza): the old check compared INFO against
# response-events in api/v1 only and reported ~220 "unused" as a warning — a 3.5×
# overcount (INFO events legitimately live outside api/v1: DEV_LOGIN in pages/api/auth,
# INTERNAL_HEALTH_PUBLIC in a raw handler, USER_LOGOUT in account-state-guard, UI
# events-maps, error-mapper, email lifecycle). This sweep scans the WHOLE repo
# (main/src, web-1/src, .shared-kernel, tests, scripts) for either the event's quoted
# string VALUE or its dot-accessed property KEY (key ≠ value for a few events, e.g.
# CANNOT_DELETE_MAIN_POLICY → 'ADMIN_CANNOT_DELETE_MAIN_POLICY'). Pure registries do
# NOT count as usage — they exist solely because the event is defined and must be
# removed together with it: app-events.const.ts (definition),
# event-log-descriptions.config.ts (PL descriptions), locales/*/events.json (i18n;
# json files are outside the scanned --include set). Baseline was cleaned to 0 on
# 2026-07-10 (62 orphans removed), so any orphan found here is a NEW dead token and
# FAILS the audit (exit 1) — delete the event + its registry pairs, or wire it up.
echo -e "${BLUE}🔍 Repo-wide INFO orphan sweep...${NC}"

# key<TAB>value pairs for every INFO event, resolved by evaluating the const via Node
# (same pattern as event-log-registration.sh Step 2b — grep cannot resolve key≠value).
INFO_PAIRS=$(APP_EVENTS_FILE="$APP_EVENTS_CONST" node --input-type=module <<'NODE_INFO_PAIRS'
import { readFileSync } from 'fs';
const src = readFileSync(process.env.APP_EVENTS_FILE, 'utf8')
  .replace(/export const APP_EVENTS =/, 'const APP_EVENTS =')
  .replace(/as const;?\s*$/, ';')
  .replace(/\/\/[^\n]*/g, '');
let APP_EVENTS;
try { APP_EVENTS = new Function(src + '\nreturn APP_EVENTS;')(); }
catch (e) { process.stderr.write('WARN: could not eval APP_EVENTS: ' + e.message + '\n'); process.exit(1); }
for (const [g, o] of Object.entries(APP_EVENTS.INFO || {}))
  for (const [k, v] of Object.entries(o))
    process.stdout.write(`${k}\t${v}\n`);
NODE_INFO_PAIRS
)

# All quoted UPPER_SNAKE tokens in code (value usage), registries excluded.
USED_TOKENS_TEMP=$(mktemp)
TEMP_FILES="$TEMP_FILES $USED_TOKENS_TEMP"
{
    grep -rhoE "['\"\`][A-Z_][A-Z0-9_]*['\"\`]" \
        "$PROJECT_ROOT/main/src" "$PROJECT_ROOT/web-1/src" "$PROJECT_ROOT/.shared-kernel" \
        "$PROJECT_ROOT/tests" "$PROJECT_ROOT/scripts" \
        --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.sh' \
        --exclude-dir=node_modules --exclude-dir=READONLY-shared-kernel \
        --exclude=app-events.const.ts --exclude=event-log-descriptions.config.ts 2>/dev/null | \
        sed -E "s/^['\"\`]//; s/['\"\`]$//"
    # All dot-accessed UPPER_SNAKE properties in TS (key usage, e.g. I.GALLERY.ASSET_UPLOADED).
    grep -rhoE "\.[A-Z_][A-Z0-9_]*" \
        "$PROJECT_ROOT/main/src" "$PROJECT_ROOT/web-1/src" "$PROJECT_ROOT/.shared-kernel" \
        "$PROJECT_ROOT/tests" "$PROJECT_ROOT/scripts" \
        --include='*.ts' --include='*.tsx' \
        --exclude-dir=node_modules --exclude-dir=READONLY-shared-kernel \
        --exclude=app-events.const.ts 2>/dev/null | sed 's/^\.//'
} | sort -u > "$USED_TOKENS_TEMP"

ORPHAN_INFO_EVENTS=$(while IFS=$'\t' read -r key val; do
    [[ -z "$val" ]] && continue
    if ! grep -qxF "$key" "$USED_TOKENS_TEMP" && ! grep -qxF "$val" "$USED_TOKENS_TEMP"; then
        echo "$val"
    fi
done <<< "$INFO_PAIRS")
ORPHAN_INFO_COUNT=$(echo "$ORPHAN_INFO_EVENTS" | grep -c . || true)

# Find undefined response events (used but not defined in INFO)
UNDEFINED_RESPONSE_EVENTS=$(comm -13 "$INFO_ALLOWED_TEMP" "$RESPONSE_USED_TEMP" | grep -v '^$' || true)
UNDEFINED_RESPONSE_COUNT=$(echo "$UNDEFINED_RESPONSE_EVENTS" | grep -v '^$' | wc -l)

# Report analysis
echo -e "${BOLD}🔍 Event Usage Analysis${NC}"
echo "────────────────────────────────────────────────────────────────────────────────"

# Report unused handler events (WARNING)
if [ "$UNUSED_HANDLER_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  UNUSED HANDLER EVENTS (${BOLD}${UNUSED_HANDLER_COUNT}${NC}${YELLOW})${NC}"
    echo "$UNUSED_HANDLER_EVENTS" | grep -v "^$" | while IFS= read -r event; do
        [[ -n "$event" ]] || continue
        short_event=$(echo "$event" | sed 's/^\(.\{30\}\).*/\1.../')
        echo -e "  ${YELLOW}⚠️  ${short_event}${NC}"
    done
    echo
    echo -e "  ${BLUE}💡 Actions:${NC}"
    echo -e "     • Remove unused events from app-events.const.ts COMMANDS/QUERIES"
    echo -e "     • Or implement missing endpoints"
    echo
else
    echo -e "  ${GREEN}✅ All CQRS handler events are used in endpoints${NC}"
    echo
fi

# Report undefined handler events (ERROR)
if [ "$UNDEFINED_HANDLER_COUNT" -gt 0 ]; then
    echo -e "${RED}❌ UNDEFINED HANDLER EVENTS (${BOLD}${UNDEFINED_HANDLER_COUNT}${NC}${RED})${NC}"
    echo "$UNDEFINED_HANDLER_EVENTS" | grep -v "^$" | while IFS= read -r event; do
        [[ -n "$event" ]] || continue
        short_event=$(echo "$event" | sed 's/^\(.\{30\}\).*/\1.../')
        echo -e "  ${RED}❌ ${short_event}${NC}"
    done
    echo
    echo -e "  ${BLUE}💡 Actions:${NC}"
    echo -e "     • Add missing events to app-events.const.ts COMMANDS or QUERIES"
    echo -e "     • Or fix typos in endpoint eventName declarations"
    echo
else
    echo -e "  ${GREEN}✅ All handler events are defined in CQRS${NC}"
    echo
fi

# Report orphaned INFO events (ERROR — repo-wide, baseline 0; see DECISION at the sweep)
if [ "$ORPHAN_INFO_COUNT" -gt 0 ]; then
    echo -e "${RED}❌ ORPHANED INFO EVENTS (${BOLD}${ORPHAN_INFO_COUNT}${NC}${RED}) — defined but referenced nowhere in code${NC}"
    echo "$ORPHAN_INFO_EVENTS" | grep -v "^$" | while IFS= read -r event; do
        [[ -n "$event" ]] || continue
        echo -e "  ${RED}❌ ${event}${NC}"
    done
    echo
    echo -e "  ${BLUE}💡 Actions:${NC}"
    echo -e "     • Delete the event from app-events.const.ts INFO + its registry pairs"
    echo -e "       (event-log-descriptions.config.ts, locales/*/events.json), then npm run system:kernel"
    echo -e "     • Or wire the event up (emit it) if it was meant to be used"
    echo
else
    echo -e "  ${GREEN}✅ No orphaned INFO events (repo-wide sweep)${NC}"
    echo
fi

# Report undefined response events (ERROR — see DECISION near CRITICAL_ISSUES)
if [ "$UNDEFINED_RESPONSE_COUNT" -gt 0 ]; then
    echo -e "${RED}❌ UNDEFINED RESPONSE EVENTS (${BOLD}${UNDEFINED_RESPONSE_COUNT}${NC}${RED})${NC}"
    echo "$UNDEFINED_RESPONSE_EVENTS" | grep -v "^$" | while IFS= read -r event; do
        [[ -n "$event" ]] || continue
        short_event=$(echo "$event" | sed 's/^\(.\{30\}\).*/\1.../')
        echo -e "  ${RED}❌ ${short_event}${NC}"
    done
    echo
    echo -e "  ${BLUE}💡 Actions:${NC}"
    echo -e "     • Add missing events to app-events.const.ts INFO section"
    echo -e "     • Or fix typos in getInfoEventWithPayloadDTO event declarations"
    echo
else
    echo -e "  ${GREEN}✅ All response events are defined in INFO${NC}"
    echo
fi

# Calculate execution time
END_TIME=$(date +%s)
EXECUTION_TIME=$((END_TIME - START_TIME))

# Summary
echo "════════════════════════════════════════════════════════════════════════════════"
echo -e "${BOLD}📊 SUMMARY${NC}"
echo "────────────────────────────────────────────────────────────────────────────────"
echo -e "  ${BLUE}Handler events (COMMANDS+QUERIES): ${BOLD}${HANDLER_ALLOWED_COUNT}${NC}"
echo -e "  ${BLUE}Handler events used:              ${BOLD}${HANDLER_USED_COUNT}${NC}"
echo -e "  ${BLUE}INFO events:                      ${BOLD}${INFO_ALLOWED_COUNT}${NC}"
echo -e "  ${BLUE}Response events used:             ${BOLD}${RESPONSE_USED_COUNT}${NC}"
echo -e "  ${BLUE}Unused handler events:            ${BOLD}${UNUSED_HANDLER_COUNT}${NC}"
echo -e "  ${BLUE}Undefined handler events:         ${BOLD}${UNDEFINED_HANDLER_COUNT}${NC}"
echo -e "  ${BLUE}Orphaned INFO events (repo-wide): ${BOLD}${ORPHAN_INFO_COUNT}${NC}"
echo -e "  ${BLUE}Undefined response events:        ${BOLD}${UNDEFINED_RESPONSE_COUNT}${NC}"
echo -e "  ${BLUE}Hardcoded events in cqrs.config:  ${BOLD}${HARDCODED_COUNT}${NC}"
echo -e "  ${BLUE}Execution time:                   ${BOLD}${EXECUTION_TIME}s${NC}"
echo

# Calculate total critical issues.
# DECISION (nie usuwaj tego komentarza): a used-but-undefined RESPONSE event
# (UNDEFINED_RESPONSE_COUNT) is now CRITICAL — symmetric with undefined handler
# events. A handler that emits APP_EVENTS.INFO.X.Y absent from app-events.const.ts
# means a runtime response references a non-existent SSOT key (the client receives
# an `event` envelope that no i18n/handling layer can resolve), so it must FAIL the
# build, not warn. Genuinely-advisory 'unused' findings (UNUSED_HANDLER_COUNT) stay
# warnings — they don't break a contract, they only flag dead/aspirational events.
# DECISION (nie usuwaj tego komentarza): ORPHAN_INFO_COUNT is CRITICAL (hard gate).
# The repo-wide sweep has a 0 baseline (2026-07-10 census: 62 dead INFO tokens +
# registry pairs removed), scans every real usage surface (quoted value OR dot-accessed
# key, whole repo) and excludes only pure registries — so a hit is a genuinely dead
# token, not an api/v1 blind spot. Dead SSOT tokens rot: they accrete description/i18n
# pairs and mislead greps, so they fail the build instead of warning.
CRITICAL_ISSUES=$((UNDEFINED_HANDLER_COUNT + HARDCODED_COUNT + UNDEFINED_RESPONSE_COUNT + ORPHAN_INFO_COUNT))
WARNING_ISSUES=$((UNUSED_HANDLER_COUNT))

if [ "$CRITICAL_ISSUES" -eq 0 ]; then
    if [ "$WARNING_ISSUES" -eq 0 ]; then
        echo -e "${GREEN}✅ AUDIT PASSED${NC} - All events properly defined and used"
        echo -e "   ${GREEN}🎉 No action items required${NC}"
    else
        echo -e "${YELLOW}⚠️  AUDIT PASSED WITH WARNINGS${NC} - ${BOLD}${WARNING_ISSUES}${NC} warning issues"
        echo -e "   ${YELLOW}📋 Warning action items: ${BOLD}${WARNING_ISSUES}${NC}"
    fi
    echo
    exit 0
else
    echo -e "${RED}❌ AUDIT FAILED${NC} - ${BOLD}${CRITICAL_ISSUES}${NC} critical issues found"
    echo -e "   ${RED}📋 Critical action items: ${BOLD}${CRITICAL_ISSUES}${NC}"
    echo -e "   ${YELLOW}📋 Warning action items: ${BOLD}${WARNING_ISSUES}${NC}"
    echo
    exit 1
fi
