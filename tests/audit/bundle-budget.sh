#!/usr/bin/env bash
# bundle-budget.sh — Static perf-hygiene guard (FDX FAZA 7 / W7.1).
#
# INTENT:
#   A true per-route First-Load-JS budget needs a full `next build` (too slow for
#   the per-commit audit suite). This guard instead locks the cheap STATIC
#   invariants that keep the measured baseline (tests/perf/baseline.md) honest:
#     1. optimizePackageImports must cover the heavy barrel libs — drop one and
#        every barrel import (e.g. 242 phosphor-icon imports) stops tree-shaking,
#        ballooning first-load JS silently.
#     2. Zero raw <img> in components/features — next/image (AVIF/WebP + lazy +
#        reserved dims, CLS=0) is the contract.
#   Full per-route budget = `npm run analyze` (manual/CI), not this guard.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)
MAIN_SRC="$PROJECT_ROOT/main/src"
NEXT_CONFIG="$PROJECT_ROOT/main/next.config.mjs"
violations=0

print_boxed_header "BUNDLE BUDGET (perf-hygiene)" "📦"

# 1. optimizePackageImports must cover the heavy barrel libs.
REQUIRED_OPT=(
  "@phosphor-icons/react"
  "@tanstack/react-query"
  "next-intl"
)
for pkg in "${REQUIRED_OPT[@]}"; do
  if ! grep -q "optimizePackageImports" "$NEXT_CONFIG" ||
    ! grep -qF "'$pkg'" "$NEXT_CONFIG"; then
    print_error "next.config optimizePackageImports nie pokrywa '$pkg' — barrel-importy przestaną się tree-shake'ować (bloat first-load JS)."
    violations=$((violations + 1))
  fi
done

# 2. Zero raw <img> tags in components/features (use next/image).
# DECISION (nie usuwaj tego komentarza): the old literal `<img ` (trailing space)
#   grep silently missed every multiline/tabbed `<img\n  src=…` — all 12 raw tags
#   in the codebase are written that way, so the gate caught NONE of them. Broadened
#   to `<img` followed by whitespace/`>`/EOL (awk, `<img[ \t\r>]|<img$`) so the
#   guard actually sees multiline JSX. The legitimate opt-out convention here is the
#   per-tag `eslint-disable … @next/next/no-img-element <reason>` comment (user-CDN /
#   Cloudinary / data-URL QR images where next/image is wrong) — honored in the
#   current+2-lines-above window alongside the historic READONLY allowlist, so the
#   12 deliberate, already-documented exceptions don't false-positive while any NEW
#   undocumented raw `<img>` still fails the gate.
#   COMMENT-AWARE (S103): znacznik wpisany w PROZĘ komentarza nie jest znacznikiem.
#   Zdanie w DECISION wyjaśniające, czemu warstwa przykrywa obraz, zapalało tę
#   bramkę przy czystym kodzie — trzecia instancja klasy „strażnik myli opis wzorca
#   z wzorcem" w tym repo (patrz strip_comments_keep_lines w _utils.sh).
#   UWAGA, dwa strumienie NIE bez powodu: wykrywanie idzie po kodzie z wyciętymi
#   komentarzami, ale okno escape'u czyta ORYGINAŁ — bo uzasadnienie
#   `eslint-disable … no-img-element` samo jest komentarzem i strip skasowałby
#   wszystkie 12 udokumentowanych wyjątków naraz.
CODE_ORIG_SEP=$'\001'   # bajt niewystępujący w źródłach — rozdziela obie kolumny
RAW_IMG=$(while IFS= read -r -d '' f; do
    paste -d"$CODE_ORIG_SEP" <(strip_comments_keep_lines "$f") "$f" | awk -F'\001' -v FILE="$f" '
      { buf3 = buf2; buf2 = buf1; buf1 = $2 }        # okno escape = linie ORYGINAŁU
      $1 ~ /<img[ \t\r>]|<img$/ {                    # trafienie = tylko KOD
        window = buf3 "\n" buf2 "\n" buf1
        if (window !~ /no-img-element|READONLY/) print FILE ":" FNR
      }
    '
  done < <(find "$MAIN_SRC/UI" -name "*.tsx" -type f -print0 2>/dev/null) || true)
if [[ -n "$RAW_IMG" ]]; then
  print_error "Raw <img> wykryte (użyj next/image — AVIF/WebP + lazy + CLS=0):"
  echo "$RAW_IMG"
  violations=$((violations + 1))
fi

if [[ $violations -gt 0 ]]; then
  print_error "bundle-budget: $violations naruszeń hygieny perf."
  exit 1
fi

print_success "bundle-budget: optimizePackageImports pokrywa heavy-libs; zero raw <img>."
exit 0
