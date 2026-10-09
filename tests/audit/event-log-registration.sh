#!/bin/bash
# event-log-registration.sh — Ensure every audit event passed to recordAuditEvent_IO
# is registered in allowedEventLogTypes (event_log.config.ts).
#
# WHY (recurring class — r31 + this wave): recordAuditEvent_IO({ eventName }) runs the
# event through the policy gate GET_PERMISSION_APPROVAL_TO_PUSH_EVENT_LOG. If the event is
# NOT present in allowedEventLogTypes the gate returns false and the audit write is a
# SILENT NO-OP — a production audit hole with no error, no log, no trace. This audit makes
# that gap impossible to ship undetected.
#
# SCOPE / SAFETY (no false-positives — this audit blocks commits):
#   - Static `eventName: APP_EVENTS.INFO.<CAT>.<EVENT>` references are validated
#     (the last segment <EVENT> is checked against the registered set) — Step 3.
#   - DYNAMIC eventName values (e.g. `eventName: infoEvent`, `eventName: rule.infoEvent`)
#     cannot be resolved at the call-site, but their VALUES are static literals at the
#     SOURCE — so they are validated there instead of being silently skipped:
#       · Step 3b: every `infoEvent: '<EVENT>'` in email-schedule.config.ts (the values
#         that flow through trial-sweep/lifecycle `recordAuditEvent_IO({ eventName: rule.infoEvent })`).
#       · Step 3c: the `APP_EVENTS.INFO.<CAT>.<EVENT>` event arg of each `sendTransactionalEmail(...)`
#         caller (forwarded to `recordAuditEvent_IO({ eventName: infoEvent })` inside email-transactional.ts).
#         Extracted from INSIDE the call's balanced parens only — NOT a line window: a trailing
#         respondSuccess()/respondError() carries a response-envelope INFO event (the ~190 *_FETCHED /
#         CANNOT_* events) that is correctly absent from allowedEventLogTypes (never hits the gate);
#         harvesting it would be a false positive that blocks push. Only the in-parens event arg counts.
#     The per-call-site DYNAMIC lines are still reported as INFO for traceability.
#   - OUT OF SCOPE — writeRawEventLog_IO direct call-sites (admin-* operations): this helper
#     writes to the DB WITHOUT the policy gate (GET_PERMISSION_APPROVAL_TO_PUSH_EVENT_LOG lives in
#     recordAuditEvent_IO, not here). No gate → no silent-no-op class → nothing for this audit to
#     catch; its event arg is type-checked as EVENTS_ALL_TYPE. Validating it here would be a
#     false-positive generator (raw admin events need not be in allowedEventLogTypes by design).
#   - Multi-line `eventName:` (value wrapped onto the next line by prettier) is handled by
#     joining the continuation before matching.
#   - Event names contain digits (D1/D7/D14/D30/D60) — every regex uses [A-Z0-9_], not [A-Z_].
set -e
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
WEB1_SRC="${ROOT}/web-1/src"
CONFIG="${ROOT}/.shared-kernel/domain/event-log/event_log.config.ts"
EMAIL_SCHEDULE="${ROOT}/.shared-kernel/domain/email/email-schedule.config.ts"

print_boxed_header "Event-log registration audit (recordAuditEvent_IO → allowedEventLogTypes)"

FAIL=0
DYNAMIC=0
CALL_SITES=0

if [[ ! -f "$CONFIG" ]]; then
    print_error "event_log.config.ts not found at ${CONFIG}"
    exit 1
fi

# ── Step 1: parse the registered event set from allowedEventLogTypes ──
# Lines inside the bucket arrays are bare string literals: '   'SOME_EVENT',
# (Set membership only — bucket assignment is not validated here, the policy gate
#  derives the bucket from this same config via GET_EVENT_LOG_TYPE_FOR_EVENT_LOG.)
REGISTERED_TMP="$(create_temp_file event_log_registered)"
grep -oE "^[[:space:]]*'[A-Z_][A-Z0-9_]*'," "$CONFIG" \
    | grep -oE "'[A-Z_][A-Z0-9_]*'" | tr -d "'" | sort -u > "$REGISTERED_TMP"
REGISTERED_COUNT=$(grep -c . "$REGISTERED_TMP" || true)
print_info "Registered events in allowedEventLogTypes: ${REGISTERED_COUNT}"

# ── Step 2: collect every recordAuditEvent_IO call-site file ──
mapfile -t FILES < <(grep -rl 'recordAuditEvent_IO(' "$WEB1_SRC" --include='*.ts' 2>/dev/null || true)

if [[ ${#FILES[@]} -eq 0 ]]; then
    print_warning "No recordAuditEvent_IO call-sites found under web-1/src — nothing to audit"
    exit 0
fi

# ── Step 2b: build path→value map from app-events.const.ts via Node ──
# Resolves APP_EVENTS.INFO.<CAT>.<PROP> to its runtime string VALUE.
# Required because property-name ≠ value for some events
# (e.g. CANNOT_DELETE_MAIN_POLICY → 'ADMIN_CANNOT_DELETE_MAIN_POLICY').
# Pure grep against the last segment would produce a false-miss for those events.
APP_EVENTS_FILE="${ROOT}/.shared-kernel/domain/events/app-events.const.ts"
PATH_TO_VALUE_TMP="$(create_temp_file event_log_path_to_value)"
: > "$PATH_TO_VALUE_TMP"

if [[ ! -f "$APP_EVENTS_FILE" ]]; then
    print_error "app-events.const.ts not found at ${APP_EVENTS_FILE}"
    exit 1
fi

# Node evaluates the const and writes "PATH<TAB>VALUE" lines to stdout.
APP_EVENTS_FILE="$APP_EVENTS_FILE" node --input-type=module <<'NODE_PATH_RESOLVE' > "$PATH_TO_VALUE_TMP"
import { readFileSync } from 'fs';
const src = readFileSync(process.env.APP_EVENTS_FILE, 'utf8')
  .replace(/export const APP_EVENTS =/, 'const APP_EVENTS =')
  .replace(/as const;?\s*$/, ';')
  .replace(/\/\/[^\n]*/g, '');
let APP_EVENTS;
try { APP_EVENTS = new Function(src + '\nreturn APP_EVENTS;')(); }
catch (e) { process.stderr.write('WARN: could not eval APP_EVENTS: ' + e.message + '\n'); process.exit(0); }
for (const [g, o] of Object.entries(APP_EVENTS.INFO || {}))
  for (const [p, v] of Object.entries(o))
    process.stdout.write(`APP_EVENTS.INFO.${g}.${p}\t${v}\n`);
NODE_PATH_RESOLVE

# ── Step 3: extract eventName values + validate ──
# Perl per file:
#   - join `eventName:` + newline + indent  ->  `eventName: ` (handle prettier wrapping)
#   - emit "STATIC<TAB>FULL_PATH"  for  eventName: APP_EVENTS.INFO.<CAT>.<EVENT>
#   - emit "DYNAMIC<TAB>value"     for  eventName: <other-identifier>  (skip, report only)
MISSING_TMP="$(create_temp_file event_log_missing)"
: > "$MISSING_TMP"

for file in "${FILES[@]}"; do
    rel_path="${file#${ROOT}/}"
    CALL_SITES=$((CALL_SITES + 1))

    # Per-file extraction stream of "KIND\tVALUE" (VALUE = full path for STATIC)
    while IFS=$'\t' read -r kind value; do
        [[ -z "$kind" ]] && continue
        if [[ "$kind" == "DYNAMIC" ]]; then
            print_info "DYNAMIC eventName (skipped, not statically resolvable): ${rel_path} -> ${value}"
            DYNAMIC=$((DYNAMIC + 1))
            continue
        fi
        # STATIC — resolve full APP_EVENTS.INFO.CAT.PROP path to its runtime VALUE.
        # Falls back to the last segment if the path is not in the map
        # (defensive: new events not yet in app-events.const should still be checked
        #  by last-segment, preserving pre-existing behaviour for the common case
        #  where property-name = value).
        resolved=$(grep -F "${value}	" "$PATH_TO_VALUE_TMP" | cut -f2 | head -1)
        if [[ -z "$resolved" ]]; then
            # fallback: last segment (property-name = value, the common case)
            resolved="${value##*.}"
        fi
        # STATIC — check membership
        if ! grep -qxF "$resolved" "$REGISTERED_TMP"; then
            echo "${resolved}	${rel_path}" >> "$MISSING_TMP"
        fi
    done < <(perl -0777 -ne '
        # Collapse "eventName:" followed by a newline + indentation into one line.
        s/eventName:\s*\n\s*/eventName: /g;
        while (/eventName:\s*([A-Za-z_][A-Za-z_0-9.]*)/g) {
            my $val = $1;
            if ($val =~ /^APP_EVENTS\.INFO\.[A-Z_0-9]+\.[A-Z_0-9]+$/) {
                # Emit the full path — bash will resolve it to a runtime VALUE via
                # the path→value map built from app-events.const.ts (Step 2b).
                print "STATIC\t$val\n";
            } elsif ($val !~ /^APP_EVENTS\./) {
                # variable reference — cannot resolve statically
                print "DYNAMIC\t$val\n";
            }
            # (APP_EVENTS.* that is not the INFO.CAT.EVENT shape is ignored: defensive,
            #  recordAuditEvent_IO only accepts EVENT_INFO_TYPE so this should not occur.)
        }
    ' "$file")
done

# ── Step 3b: validate DYNAMIC email-schedule rule infoEvents at the source ──
# trial-sweep.phase.ts + the email lifecycle call recordAuditEvent_IO({ eventName: rule.infoEvent }).
# DYNAMIC at the call-site (skipped in Step 3) but every value is a static string literal
# `infoEvent: '<EVENT>'` in email-schedule.config.ts. Validate each so a new email rule with an
# unregistered infoEvent is caught (it would otherwise be a runtime silent no-op).
RULE_EVENTS=0
if [[ -f "$EMAIL_SCHEDULE" ]]; then
    while read -r ev; do
        [[ -z "$ev" ]] && continue
        RULE_EVENTS=$((RULE_EVENTS + 1))
        if ! grep -qxF "$ev" "$REGISTERED_TMP"; then
            echo "${ev}	${EMAIL_SCHEDULE#${ROOT}/} (email-schedule rule infoEvent)" >> "$MISSING_TMP"
        fi
    done < <(grep -oE "infoEvent: '[A-Z_][A-Z0-9_]*'" "$EMAIL_SCHEDULE" \
        | grep -oE "'[A-Z_][A-Z0-9_]*'" | tr -d "'" | sort -u)
    print_info "Email-schedule rule infoEvents validated: ${RULE_EVENTS}"
else
    print_warning "email-schedule.config.ts not found — skipping rule infoEvent validation"
fi

# ── Step 3c: validate sendTransactionalEmail event-arg literals at the source ──
# email-transactional.ts forwards its `infoEvent` param to recordAuditEvent_IO({ eventName: infoEvent })
# — DYNAMIC at that site. The value comes from each sendTransactionalEmail(...) caller, which passes
# a static APP_EVENTS.INFO.<CAT>.<EVENT> literal (3rd arg, typed EVENT_INFO_TYPE). Resolve via the
# path→value map and validate.
# PRECISION (must not false-FAIL — this gates push): only the token INSIDE the call's own balanced
# parentheses is captured (perl recursive (?1) matcher). A blanket line-window would also harvest a
# trailing respondSuccess()/respondError() in the SAME handler — those carry response-envelope INFO
# events (the ~190 *_FETCHED / CANNOT_* events) that are correctly NOT in allowedEventLogTypes
# (they never hit the gate), which would be a false positive. The event arg is the FIRST (and only)
# APP_EVENTS.INFO token inside the arg list; respond*() lives outside these parens, so it is excluded.
STX_EVENTS=0
mapfile -t STX_FILES < <(grep -rl 'sendTransactionalEmail(' "$WEB1_SRC" --include='*.ts' 2>/dev/null || true)
for file in "${STX_FILES[@]}"; do
    rel_path="${file#${ROOT}/}"
    while IFS= read -r fullpath; do
        [[ -z "$fullpath" ]] && continue
        STX_EVENTS=$((STX_EVENTS + 1))
        resolved=$(grep -F "${fullpath}	" "$PATH_TO_VALUE_TMP" | cut -f2 | head -1)
        [[ -z "$resolved" ]] && resolved="${fullpath##*.}"
        if ! grep -qxF "$resolved" "$REGISTERED_TMP"; then
            echo "${resolved}	${rel_path} (sendTransactionalEmail arg)" >> "$MISSING_TMP"
        fi
    done < <(perl -0777 -ne '
        # Match each sendTransactionalEmail(<balanced args>) and take the first
        # APP_EVENTS.INFO.<CAT>.<EVENT> token INSIDE those parens (the 3rd positional
        # arg). (?1) recurses into the captured group to balance nested parens in args,
        # so a trailing respondSuccess()/log() in the same statement block is never seen.
        while (/sendTransactionalEmail\s*(\((?:[^()]|(?1))*\))/g) {
            my $args = $1;
            if ($args =~ /(APP_EVENTS\.INFO\.[A-Z_0-9]+\.[A-Z_0-9]+)/) {
                print "$1\n";
            }
        }
    ' "$file" | sort -u)
done
print_info "sendTransactionalEmail event-args validated: ${STX_EVENTS}"

# ── Step 4: report ──
echo ""

if [[ $DYNAMIC -gt 0 ]]; then
    print_warning "${DYNAMIC} dynamic eventName value(s) skipped — verify manually they resolve to a registered INFO event at runtime"
fi

if [[ -s "$MISSING_TMP" ]]; then
    # Unique list of missing events (an event may be unregistered at multiple call-sites)
    MISSING_EVENTS=$(cut -f1 "$MISSING_TMP" | sort -u)
    MISSING_COUNT=$(echo "$MISSING_EVENTS" | grep -c . || true)

    print_error "EVENT-LOG REGISTRATION FAILED: ${MISSING_COUNT} event(s) passed to recordAuditEvent_IO are NOT in allowedEventLogTypes"
    echo ""
    while IFS= read -r ev; do
        [[ -z "$ev" ]] && continue
        echo -e "  ${RED}✗${NC} ${BOLD}${ev}${NC}"
        # show one example call-site
        site=$(grep -m1 -F "${ev}	" "$MISSING_TMP" | cut -f2)
        echo -e "      ${GRAY}used in: ${site}${NC}"
    done <<< "$MISSING_EVENTS"
    echo ""
    echo "  IMPACT: the policy gate (GET_PERMISSION_APPROVAL_TO_PUSH_EVENT_LOG) returns false"
    echo "          for these events → recordAuditEvent_IO is a SILENT NO-OP (audit not written)."
    echo ""
    echo "  HOW TO FIX:"
    echo "    1. Open .shared-kernel/domain/event-log/event_log.config.ts"
    echo "    2. Add each event to the correct EventLogTypeValue bucket (match a sibling event"
    echo "       in the same INFO.<CAT> namespace / domain — ACCOUNT, GALLERY, DOMAIN, ...)"
    echo "    3. Run 'npm run system:kernel' to propagate (VP/orchestrator does this once per wave)"
    echo ""
    exit 1
fi

print_success "Event-log registration passed — ${CALL_SITES} recordAuditEvent_IO file(s) + ${RULE_EVENTS} email-rule infoEvent(s) + ${STX_EVENTS} sendTransactionalEmail arg(s) validated, all registered"
exit 0
