#!/usr/bin/env bash
# app-link-only.sh — internal links in main/src go through AppLinkAtom, never bare next/link.
#
# RULE: `from 'next/link'` is allowed ONLY in main/src/UI/components/AppLink/AppLink.atom.tsx.
#
# Why: next.config.mjs keeps `skipTrailingSlashRedirect: true` (PostHog posts to
# slashless /ingest paths), which puts Next in manual trailing-slash mode, so a
# bare <Link href="/blog"> renders `/blog` and every crawler hop goes through a
# 301 to the canonical `/blog/`. AppLinkAtom adds the slash to page hrefs
# (application/routing/page-href.ts). 2026-09-23: 56 files imported next/link
# directly; they were moved to AppLinkAtom in one codemod.
#
# Scan root: main/src (.ts/.tsx, tests excluded). Presence floor: AppLinkAtom
# import sites. Escape: `// app-link-allow: <reason>` in the file.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/main/src"
WRAPPER="${SRC_DIR}/UI/components/AppLink/AppLink.atom.tsx"

print_boxed_header "Links: AppLinkAtom only (canonical trailing slash)" "🔗"

require_source_dir "${SRC_DIR}" "main/src sources" "tsx"

if [[ ! -f "${WRAPPER}" ]]; then
  print_error "Wrapper missing: ${WRAPPER#"${ROOT}/"}"
  print_info "AppLinkAtom moved or was deleted — update this guard's anchor before trusting it."
  exit 1
fi

print_header "Scanning main/src for bare next/link imports"

VIOLATIONS=0
WRAPPER_IMPORTS=0
ALLOWED_FILES=0

while IFS= read -r file; do
  [[ "$file" == "${WRAPPER}" ]] && continue

  stripped=$(strip_comments_keep_lines "$file" || true)
  if [[ -z "$stripped" && -s "$file" ]]; then
    print_error "Nie udalo sie zdjac komentarzy z ${file#"${ROOT}/"} — audyt NIE zgaduje werdyktu"
    exit 1
  fi

  uses=$(printf '%s\n' "$stripped" | grep -cE "AppLinkAtom" || true)
  WRAPPER_IMPORTS=$((WRAPPER_IMPORTS + uses))

  hits=$(printf '%s\n' "$stripped" | grep -nE "from[[:space:]]+['\"]next/link['\"]" || true)
  [[ -z "$hits" ]] && continue

  if grep -qE 'app-link-allow:[[:space:]]*[^[:space:]]' "$file"; then
    ALLOWED_FILES=$((ALLOWED_FILES + 1))
    continue
  fi

  print_error "${file#"${ROOT}/"} — imports next/link directly instead of AppLinkAtom"
  printf '%s\n' "$hits" | sed 's/^/      /'
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(find "${SRC_DIR}" -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -name '*.test.ts' ! -name '*.test.tsx' ! -path '*/READONLY-shared-kernel/*' | sort)

require_scanned "${WRAPPER_IMPORTS}" "AppLinkAtom usages in main/src"

if [[ "${VIOLATIONS}" -gt 0 ]]; then
  print_separator
  print_error "${VIOLATIONS} file(s) import next/link directly"
  print_info "Fix: import { AppLinkAtom as Link } from '<rel>/UI/components/AppLink/AppLink.atom'"
  print_info "Deliberate exception: // app-link-allow: <reason>  (the reason is mandatory)"
  exit 1
fi

print_success "${WRAPPER_IMPORTS} AppLinkAtom usage(s), no bare next/link (${ALLOWED_FILES} documented exception(s))"
exit 0
