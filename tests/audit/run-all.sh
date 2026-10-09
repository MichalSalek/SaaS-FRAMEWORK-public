#!/bin/bash
set -e

# Source utilities
source "$(dirname "$0")/_utils.sh"

# Master header with project name
echo -e "\n${BOLD}${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║                    APP-FRAMEWORK AUDIT SUITE                 ║${NC}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"

# Initialize counters
# DECISION (nie usuwaj tego komentarza):
# SLEPA PLAMA ZAMKNIETA — skrypt z listy `SCRIPTS`, ktorego NIE MA na dysku,
# drukowal `[SKIP] not found` i nie podbijal ANI `PASSED`, ANI `FAILED`.
# Podsumowanie na koncu liczy jednak `TOTAL=${#SCRIPTS[@]}` (dlugosc listy)
# i przy `FAILED -eq 0` melduje „All $TOTAL audits completed successfully".
# Zdanie bylo wiec falszywe z definicji: usun plik straznika, zostaw wpis
# na liscie — i pakiet mowi „wszystkie N audytow zakonczone sukcesem", choc
# uruchomil N-1. To najgorsza mozliwa forma cichej utraty zasiegu, bo dotyczy
# BRAMKI ZBIORCZEJ, ktora odpala pre-push (`npm run git:push`): jeden `git rm`
# potrafil zdjac straznika z produkcji bez sladu w zielonym raporcie.
# Brak pliku jest teraz TWARDA AWARIA (liczony jako FAILED, z wlasnym logiem
# i wlasnym komunikatem), a na koncu stoi dodatkowo asercja arytmetyczna
# PASSED+FAILED == TOTAL — zeby zadna przyszla galaz nie mogla znow „zgubic"
# pozycji z listy bez zapalenia czerwonego.
PASSED=0
FAILED=0
MISSING=0
TOTAL=0
FAILED_SCRIPTS=()
START_TIME=$(date +%s)

# List of audit scripts to run
SCRIPTS=(
    "ssot-routes.sh"
    "ssot-events.sh"
    "permissions.sh"
    "dto-completeness.sh"
    "validation-coverage.sh"
    "batch-locale-discipline.sh"
    "i18n-coverage.sh"
    "kernel-sync.sh"
    "imports-health.sh"
    "import-aliases.sh"
    "env-governance.sh"
    "secret-discipline.sh"
    "rate-limit-tier.sh"
    "prisma-access.sh"
    "prisma-fk-index.sh"
    "prisma-redundant-index.sh"
    "prisma-error-narrowing.sh"
    "prisma-nested-sql.sh"
    "kernel-lint-gate.sh"
    "asset-ownership-gate.sh"
    "better-auth-dispatch-contract.sh"
    "lock-discipline.sh"
    "time-literals.sh"
    "dead-exports.sh"
    "handler-shape.sh"
    "noop-validation-allowlist.sh"
    "operation-io-suffix.sh"
    "database-failure.sh"
    "naming-case.sh"
    "sweep-interceptor.sh"
    "email-sweep-orderby.sh"
    "validation-i18n.sh"
    "typescript-strictness.sh"
    "legacy-code.sh"
    "security-idor.sh"
    "currentuser-enforcement.sh"
    "response-event-validation.sh"
    "no-body-cast.sh"
    "respond-arg-order.sh"
    "handler-method-consistency.sh"
    "auth-route-method.sh"
    "endpoint-completeness.sh"
    "registry-orphan.sh"
    "docs-ssot.sh"
    "events-i18n-parity.sh"
    "events-i18n-coverage.sh"
    "i18n-interpolation-parity.sh"
    "email-locale-parity.sh"
    "pagination-tiebreaker.sh"
    "event-log-registration.sh"
    "event-reader-writer.sh"
    "asset-paths.sh"
    "blog-copy-rules.sh"
    "blog-url-construction.sh"
    "app-link-only.sh"
    "forward-arrow-ownership.sh"
    "tabular-nums.sh"
    "min-font-size.sh"
    "openapi-fresh.sh"
    "gallery-junction-mapper.sh"
    "stylist-profile-seo.sh"
    "section-discipline.sh"
    "shape-tokens.sh"
    "edge-stripe-discipline.sh"
    "ink-focus-ring.sh"
    "disabled-text-contrast.sh"
    "scroll-reset-multistep.sh"
    "no-view-transition-api.sh"
    "navigation-controller-singleton.sh"
    "navigation-transition-ssot.sh"
    "main-content-parity.sh"
    "billing-copy-guards.sh"
    "copy-dashes.sh"
    "copy-de-sie.sh"
    "copy-llms-de.sh"
    "copy-phrase-blacklist.sh"
    "llms-md-fresh.sh"
    "raw-timestamp-interpolation.sh"
    "suppress-global-error.sh"
    "storage-keys.sh"
    "route-literals.sh"
    "brand-literals.sh"
    "dev-script-test-users.sh"
    "cp-recursive-nesting.sh"
    "compose-file-pairs.sh"
    "deploy-origin-parity.sh"
    "deploy-artifact-identity.sh"
    "io-layer.sh"
    "button-primitives.sh"
    "layout-consistency.sh"
    "auth-page-guard.sh"
    "aria-modal-focus-trap.sh"
    "hex-policy.sh"
    "eyebrow-headline-dup.sh"
    "no-sparkle.sh"
    "no-split-bg.sh"
    "tint-discipline.sh"
    "spacing-tokens.sh"
    "breakpoints.sh"
    "fluid-type.sh"
    "motion-tokens.sh"
    "atomic-coverage.sh"
    "ui-library-coverage.sh"
    "bundle-budget.sh"
    "circular-imports.sh"
    "dead-code.sh"
    "pricing-parity.sh"
    "enum-parity.sh"
    "archive-cascade-completeness.sh"
    "stripe-scope.sh"
    "stripe-ui-mode.sh"
    "stripe-claim-first.sh"
    "stripe-no-api-in-tx.sh"
    "audit-count.sh"
    "audit-selftest.sh"
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
            echo "Fix: restore the script, or remove the entry from run-all.sh AND package.json (npm run audit:audit-count keeps the counts honest)." \
                >> "/tmp/audit_${script_name}_$$"
            MISSING=$((MISSING + 1))
            FAILED=$((FAILED + 1))
            FAILED_SCRIPTS+=("$script_name")
        fi
    done
else
    echo -e "\n${BOLD}Running ${#SCRIPTS[@]} audit scripts (parallel)...${NC}\n"

    # Launch all audits as background jobs
    declare -a PIDS
    declare -a NAMES

    for i in "${!SCRIPTS[@]}"; do
        script="${SCRIPTS[$i]}"
        script_path="$AUDIT_DIR/$script"
        script_name=$(echo "$script" | sed 's/\.sh$//')

        if [[ -f "$script_path" ]]; then
            bash "$script_path" > "/tmp/audit_${script_name}_$$" 2>&1 &
            PIDS[$i]=$!
            NAMES[$i]="$script_name"
        else
            PIDS[$i]=0
            NAMES[$i]="$script_name"
        fi
    done

    # Wait for each PID and collect results (display in original order)
    for i in "${!SCRIPTS[@]}"; do
        script_name="${NAMES[$i]}"
        pid="${PIDS[$i]}"
        progress=$((i + 1))

        printf "${BOLD}[%d/%d]${NC} %s... " "$progress" "${#SCRIPTS[@]}" "$script_name"

        if [[ "$pid" == "0" ]]; then
            echo -e "${RED}[MISSING]${NC} listed in run-all.sh but not on disk"
            echo "AUDIT SUITE FAILED: ${script_name}.sh is listed in run-all.sh SCRIPTS but does not exist on disk." \
                > "/tmp/audit_${script_name}_$$"
            echo "Fix: restore the script, or remove the entry from run-all.sh AND package.json (npm run audit:audit-count keeps the counts honest)." \
                >> "/tmp/audit_${script_name}_$$"
            MISSING=$((MISSING + 1))
            FAILED=$((FAILED + 1))
            FAILED_SCRIPTS+=("$script_name")
            continue
        fi

        if wait "$pid"; then
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
    # NIE `SECONDS` — to wbudowana zmienna bash (sekundy od startu powłoki); przypisanie
    # do niej resetuje licznik i jest pułapką dla każdego, kto później zechce jej użyć.
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
        # DECISION (nie usuwaj tego komentarza) — dlaczego to nie jest `grep ❌ | tail -1`:
        # poprzednia wersja szukała glifu `❌` (U+274C), a `print_error` z `_utils.sh` emituje
        # `✗` (U+2717) — inny znak. Skutkiem był raport, w którym z padającego strażnika
        # zostawała WYŁĄCZNIE linia zawierająca dosłowne słowo "FAILED", a linie szczegółowe
        # („  - Nazwa (ścieżka)") nie pasowały do wzorca i ginęły. Do tego `cut -c1-60` liczyło
        # bajty RAZEM z sekwencjami ANSI, więc z sześćdziesięciu znaków widocznego tekstu
        # zostawało kilkanaście i komunikat urywał się w połowie słowa, a `sed 's/.*: //'`
        # jest zachłanne i ucinało treść po OSTATNIM dwukropku w zdaniu. Efekt: strażnik
        # blokował push i nie potrafił powiedzieć czego dotyczy — diagnoza wymagała ręcznego
        # odtwarzania awarii, która przy fladze równoległych sesji bywa nieodtwarzalna.
        log_file="/tmp/audit_${failed_script}_$$"
        if [[ -f "$log_file" ]]; then
            # Strip ANSI first, THEN match/limit — inaczej i wzorzec, i licznik znaków
            # widzą escape-sekwencje zamiast tekstu.
            # ESC przez printf, a klasa [[:space:]] zamiast \s — `\x1b` i `\s` to
            # rozszerzenia GNU, których BSD sed/grep (macOS) nie rozumie; ten pakiet
            # bywa odpalany także poza WSL-em, a strażnik cichnący na innym systemie
            # jest tą samą klasą co strażnik zielony nad pustką.
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

# DECISION (nie usuwaj tego komentarza) — osobny katalog na OSTATNIĄ PORAŻKĘ:
# `.audit-logs/<nazwa>.log` jest nadpisywany przy KAŻDYM przebiegu, a komunikat porażki
# (i nagłówek hooka pre-push) każe uruchomić `npm run audit:all` — czyli dokładnie to,
# co kasuje jedyny ślad po awarii. Przy strażniku, który pada rzadko i nieodtwarzalnie
# (wyścig z równoległą sesją), to zamyka diagnozę na amen: zanim zdążysz spojrzeć, dowodu
# już nie ma. `last-failure/` zapisujemy WYŁĄCZNIE gdy coś padło, więc kolejny zielony
# przebieg go nie tyka i log dożywa momentu, w którym ktoś go przeczyta.
if [[ $FAILED -gt 0 ]]; then
    FAILURE_DIR="$AUDIT_LOG_DIR/last-failure"
    # Katalog opisuje JEDNO zdarzenie, więc najpierw go czyścimy. Bez tego log
    # strażnika, który padł tydzień temu, leżałby obok dzisiejszego pod wspólnym
    # `_kiedy.txt` i sugerował, że oba padły naraz — czyli dowód kłamałby o zakresie
    # awarii. `rm -rf` tylko po sprawdzeniu, że ścieżka jest tą, którą sami zbudowaliśmy.
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

# Asercja arytmetyczna — podsumowanie ma prawo mowic „wszystkie", tylko jesli
# kazda pozycja z listy naprawde skonczyla sie werdyktem. Patrz DECISION na gorze.
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
