#!/usr/bin/env bash
# copy-llms-de.sh — Guard: German LLM index exists and is wired.
#
# INTENT:
#   Nailfolio ships curated LLM indexes in three languages. EN=`llms.txt`,
#   PL=`llms-pl.txt`, DE=`llms-de.txt`. The DE file was missing until the
#   2026-08-18 copy-unification; crawlers and robots must list it next to
#   the others. Do not invent llms-full-de.txt (full-concat stays EN).
#
# EXIT: 0 if PASS, 1 if the file or a wiring pointer is missing.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
FILE="${ROOT}/main/public/llms-de.txt"
ROBOTS="${ROOT}/main/public/robots.txt"
KERNEL="${ROOT}/.shared-kernel/domain/seo/ai-crawler-detection.ts"
GREP="${ROOT}/scripts/copy-grep.mjs"

print_boxed_header "LLM DE index: llms-de.txt exists and is wired" "de"

VIOLATIONS=0

if [[ ! -f "$FILE" ]]; then
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "Missing ${FILE}"
else
  print_success "main/public/llms-de.txt exists"
fi

if [[ -f "$ROBOTS" ]] && grep -q 'llms-de.txt' "$ROBOTS"; then
  print_success "robots.txt mentions llms-de.txt"
else
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "robots.txt must mention llms-de.txt next to llms.txt / llms-pl.txt"
fi

if [[ -f "$KERNEL" ]] && grep -q "'/llms-de.txt'" "$KERNEL"; then
  print_success "TRACKED_PATHS includes /llms-de.txt"
else
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "Add '/llms-de.txt' to TRACKED_PATHS in ${KERNEL}"
fi

if [[ -f "$GREP" ]] && grep -q 'llms-de.txt' "$GREP"; then
  print_success "copy:grep surfaces include llms-de.txt"
else
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "Add main/public/llms-de.txt to TEXT_SURFACES in scripts/copy-grep.mjs"
fi

print_separator
if [[ "$VIOLATIONS" -gt 0 ]]; then
  print_error "copy-llms-de FAILED — ${VIOLATIONS} wiring gap(s)"
  exit 1
fi
print_success "llms-de.txt present and wired (robots, TRACKED_PATHS, copy:grep)"
exit 0
