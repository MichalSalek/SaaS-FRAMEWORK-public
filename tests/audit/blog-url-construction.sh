#!/usr/bin/env bash
# blog-url-construction.sh — every blog URL in main/src comes from ONE helper:
# main/src/application/blog/blog.urls.ts (on top of application/routing/locale-url.ts).
#
# RULE: no hand-built `${something}/blog...` template in main/src outside the helper.
#
# Why: a blog post lives in exactly one locale, so its URL needs that locale's
# prefix (`/en`, `/de`) and the trailing slash. On 2026-09-23 ten hand-built
# copies existed and only the sitemap got it right: the BlogPosting JSON-LD of
# every EN/DE post pointed `mainEntityOfPage` at a prefixless PL URL that
# returns 404, the EN category page carried a Polish name and PL links, and
# /en/rss.xml linked EN posts to 404s. Structured data and feeds are exactly
# what AI assistants and crawlers read, so the defect was invisible in the
# browser and loud to machines.
#
# Scan root: main/src (every .ts/.tsx except tests and the kernel mirror).
# Presence floor: helper CALL SITES, not files (a rename to zero must fail).
# Escape: `// blog-url-allow: <reason>` in the file (reason mandatory).

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/main/src"
HELPER="${SRC_DIR}/application/blog/blog.urls.ts"

print_boxed_header "Blog URLs: one locale-aware helper" "🔗"

require_source_dir "${SRC_DIR}" "main/src sources" "ts"

if [[ ! -f "${HELPER}" ]]; then
  print_error "Helper missing: ${HELPER#"${ROOT}/"}"
  print_info "The helper moved or was deleted — update this guard's anchor before trusting it."
  exit 1
fi

print_header "Scanning main/src for hand-built blog URLs"

VIOLATIONS=0
HELPER_CALLS=0
ALLOWED_FILES=0

while IFS= read -r file; do
  [[ "$file" == "${HELPER}" ]] && continue

  stripped=$(strip_comments_keep_lines "$file" || true)
  if [[ -z "$stripped" && -s "$file" ]]; then
    print_error "Nie udalo sie zdjac komentarzy z ${file#"${ROOT}/"} — audyt NIE zgaduje werdyktu"
    exit 1
  fi

  calls=$(printf '%s\n' "$stripped" \
    | grep -cE '(^|[^A-Za-z0-9_])blog(Index|Post|Category|Rss)(Url|Path)\(' || true)
  HELPER_CALLS=$((HELPER_CALLS + calls))

  hits=$(printf '%s\n' "$stripped" | grep -nE '\$\{[^}]+\}/blog([/`?#]|$)' || true)
  [[ -z "$hits" ]] && continue

  if grep -qE 'blog-url-allow:[[:space:]]*[^[:space:]]' "$file"; then
    ALLOWED_FILES=$((ALLOWED_FILES + 1))
    continue
  fi

  print_error "${file#"${ROOT}/"} — builds a blog URL by hand instead of using blog.urls.ts"
  printf '%s\n' "$hits" | sed 's/^/      /'
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(find "${SRC_DIR}" -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -name '*.test.ts' ! -name '*.test.tsx' ! -path '*/READONLY-shared-kernel/*' | sort)

require_scanned "${HELPER_CALLS}" "blog URL helper call sites in main/src"

if [[ "${VIOLATIONS}" -gt 0 ]]; then
  print_separator
  print_error "${VIOLATIONS} file(s) build blog URLs by hand"
  print_info "Fix: blogIndexUrl / blogPostUrl / blogCategoryUrl / blogRssPath from application/blog/blog.urls.ts"
  print_info "Deliberate exception: // blog-url-allow: <reason>  (the reason is mandatory)"
  exit 1
fi

print_success "${HELPER_CALLS} blog URL helper call site(s), no hand-built blog URLs (${ALLOWED_FILES} documented exception(s))"
exit 0
