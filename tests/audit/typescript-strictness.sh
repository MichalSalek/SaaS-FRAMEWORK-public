#!/bin/bash

source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                      📋 TYPESCRIPT STRICTNESS AUDIT                          ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Directories to scan
SCAN_DIRS=(
  "$PROJECT_ROOT/main/src"
  "$PROJECT_ROOT/web-1/src"
  "$PROJECT_ROOT/.shared-kernel"
)

# Counters
ANY_COUNT=0
AS_ANY_COUNT=0
NON_NULL_COUNT=0
TS_IGNORE_COUNT=0
TS_EXPECT_ERROR_COUNT=0
TOTAL_VIOLATIONS=0

# PODZIAL PRACY Z ESLINTEM (rozstrzygniete pomiarem 2026-09-16, S121)
# ─────────────────────────────────────────────────────────────────────────────
# Od kiedy jadro ma wlasnego ESLinta (S120), czesc tego, co tu bylo, ma juz
# mocniejszego stroza. Wstrzyknalem po jednym naruszeniu kazdego wzorca do
# `.shared-kernel`, `main/src` i `web-1/src` i zmierzylem, kto je lapie:
#
#   wzorzec          ESLint    ten straznik
#   any / as any     CZERWONY  CZERWONY
#   non-null !       CZERWONY  CZERWONY
#   @ts-ignore       ZIELONY   CZERWONY   <- `ban-ts-comment` jest OFF w CALEJ trojce
#   @ts-expect-error ZIELONY   CZERWONY   <- j.w.
#   debugger         CZERWONY  ZIELONY    <- ten straznik mial tu FALSZYWA ZIELEN
#
# Stad dzisiejszy ksztalt:
#   - `@ts-ignore` / `@ts-expect-error` ZOSTAJA, bo ten straznik jest ich JEDYNA
#     mechaniczna obrona w calym repo. `@ts-ignore` jest przy tym grozniejszy niz
#     `any`: nie wygasa, gdy blad zniknie, wiec zostaje jako trwale wyciszenie.
#   - `any` / `as any` / `!` ZOSTAJA mimo pokrycia przez ESLinta, bo NIE jest to
#     duplikat: regule ESLinta otwiera `// eslint-disable-next-line`, a grepa nie
#     otwiera nic. To podloga bez klamki, nie druga kopia tej samej reguly.
#   - `debugger` WYPADA. Wzorzec wymagal slowa SAMOTNIE w linii, wiec `{ debugger; }`
#     przechodzil bez sladu — a straznik, ktory pod-skanuje, produkuje pewnosc
#     zamiast ochrony. ESLint (`no-debugger` z js.configs.recommended) lapie to
#     w kazdym ksztalcie i w kazdym z trzech zakresow; zmierzone, nie zalozone.
#
# Tego samego dnia wycofany zostal `kernel-ts-ignore.sh`: pilnowal WYLACZNIE
# `@ts-ignore` w `.shared-kernel`, czyli scisle podzbioru tego, co liczy ten plik.
# ─────────────────────────────────────────────────────────────────────────────

echo "🔍 Scanning for TypeScript violations..."
echo ""

# Files in scope — one census reused by every pattern (same exclusions as the
# raw greps below: node_modules, .next, generated Prisma js-client).
TS_FILES=()
for dir in "${SCAN_DIRS[@]}"; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r -d '' f; do TS_FILES+=("$f"); done < <(
    find "$dir" -type f \( -name '*.ts' -o -name '*.tsx' \) \
      -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/js-client/*' -print0
  )
done

# Comment-aware scans (2026-09-05): `: any`, `as any` and the non-null `!` are
# matched on the code with comment content blanked out (grep_code_stripped in
# _utils.sh, line numbers preserved). Prose that merely DESCRIBES the pattern —
# „Fail-open: any parse error", a JSDoc line, a {/* … */} in JSX — blocked
# git:push three times at a green tsc, and each time the „fix" was rephrasing
# the sentence. `@ts-expect-error` lives INSIDE a comment by definition, wiec
# ono jedno zostaje na surowym grepie.
ANY_HITS=""; AS_ANY_HITS=""; NON_NULL_HITS=""
if [[ ${#TS_FILES[@]} -gt 0 ]]; then
  ANY_HITS=$(grep_code_stripped ':\s*any([^a-zA-Z0-9_]|$)' "${TS_FILES[@]}")
  AS_ANY_HITS=$(grep_code_stripped '\bas\s+any\b' "${TS_FILES[@]}")
  # Pattern: value!.prop / value!?.prop / value![i] where `value` ends in a word
  # char, `)` or `]` — so `xs[0]!.trim()` and `fn()!.x` count too (the old
  # `\w+!` shape let index/call results through; a fixture caught it 2026-09-05).
  # Excludes != / !== / logical !x / !!x by shape; .d.ts files are ambient.
  NON_NULL_HITS=$(grep_code_stripped '(\w|\)|\])!\s*(\.|(\?\.)|\[)' "${TS_FILES[@]}" | grep -v '\.d\.ts:' || true)
fi
ANY_COUNT=$(printf '%s' "$ANY_HITS" | grep -c . || true)
AS_ANY_COUNT=$(printf '%s' "$AS_ANY_HITS" | grep -c . || true)
NON_NULL_COUNT=$(printf '%s' "$NON_NULL_HITS" | grep -c . || true)

# Count @ts-ignore (dyrektywa, nie wzmianka)
# DECISION (nie usuwaj tego komentarza):
# SLEPA PLAMA ZAMKNIETA — README tego katalogu opisywal ten straznik jako
# „No `any`, `!`, `@ts-ignore`, `@ts-expect-error`", a `@ts-ignore`
# nie byl liczony ANI RAZU: skrypt mial licznik tylko dla `@ts-expect-error`.
# Roznica jest istotna, bo `@ts-ignore` jest GORSZY — nie wygasa, gdy blad
# zniknie, wiec zostaje w kodzie jako trwale wyciszenie kompilatora. Repo mialo
# wiec zakaz w dokumentacji i zero egzekucji poza jadrem (`kernel-ts-ignore.sh`
# pilnuje WYLACZNIE `.shared-kernel`, czyli ~1/3 kodu).
# KSZTALT, NIE SAM TOKEN: dopasowanie idzie wzorem samego TypeScriptu —
# dyrektywa dziala tylko wtedy, gdy `@ts-ignore` stoi zaraz po znaczniku
# komentarza (`//`, `/*`, `*` w JSDoc, `{/*` w JSX). Surowy grep po tokenie
# dalby tu falszywke: jedyne wystapienie w repo to PROZA opisujaca sama regule
# (`main/src/types/vercel-og-node.d.ts:10` — „This declaration replaces a
# `@ts-ignore` on the import"). To ta sama klasa pomylki, ktora 2026-09-05
# trzykrotnie blokowala push na `: any` w komentarzu i doprowadzila do
# `grep_code_stripped`; tutaj strip nie pomoze, bo dyrektywa Z DEFINICJI zyje
# w komentarzu — dlatego rozstrzyga POZYCJA w komentarzu, nie sama obecnosc.
# POMIAR: przed = 0 wzorcow sprawdzanych. Po = 1 wzorzec, 0 trafien
# (1 wzmianka w prozie poprawnie POMINIETA). Baseline 0.
TS_IGNORE_PATTERN='(^[[:space:]]*(//|/\*+|\*)[[:space:]]*@ts-ignore|\{[[:space:]]*/\*[[:space:]]*@ts-ignore|//[[:space:]]*@ts-ignore)'
for dir in "${SCAN_DIRS[@]}"; do
  if [[ -d "$dir" ]]; then
    count=$(grep -rE "$TS_IGNORE_PATTERN" --include="*.ts" --include="*.tsx" "$dir" 2>/dev/null | \
            grep -v "node_modules" | grep -v ".next" | grep -v "js-client" | wc -l)
    TS_IGNORE_COUNT=$((TS_IGNORE_COUNT + count))
  fi
done

# Count @ts-expect-error
for dir in "${SCAN_DIRS[@]}"; do
  if [[ -d "$dir" ]]; then
    count=$(grep -r "@ts-expect-error" --include="*.ts" --include="*.tsx" "$dir" 2>/dev/null | \
            grep -v "node_modules" | grep -v ".next" | grep -v "js-client" | wc -l)
    TS_EXPECT_ERROR_COUNT=$((TS_EXPECT_ERROR_COUNT + count))
  fi
done

TOTAL_VIOLATIONS=$((ANY_COUNT + AS_ANY_COUNT + NON_NULL_COUNT + TS_IGNORE_COUNT + TS_EXPECT_ERROR_COUNT))

echo "📊 Results:"
echo ""
echo -e "  ${YELLOW}any types:${NC}              $ANY_COUNT"
echo -e "  ${YELLOW}as any casts:${NC}           $AS_ANY_COUNT"
echo -e "  ${YELLOW}non-null assertions (!):${NC} $NON_NULL_COUNT"
echo -e "  ${YELLOW}@ts-ignore:${NC}             $TS_IGNORE_COUNT"
echo -e "  ${YELLOW}@ts-expect-error:${NC}       $TS_EXPECT_ERROR_COUNT"
echo ""
echo -e "  ${BOLD}Total violations:${NC}       $TOTAL_VIOLATIONS"
echo ""

# Show violation locations if any exist
if [[ $TOTAL_VIOLATIONS -gt 0 ]]; then
  echo "📍 Violation locations:"
  echo ""
  for dir in "${SCAN_DIRS[@]}"; do
    if [[ -d "$dir" ]]; then
      # Show : any / as any / non-null violations (captured once above, all dirs)
      if [[ "$dir" == "${SCAN_DIRS[0]}" ]]; then
        [[ -n "$ANY_HITS" ]] && printf '%s\n' "$ANY_HITS" | sed "s|$PROJECT_ROOT/||" | while IFS= read -r line; do
          echo -e "  ${YELLOW}[any]${NC} $line"
        done
        [[ -n "$AS_ANY_HITS" ]] && printf '%s\n' "$AS_ANY_HITS" | sed "s|$PROJECT_ROOT/||" | while IFS= read -r line; do
          echo -e "  ${YELLOW}[as any]${NC} $line"
        done
        [[ -n "$NON_NULL_HITS" ]] && printf '%s\n' "$NON_NULL_HITS" | sed "s|$PROJECT_ROOT/||" | while IFS= read -r line; do
          echo -e "  ${YELLOW}[non-null !]${NC} $line"
        done
      fi
      # Show @ts-ignore violations
      if [[ $TS_IGNORE_COUNT -gt 0 ]]; then
        grep -rnE "$TS_IGNORE_PATTERN" --include="*.ts" --include="*.tsx" "$dir" 2>/dev/null | \
          grep -v "node_modules" | grep -v ".next" | grep -v "js-client" | \
          sed "s|$PROJECT_ROOT/||" | while IFS= read -r line; do
            echo -e "  ${RED}[@ts-ignore]${NC} $line"
          done
      fi
      # Show @ts-expect-error violations
      if [[ $TS_EXPECT_ERROR_COUNT -gt 0 ]]; then
        grep -rn "@ts-expect-error" --include="*.ts" --include="*.tsx" "$dir" 2>/dev/null | \
          grep -v "node_modules" | grep -v ".next" | grep -v "js-client" | \
          sed "s|$PROJECT_ROOT/||" | while IFS= read -r line; do
            echo -e "  ${YELLOW}[@ts-expect-error]${NC} $line"
          done
      fi
    fi
  done
  echo ""
fi

# Baseline (acceptable violations from legacy code)
# Updated 2026-02-04: 
# - any types: 255 → 252 → 0 (all fixed - Prisma generated files now excluded from audit)
# - as any: 1 → 0 (-1: proper type cast)
# - non-null (!): 589 → 0 (-589: improved detection + fixed all real violations)
#   Old pattern counted ALL ! (regex, logical not, !!, etc.) - 589 false positives
#   New pattern: \w+!\s*(\.|(\?\.)|\[) - detects only non-null assertions
#   All 25 real violations fixed with type guards and optional chaining
#   Prisma js-client generated files now excluded from all counts
BASELINE_ANY=0
BASELINE_AS_ANY=0
BASELINE_NON_NULL=0
BASELINE_TS_IGNORE=0
BASELINE_TS_EXPECT_ERROR=0
BASELINE_TOTAL=$((BASELINE_ANY + BASELINE_AS_ANY + BASELINE_NON_NULL + BASELINE_TS_IGNORE + BASELINE_TS_EXPECT_ERROR))

echo "📈 Baseline (legacy code):"
echo ""
echo -e "  ${GRAY}any types:${NC}              $BASELINE_ANY"
echo -e "  ${GRAY}as any casts:${NC}           $BASELINE_AS_ANY"
echo -e "  ${GRAY}non-null assertions (!):${NC} $BASELINE_NON_NULL"
echo -e "  ${GRAY}@ts-ignore:${NC}             $BASELINE_TS_IGNORE"
echo -e "  ${GRAY}@ts-expect-error:${NC}       $BASELINE_TS_EXPECT_ERROR"
echo ""
echo -e "  ${GRAY}Total baseline:${NC}         $BASELINE_TOTAL"
echo ""

# Check if violations increased
if [[ $TOTAL_VIOLATIONS -gt $BASELINE_TOTAL ]]; then
  INCREASE=$((TOTAL_VIOLATIONS - BASELINE_TOTAL))
  echo -e "${RED}❌ FAIL: TypeScript violations increased by $INCREASE${NC}"
  echo ""
  echo "New code should not introduce:"
  echo "  - any types (use proper types)"
  echo "  - as any casts (use type guards)"
  echo "  - non-null assertions (use optional chaining)"
  echo "  - @ts-ignore (never expires — use a real type, or @ts-expect-error at worst)"
  echo "  - @ts-expect-error (fix type errors properly)"
  echo ""
  exit 1
elif [[ $TOTAL_VIOLATIONS -lt $BASELINE_TOTAL ]]; then
  DECREASE=$((BASELINE_TOTAL - TOTAL_VIOLATIONS))
  echo -e "${GREEN}✅ PASS: TypeScript violations decreased by $DECREASE${NC}"
  echo ""
  echo "💡 Consider updating baseline in this script"
  echo ""
  exit 0
else
  echo -e "${GREEN}✅ PASS: No new TypeScript violations${NC}"
  echo ""
  exit 0
fi
