#!/bin/bash

source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                         📋 LEGACY CODE AUDIT                                 ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

SCAN_DIRS=(
  "$PROJECT_ROOT/main/src"
  "$PROJECT_ROOT/web-1/src"
  "$PROJECT_ROOT/.shared-kernel"
)

# Counters
TODO_COUNT=0
DEPRECATED_COUNT=0
CONSOLE_COUNT=0
ESLINT_DISABLE_COUNT=0
TOTAL_ISSUES=0

echo "🔍 Scanning for legacy patterns..."
echo ""

# Count TODO/FIXME (excluding Prisma generated)
# PLANS_TODO excluded: references to the docs/PLANS_TODO directory in comments
# are pointers to plan files, not TODO markers (false-positive class).
for dir in "${SCAN_DIRS[@]}"; do
  if [[ -d "$dir" ]]; then
    count=$(grep -r "TODO\|FIXME\|HACK\|XXX" --include="*.ts" --include="*.tsx" "$dir" 2>/dev/null | \
            grep -v "node_modules" | grep -v ".next" | grep -v "prisma.*js-client" | grep -v "PLANS_TODO" | wc -l)
    TODO_COUNT=$((TODO_COUNT + count))
  fi
done

# Count deprecated patterns.
# NOTE (FDX FAZA 2): a `@deprecated` JSDoc tag is an INTENTIONAL TypeScript
# deprecation marker tied to a removal plan (e.g. the old createIOFunction family
# is @deprecated in W2.1 and deleted in W2.5). That is the audit's goal — code
# marked for removal — not a legacy smell. We therefore exclude lines bearing the
# `@deprecated` tag and only count loose "deprecated" mentions (descriptive prose
# left rotting without an action; prefer "retired"/"superseded" there).
for dir in "${SCAN_DIRS[@]}"; do
  if [[ -d "$dir" ]]; then
    count=$(grep -r "deprecated" --include="*.ts" --include="*.tsx" "$dir" 2>/dev/null | \
            grep -v "@deprecated" | \
            grep -v "node_modules" | grep -v ".next" | grep -v "prisma" | wc -l)
    DEPRECATED_COUNT=$((DEPRECATED_COUNT + count))
  fi
done

# Count console.log/error (excluding tests and reportIssue internals)
#
# DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
# Liczymy po ODCIĘCIU KOMENTARZY (`grep_code_stripped`). Wcześniej `grep -r` liczył
# każdą WZMIANKĘ, więc komentarz tłumaczący, DLACZEGO w danym miejscu stoi
# `console.error`, podbijał licznik tak samo jak realne wywołanie. Skutek jest
# przewrotny: strażnik karał za dokumentowanie wyjątku i nagradzał za milczenie,
# a przy progu opartym na baseline wypychał wprost do podbicia baseline'u zamiast
# do wyjaśnienia. Zmierzone: `application/debugger/log-sink-health.ts` dawał
# 4 trafienia przy 2 realnych wywołaniach — reszta to proza DECISION.
for dir in "${SCAN_DIRS[@]}"; do
  if [[ -d "$dir" ]]; then
    mapfile -t SCAN_FILES < <(find "$dir" \( -name '*.ts' -o -name '*.tsx' \) \
      -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/tests/*' 2>/dev/null)
    if [[ ${#SCAN_FILES[@]} -gt 0 ]]; then
      count=$(grep_code_stripped 'console\.(log|error)' "${SCAN_FILES[@]}" 2>/dev/null | \
              grep -v "reportIssue" | wc -l)
      CONSOLE_COUNT=$((CONSOLE_COUNT + count))
    fi
  fi
done

# Count eslint-disable comments
for dir in "${SCAN_DIRS[@]}"; do
  if [[ -d "$dir" ]]; then
    count=$(grep -r "eslint-disable" --include="*.ts" --include="*.tsx" "$dir" 2>/dev/null | \
            grep -v "node_modules" | grep -v ".next" | grep -v "prisma" | wc -l)
    ESLINT_DISABLE_COUNT=$((ESLINT_DISABLE_COUNT + count))
  fi
done

TOTAL_ISSUES=$((TODO_COUNT + DEPRECATED_COUNT + CONSOLE_COUNT + ESLINT_DISABLE_COUNT))

echo "📊 Results:"
echo ""
echo -e "  ${YELLOW}TODO/FIXME comments:${NC}    $TODO_COUNT"
echo -e "  ${YELLOW}Deprecated patterns:${NC}    $DEPRECATED_COUNT"
echo -e "  ${YELLOW}console.log/error:${NC}      $CONSOLE_COUNT"
echo -e "  ${YELLOW}eslint-disable:${NC}         $ESLINT_DISABLE_COUNT"
echo ""
echo -e "  ${BOLD}Total legacy issues:${NC}    $TOTAL_ISSUES"
echo ""

# Show violation locations when count exceeds baseline
show_violations() {
  local pattern="$1"
  local label="$2"
  local current="$3"
  local baseline="$4"

  if [[ $current -gt $baseline ]]; then
    echo -e "  ${YELLOW}[$label] new violations:${NC}"
    for dir in "${SCAN_DIRS[@]}"; do
      if [[ -d "$dir" ]]; then
        grep -rn "$pattern" --include="*.ts" --include="*.tsx" "$dir" 2>/dev/null | \
          grep -v "node_modules" | grep -v ".next" | grep -v "prisma.*js-client" | grep -v "tests/" | grep -v "reportIssue" | grep -v "PLANS_TODO" | \
          sed "s|$PROJECT_ROOT/||" | while IFS= read -r line; do
            echo -e "    ${YELLOW}$line${NC}"
          done
      fi
    done
    echo ""
  fi
}

# Baseline (acceptable from existing code)
BASELINE_TODO=7  # Updated 2026-06-25: ratchet 10→7 (closes slack to current actual)
BASELINE_DEPRECATED=0  # Updated 2026-02-11: deprecated patterns removed
# DECISION (nie usuwaj): Baseline reflects intentional console.error sites (recursion guards in reportIssueBackend, etc).
# Plan burndown: post-launch, audit each site → replace with pushToEventLog or document as truly necessary.
# Nie podnosic baseline bez approval — kazda zmiana wymaga uzasadnienia w commit msg.
# S113 2026-09-10: 19→21. Dwa NOWE, celowe wywołania w
# `web-1/src/application/debugger/log-sink-health.ts` — podręcznikowy przypadek, dla
# którego ten baseline w ogóle istnieje. Czujnik pilnuje zapisu do składu logów; kiedy
# ten zapis pada, zgłoszenie przez `reportIssueBackend` byłoby REKURENCJĄ kończącą się
# kolejną nieudaną próbą zapisu. Alarm musi więc wyjść kanałem bez bazy: stdout procesu
# (PM2/Render) plus PostHog. Oba wywołania są dławione do progów będących potęgami
# dziesiątki, więc trwała awaria nie zaleje logów. Nie jest to dług do spłaty —
# to jedyny poprawny kształt dead-man's switcha dla loggera.
BASELINE_CONSOLE=21  # 2026-06-25: ratchet 28→19; 2026-09-10: 19→21 (dead-man's switch składu logów)
BASELINE_ESLINT_DISABLE=0  # Updated 2026-05-19: eslint-disable moved to config overrides (2→0)
BASELINE_TOTAL=$((BASELINE_TODO + BASELINE_DEPRECATED + BASELINE_CONSOLE + BASELINE_ESLINT_DISABLE))

echo "📈 Baseline (existing code):"
echo ""
echo -e "  ${GRAY}TODO/FIXME:${NC}             $BASELINE_TODO"
echo -e "  ${GRAY}Deprecated:${NC}             $BASELINE_DEPRECATED"
echo -e "  ${GRAY}console.log/error:${NC}      $BASELINE_CONSOLE"
echo -e "  ${GRAY}eslint-disable:${NC}         $BASELINE_ESLINT_DISABLE"
echo ""
echo -e "  ${GRAY}Total baseline:${NC}         $BASELINE_TOTAL"
echo ""

# Check each category independently (prevents cross-category compensation)
FAIL=0
FAIL_DETAILS=""

if [[ $TODO_COUNT -gt $BASELINE_TODO ]]; then
  FAIL=1
  FAIL_DETAILS="${FAIL_DETAILS}\n  - TODO/FIXME increased: $TODO_COUNT (baseline: $BASELINE_TODO)"
fi

if [[ $DEPRECATED_COUNT -gt $BASELINE_DEPRECATED ]]; then
  FAIL=1
  FAIL_DETAILS="${FAIL_DETAILS}\n  - Deprecated increased: $DEPRECATED_COUNT (baseline: $BASELINE_DEPRECATED)"
fi

if [[ $CONSOLE_COUNT -gt $BASELINE_CONSOLE ]]; then
  FAIL=1
  FAIL_DETAILS="${FAIL_DETAILS}\n  - console.log/error increased: $CONSOLE_COUNT (baseline: $BASELINE_CONSOLE)"
fi

if [[ $ESLINT_DISABLE_COUNT -gt $BASELINE_ESLINT_DISABLE ]]; then
  FAIL=1
  FAIL_DETAILS="${FAIL_DETAILS}\n  - eslint-disable increased: $ESLINT_DISABLE_COUNT (baseline: $BASELINE_ESLINT_DISABLE)"
fi

if [[ $FAIL -eq 1 ]]; then
  echo -e "${RED}❌ FAIL: Legacy code increased in one or more categories${NC}"
  echo -e "$FAIL_DETAILS"
  echo ""
  echo "New code should not introduce:"
  echo "  - TODO/FIXME comments (complete implementation)"
  echo "  - Deprecated patterns (use modern alternatives)"
  echo "  - console.log/error (use reportIssue)"
  echo "  - eslint-disable (fix lint issues properly)"
  echo ""
  exit 1
elif [[ $TOTAL_ISSUES -lt $BASELINE_TOTAL ]]; then
  DECREASE=$((BASELINE_TOTAL - TOTAL_ISSUES))
  echo -e "${GREEN}✅ PASS: Legacy code decreased by $DECREASE${NC}"
  echo ""
  echo "💡 Consider updating baseline in this script"
  echo ""
  exit 0
else
  echo -e "${GREEN}✅ PASS: No new legacy code${NC}"
  echo ""
  exit 0
fi
