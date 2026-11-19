#!/bin/bash
set -e

# Source utilities
source "$(dirname "$0")/_utils.sh"

# Master header with project name
echo -e "\n${BOLD}${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║                    NAILFOLIO SOURCE AUDITS                   ║${NC}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"

# Initialize counters
# DECISION: a script on the `SCRIPTS` list that is missing on disk is a HARD failure (counted as
# FAILED, with its own log and message), and the end asserts PASSED+FAILED == TOTAL. It used to
# print `[SKIP] not found` and bump neither counter, while the summary still said "All $TOTAL audits
# completed successfully" from the list length: `git rm` a guard, keep the list entry, and the
# pre-push suite reported N audits having run N-1. The arithmetic assertion stops any future branch
# from silently losing a list item.
PASSED=0
FAILED=0
MISSING=0
TOTAL=0
FAILED_SCRIPTS=()
START_TIME=$(date +%s)

# List of audit scripts to run
SCRIPTS=(
    "kernel-sync.sh"
    "kernel-lint-gate.sh"
    "css-guards.sh"
    "contracts.sh"
    "stripe.sh"
    "pagination.sh"
    "schema.sh"
    "i18n.sh"
    "generated-fresh.sh"
    "asset-ownership.sh"
    "auth-page-guard.sh"
    "better-auth-contract.sh"
)

TOTAL=${#SCRIPTS[@]}
AUDIT_DIR="$(dirname "$0")"

# Check for --sequential flag
SEQUENTIAL=false
if [[ "${1:-}" == "--sequential" ]]; then
    SEQUENTIAL=true
fi

if $SEQUENTIAL; then
    echo -e "\n${BOLD}Running ${#SCRIPTS[@]} audit scripts (sequential)...${NC}\n"

    for i in "${!SCRIPTS[@]}"; do
        script="${SCRIPTS[$i]}"
        script_path="$AUDIT_DIR/$script"
        progress=$((i + 1))

        if [[ -f "$script_path" ]]; then
            script_name=$(echo "$script" | sed 's/\.sh$//')
            printf "${BOLD}[%d/%d]${NC} Running %s... " "$progress" "${#SCRIPTS[@]}" "$script_name"

            if bash "$script_path" > "/tmp/audit_${script_name}_$$" 2>&1; then
                echo -e "${GREEN}✅${NC}"
                PASSED=$((PASSED + 1))
            else
                echo -e "${RED}❌${NC}"
                FAILED=$((FAILED + 1))
                FAILED_SCRIPTS+=("$script_name")
            fi
        else
            script_name=$(echo "$script" | sed 's/\.sh$//')
            printf "${BOLD}[%d/%d]${NC} %s... " "$progress" "${#SCRIPTS[@]}" "$script_name"
            echo -e "${RED}[MISSING]${NC} $script listed in run-all.sh but not on disk"
            echo "AUDIT SUITE FAILED: $script is listed in run-all.sh SCRIPTS but does not exist on disk." \
                > "/tmp/audit_${script_name}_$$"
            echo "Fix: restore the script, or remove the entry from run-all.sh AND package.json." \
                >> "/tmp/audit_${script_name}_$$"
            MISSING=$((MISSING + 1))
            FAILED=$((FAILED + 1))
            FAILED_SCRIPTS+=("$script_name")
        fi
    done
else
    # DECISION: a bounded job pool, not one process per audit at once. The suite used to start
    # every script together (118 processes, several of them node/tsx/eslint), so on a small runner
    # (a 2-4 core CI box, or this machine under a parallel session) each audit competed with all
    # the others. AUDIT_JOBS overrides the bound; the default (the CPU count) measured as fast as or
    # faster than unbounded on 2 and 4 cores (tests/audit/README.md, "How they run"). Each job writes its exit code to a file, so the pool
    # needs neither `wait -n` nor `wait -p` (bash 4.3 / 5.1; macOS ships bash 3.2).
    MAX_JOBS="${AUDIT_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
    echo -e "\n${BOLD}Running ${#SCRIPTS[@]} audit scripts (parallel, at most ${MAX_JOBS} at a time)...${NC}\n"

    declare -a NAMES
    for i in "${!SCRIPTS[@]}"; do
        script="${SCRIPTS[$i]}"
        script_path="$AUDIT_DIR/$script"
        script_name=$(echo "$script" | sed 's/\.sh$//')
        NAMES[$i]="$script_name"
        rm -f "/tmp/audit_${script_name}_$$.rc"
        [[ -f "$script_path" ]] || continue
        while [[ "$(jobs -rp | wc -l)" -ge "$MAX_JOBS" ]]; do
            sleep 0.05
        done
        (
            bash "$script_path" > "/tmp/audit_${script_name}_$$" 2>&1
            echo $? > "/tmp/audit_${script_name}_$$.rc"
        ) &
    done
    wait

    # Collect results in the original order.
    for i in "${!SCRIPTS[@]}"; do
        script_name="${NAMES[$i]}"
        progress=$((i + 1))

        printf "${BOLD}[%d/%d]${NC} %s... " "$progress" "${#SCRIPTS[@]}" "$script_name"

        if [[ ! -f "$AUDIT_DIR/${SCRIPTS[$i]}" ]]; then
            echo -e "${RED}[MISSING]${NC} listed in run-all.sh but not on disk"
            echo "AUDIT SUITE FAILED: ${script_name}.sh is listed in run-all.sh SCRIPTS but does not exist on disk." \
                > "/tmp/audit_${script_name}_$$"
            echo "Fix: restore the script, or remove the entry from run-all.sh AND package.json." \
                >> "/tmp/audit_${script_name}_$$"
            MISSING=$((MISSING + 1))
            FAILED=$((FAILED + 1))
            FAILED_SCRIPTS+=("$script_name")
            continue
        fi

        rc="$(cat "/tmp/audit_${script_name}_$$.rc" 2>/dev/null || echo missing)"
        rm -f "/tmp/audit_${script_name}_$$.rc"
        if [[ "$rc" == "0" ]]; then
            echo -e "${GREEN}✅${NC}"
            PASSED=$((PASSED + 1))
        else
            echo -e "${RED}❌${NC}"
            FAILED=$((FAILED + 1))
            FAILED_SCRIPTS+=("$script_name")
        fi
    done
fi

END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))

# Format total time
if [[ $TOTAL_TIME -lt 60 ]]; then
    TIME_STR="${TOTAL_TIME}s"
else
    MINUTES=$((TOTAL_TIME / 60))
    # NOT `SECONDS`: it is a bash builtin (seconds since shell start); assigning to it
    # resets the counter and is a trap for anyone who later wants to use it.
    REM_SECONDS=$((TOTAL_TIME % 60))
    TIME_STR="${MINUTES}m ${REM_SECONDS}s"
fi

echo

# Display dashboard summary
print_dashboard "$PASSED" "$FAILED" "$TIME_STR"

# Show failed audits with brief reasons
if [[ $FAILED -gt 0 ]]; then
    echo -e "\n${BOLD}${RED}Failed Audits:${NC}"
    for failed_script in "${FAILED_SCRIPTS[@]}"; do
        echo -e "   ${RED}❌ $failed_script${NC}"

        # Show the failing lines from the log.
        #
        # DECISION: the failing lines are extracted from the log with ANSI stripped FIRST, then
        # matched and limited. `print_error` in `_utils.sh` emits `✗` (U+2717), not `❌`, so the
        # old `grep ❌ | tail -1` kept only the line with the literal word "FAILED" and lost the
        # detail lines; `cut -c1-60` counted bytes including ANSI sequences, cutting messages
        # mid-word, and the greedy `sed 's/.*: //'` dropped everything before the LAST colon.
        # The result was a guard that blocked a push without saying what it was about.
        log_file="/tmp/audit_${failed_script}_$$"
        if [[ -f "$log_file" ]]; then
            # Strip ANSI first, THEN match/limit; otherwise both the pattern and the character
            # count see escape sequences instead of text.
            # ESC via printf and the [[:space:]] class instead of \s: `\x1b` and `\s` are GNU
            # extensions BSD sed/grep (macOS) do not understand; this suite is also run outside
            # WSL, and a guard that goes quiet on another system is the same class as a guard
            # that is green over nothing.
            ESC="$(printf '\033')"
            reason=$(sed -E "s/${ESC}\[[0-9;]*m//g" "$log_file" \
                     | grep -E "(FAILED|ERROR|✗|❌)" \
                     | grep -vE "^[[:space:]]*$" \
                     | tail -6 \
                     | cut -c1-160)
            if [[ -n "$reason" ]]; then
                while IFS= read -r rline; do
                    echo -e "      ${YELLOW}→ ${rline}${NC}"
                done <<< "$reason"
            fi
        fi
    done
    echo

    echo -e "${YELLOW}  Pełne logi padających strażników (przetrwają kolejny przebieg):${NC}"
    for failed_script in "${FAILED_SCRIPTS[@]}"; do
        echo -e "   ${BLUE}.audit-logs/last-failure/${failed_script}.log${NC}"
    done
    echo
    echo -e "${YELLOW}  Albo odpal pojedynczo:${NC}"
    for failed_script in "${FAILED_SCRIPTS[@]}"; do
        echo -e "   ${BLUE}./tests/audit/${failed_script}.sh${NC}"
    done
fi

echo

# Save logs for debugging, then clean temp files
AUDIT_LOG_DIR="$(get_project_root)/.audit-logs"
mkdir -p "$AUDIT_LOG_DIR"
for script_name_log in "${SCRIPTS[@]}"; do
    sname=$(echo "$script_name_log" | sed 's/\.sh$//')
    tmp_log="/tmp/audit_${sname}_$$"
    if [[ -f "$tmp_log" ]]; then
        cp "$tmp_log" "$AUDIT_LOG_DIR/${sname}.log"
    fi
done

# DECISION: failures are copied to a separate `last-failure/` directory. `.audit-logs/<name>.log`
# is overwritten on EVERY run, and the failure message (and the pre-push hook header) tells you to
# re-run `npm run audit:all`, which erases the only trace of a rare, non-reproducible failure
# (e.g. a race with a parallel session). `last-failure/` is written only when something failed, so
# a later green run does not touch it.
if [[ $FAILED -gt 0 ]]; then
    FAILURE_DIR="$AUDIT_LOG_DIR/last-failure"
    # The directory describes ONE event, so it is cleared first. Otherwise the log of a guard
    # that failed last week would sit next to today's under a shared `_kiedy.txt` and suggest
    # both failed at once, and the evidence would lie about the scope of the failure. `rm -rf`
    # only after checking the path is the one we built ourselves.
    if [[ "$FAILURE_DIR" == *"/.audit-logs/last-failure" && -d "$FAILURE_DIR" ]]; then
        rm -rf "${FAILURE_DIR:?}"
    fi
    mkdir -p "$FAILURE_DIR"
    for failed_script in "${FAILED_SCRIPTS[@]}"; do
        tmp_log="/tmp/audit_${failed_script}_$$"
        [[ -f "$tmp_log" ]] && cp "$tmp_log" "$FAILURE_DIR/${failed_script}.log"
    done
    date -u '+%Y-%m-%dT%H:%M:%SZ' > "$FAILURE_DIR/_kiedy.txt"
fi

rm -f /tmp/audit_*_$$

# Arithmetic assertion: the summary may say "all" only if every list entry really ended
# with a verdict. See the DECISION at the top.
if [[ $((PASSED + FAILED)) -ne $TOTAL ]]; then
    print_error "AUDIT SUITE FAILED: rozjazd licznikow — PASSED($PASSED) + FAILED($FAILED) != TOTAL($TOTAL). Ktoras pozycja listy nie dostala werdyktu."
    exit 1
fi

# Exit status
if [[ $FAILED -gt 0 ]]; then
    if [[ $MISSING -gt 0 ]]; then
        print_error "AUDIT SUITE FAILED: $FAILED out of $TOTAL audits failed (w tym $MISSING BRAKUJACYCH skryptow z listy)"
    else
        print_error "AUDIT SUITE FAILED: $FAILED out of $TOTAL audits failed"
    fi
    exit 1
else
    print_success "AUDIT SUITE PASSED: All $TOTAL audits ran and completed successfully"
    exit 0
fi
