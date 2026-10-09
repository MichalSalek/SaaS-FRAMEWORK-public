#!/usr/bin/env bash
# eyebrow-headline-dup.sh — Guard against re-introducing per-page duplicates of
# the canonical section-header primitives (.sectionEyebrow + .sectionHeadline).
#
# INTENT:
#   components/SectionHeader (Eyebrow + <h2>.title + lede) and
#   components/Eyebrow are the single source of truth for section kickers and
#   headlines on landing/static pages. Before FDX W5.1 the pattern was copy-
#   pasted as `.sectionEyebrow` + `.sectionHeadline` class pairs across ~10
#   page CSS modules, each drifting on font-size / line-height / tracking.
#   The consolidation migrated every pair to <SectionHeader>; per-page scale
#   now flows through CSS custom-property hooks on the wrapper
#   (--section-headline-size / -leading / -tracking / -measure), NOT through
#   re-defining the class block. This audit makes the regression hard: any new
#   `.sectionHeadline {` / `.sectionEyebrow {` class definition in
#   features/**/*.module.css fails the build unless the file is explicitly
#   allowlisted (a deliberate, DECISION-documented exception).
#
# WHAT IT CHECKS:
#   Class DEFINITIONS (a rule-opening selector `.sectionHeadline {` or
#   `.sectionEyebrow {`, optionally compound like `.foo .sectionHeadline {`)
#   in ANY stylesheet under main/src that is NOT in the allowlist.
#   Comment lines and className *usages* in .tsx are not class definitions and
#   are not matched.
#
# SCOPE: KAZDY arkusz `*.css` pod main/src.
#
# DECISION (nie usuwaj tego komentarza):
#   SLEPA PLAMA ZAMKNIETA — do tej zmiany skan startowal z
#   `main/src/UI/features`, czyli obejmowal 113 z 185 arkuszy `*.module.css`
#   (plus 0 z 3 arkuszy globalnych). Poza siecia zostawaly `components/` (62
#   pliki), `layouts/` (7) i `primitives/` (3) — a wsrod nich KANONICZNY
#   wlasciciel wzorca, `components/SectionHeader/`. Straznik pilnowal wiec
#   kopii, nie widzac oryginalu: duplikat wstawiony do drugiego komponentu
#   w `components/` (najbardziej prawdopodobne miejsce, bo tam mieszka
#   primitive) przechodzil bez sladu.
#   POMIAR: przed = 113 plikow skanowanych, po = 188 (185 modulowych + 3
#   globalne). Naruszen po rozszerzeniu: 0 — bramka pozostaje zielona, ale
#   teraz zielen dotyczy calej domeny, a nie jej wiekszej polowy.
#   Zasieg definiuje to, CZYM plik jest (arkuszem stylu), a nie GDZIE lezy —
#   lekcja przejeta 1:1 z siostrzanego `hex-policy.sh` (S109/S110): lista
#   katalogow do utrzymania znika, a nowy katalog stylow jest objety strazem
#   od pierwszego dnia.
#
# ALLOWLIST — intentional, DECISION-documented exceptions only:
#   (none — every page migrated to <SectionHeader> + var-override hooks)
#
# EXIT: 0 if PASS, 1 if violations found (with file:line list).

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/main/src"

print_boxed_header "Eyebrow/Headline duplication guard" "🔠"

# Allowlist of page CSS modules permitted to keep a custom .sectionHeadline /
# .sectionEyebrow definition. Each entry MUST carry a `DECISION` comment in the
# CSS explaining why the canonical SectionHeader could not be used. Paths are
# relative to ROOT.
ALLOWLIST=()

declare -a CSS_FILES=()
if [[ -d "$SRC_DIR" ]]; then
  while IFS= read -r -d $'\0' f; do
    CSS_FILES+=("$f")
  done < <(find "$SRC_DIR" -type f -name "*.css" -print0 2>/dev/null \
    | grep -zv "/node_modules/\|/\.next/\|/out/\|/dist/")
fi

# Zero plikow = zielen nad pustka, nie do odroznienia od zieleni zapracowanej.
if [[ "${#CSS_FILES[@]}" -eq 0 ]]; then
  print_error "Zero arkuszy .css w ${SRC_DIR#"${ROOT}/"} — straznik raportowalby „passed” nad pustka"
  exit 1
fi

print_header "Scanning ${#CSS_FILES[@]} stylesheet(s) for duplicated section-header classes"

VIOLATIONS=0
VIOLATION_LINES=""

# Match a rule-opening selector for .sectionHeadline / .sectionEyebrow:
#   ^.sectionHeadline {            (bare)
#   ^.foo .sectionHeadline {       (compound, leading selector)
#   ^.foo .sectionEyebrow::before {(pseudo on the class)
# Anchored to a line that both contains the class token as a selector and ends
# in `{` — this excludes comment prose and .tsx className usages.
PATTERN='^[[:space:]]*\.[A-Za-z0-9_ .:>+~-]*\.section(Headline|Eyebrow)([[:space:]]|::|:|\.|,)*[^;{]*\{[[:space:]]*$|^[[:space:]]*\.section(Headline|Eyebrow)([[:space:]]|::|:|\.|,)*[^;{]*\{[[:space:]]*$'

for file in "${CSS_FILES[@]}"; do
  REL_PATH="${file#${ROOT}/}"

  SKIP=0
  for allowed in "${ALLOWLIST[@]}"; do
    if [[ "$REL_PATH" == "$allowed" ]]; then
      SKIP=1
      break
    fi
  done
  [[ "$SKIP" -eq 1 ]] && continue

  MATCHING_LINES=$(grep -nE "$PATTERN" "$file" 2>/dev/null || true)

  if [[ -n "$MATCHING_LINES" ]]; then
    LINES=$(echo "$MATCHING_LINES" | cut -d: -f1 | sort -un | tr '\n' ',' | sed 's/,$//')
    VIOLATION_LINES="${VIOLATION_LINES}${REL_PATH}:${LINES}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION — ${REL_PATH} at line(s): ${LINES}"
    echo "$MATCHING_LINES" | head -3 | while IFS= read -r line; do
      print_info "    $(echo "$line" | sed 's/^[[:space:]]*//')"
    done
    print_info "  Fix: render the kicker+headline via <SectionHeader> and steer"
    print_info "       per-page scale with --section-headline-size / -leading /"
    print_info "       -tracking / -measure on the wrapper className. Drop this"
    print_info "       local .sectionHeadline/.sectionEyebrow definition."
  fi
done

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "eyebrow-headline-dup audit FAILED — ${VIOLATIONS} file(s) with duplicate section-header classes"
  print_info  "Canonical primitives: main/src/UI/components/SectionHeader + components/Eyebrow"
  echo ""
  exit 1
fi

print_success "eyebrow-headline-dup audit PASSED — no per-page section-header duplicates"
exit 0
