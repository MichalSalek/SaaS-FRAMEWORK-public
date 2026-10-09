#!/usr/bin/env bash
# asset-paths.sh — Enforce LP image-asset hygiene (registry SSOT + on-disk presence).
#
# CHECK 1 (no raw LP paths outside registry):
#   The literal "/img/lp/" must appear ONLY in the asset registry
#   (main/src/UI/assets/lpAssets.ts). Any *.ts/*.tsx file under main/src that
#   references "/img/lp/" directly bypasses the registry SSOT → violation.
#
# CHECK 2 (registry paths exist on disk):
#   Every "/img/lp/..." string literal declared in the registry must resolve to
#   a real file under main/public (main/public + path). A registry entry pointing
#   at a missing asset → violation.
#   NOTE: scoped to /img/lp/ ONLY — the seo group is deliberately SKIPPED
#   (root-level SEO assets: /og-default.png, /logo.png, /logo-full.png — all
#   present on disk since 2026-07-16, brand-mark z brand-sheet-nailfolio.png).
set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC_DIR="${ROOT}/main/src"
PUBLIC_DIR="${ROOT}/main/public"
REGISTRY="${ROOT}/main/src/UI/assets/lpAssets.ts"

# ── Allowlist (NOT a violation): the registry itself is the one place where raw
# "/img/lp/" literals are expected to live. Path relative to ROOT.
RAW_PATH_ALLOWLIST=(
  "main/src/UI/assets/lpAssets.ts"
)

# Temp-file cleanup (shared idiom from _utils.sh)
trap cleanup_temp_files EXIT

print_boxed_header "Asset paths: LP registry SSOT + on-disk audit" "🖼️"

VIOLATIONS=0

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 1 — no raw "/img/lp/" outside the registry
# ─────────────────────────────────────────────────────────────────────────────
print_header "CHECK 1 — raw /img/lp/ paths outside registry"

# Quoted string-literal scan over main/src (.ts + .tsx), excluding build artifacts.
# Anchored on a leading quote (' or ") before /img/lp/ so only real path string-
# literals match; prose/JSDoc like "drop do main/public/img/lp/" (no quote directly
# before /img/lp/) is correctly ignored.
RAW_HITS=$(grep -rEn "['\"]/img/lp/" "$SRC_DIR" \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out --exclude-dir=dist \
  2>/dev/null || true)

CHECK1_FAIL=0
if [[ -z "$RAW_HITS" ]]; then
  print_success "No /img/lp/ literals found in main/src"
else
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    FILE=$(echo "$line" | cut -d: -f1)
    LINE_NUM=$(echo "$line" | cut -d: -f2)
    REL=$(echo "$FILE" | sed "s|${ROOT}/||")

    # ── Check allowlist (the registry file)
    ALLOWED=0
    for allowed_path in "${RAW_PATH_ALLOWLIST[@]}"; do
      if [[ "$REL" == "$allowed_path" ]]; then
        ALLOWED=1
        break
      fi
    done

    if [[ "$ALLOWED" -eq 1 ]]; then
      continue
    fi

    print_error "RAW PATH: ${REL}:${LINE_NUM} — /img/lp/ referenced outside registry (use main/src/UI/assets/lpAssets.ts)"
    CHECK1_FAIL=$((CHECK1_FAIL + 1))
    VIOLATIONS=$((VIOLATIONS + 1))
  done <<< "$RAW_HITS"

  if [[ "$CHECK1_FAIL" -eq 0 ]]; then
    print_success "All /img/lp/ literals live in the registry (allowlisted)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 2 — registry /img/lp/ paths exist on disk under main/public
# ─────────────────────────────────────────────────────────────────────────────
print_header "CHECK 2 — registry /img/lp/ paths exist under main/public"

if [[ ! -f "$REGISTRY" ]]; then
  # Registry not introduced yet → nothing to verify (CHECK 1 still enforces SSOT).
  print_info "Registry not found (${REGISTRY#$ROOT/}) — skipping on-disk check (no paths to verify)"
else
  # Extract every "/img/lp/..." asset path literal (single- or double-quoted).
  # Scoped to /img/lp/ ONLY — the seo group (/og-default.png, /logo.png) is skipped.
  # The closing quote MUST be preceded by a file extension (.webp/.svg/...): this
  # anchors on real asset paths and excludes prose placeholders like the
  # doc-comment example "/img/lp/..." (literal ellipsis, no extension).
  REGISTRY_PATHS=$(grep -oE "['\"]/img/lp/[^'\"]*\.[a-zA-Z0-9]+['\"]" "$REGISTRY" 2>/dev/null \
    | sed -E "s/^['\"]//; s/['\"]\$//" \
    | sort -u || true)

  if [[ -z "$REGISTRY_PATHS" ]]; then
    print_info "No /img/lp/ path literals declared in registry — nothing to verify"
  else
    CHECK2_FAIL=0
    while IFS= read -r asset_path; do
      [[ -z "$asset_path" ]] && continue
      DISK_PATH="${PUBLIC_DIR}${asset_path}"
      if [[ -f "$DISK_PATH" ]]; then
        print_success "exists — ${asset_path}"
      else
        print_error "MISSING: ${asset_path} — no file at main/public${asset_path}"
        CHECK2_FAIL=$((CHECK2_FAIL + 1))
        VIOLATIONS=$((VIOLATIONS + 1))
      fi
    done <<< "$REGISTRY_PATHS"

    if [[ "$CHECK2_FAIL" -eq 0 ]]; then
      print_success "All registry /img/lp/ paths resolve to files on disk"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
print_separator
if [[ "$VIOLATIONS" -gt 0 ]]; then
  print_error "Asset-paths audit FAILED — ${VIOLATIONS} violation(s)"
  exit 1
fi

print_success "Asset-paths audit passed — registry is SSOT and all LP assets exist on disk"
exit 0
