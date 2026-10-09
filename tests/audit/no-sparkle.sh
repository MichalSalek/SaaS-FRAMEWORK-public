#!/usr/bin/env bash
# no-sparkle.sh — Guard against decorative stars / SparkleIcon (anti-AI-slop).
#
# INTENT:
#   Owner 2026-08-18: ozdobne gwiazdki (Phosphor SparkleIcon, 4-ramienne SVG
#   tile/mask, 5-star rating glyphs, emoji ⭐ w UI) czytają się jak status albo
#   jak „AI slop". Sweep usunął je z main/src. Ten ratchet nie pozwala im wrócić.
#
# KOREKTA OWNERA 2026-08-19 (głos S95, playground):
#   Zakaz dotyczy DEKORACJI, nie OCENY. Sweep zabrał przy okazji znak oceny
#   recenzji i został po nim techniczny napis kapitalikami. Znak oceny wraca w
#   formie NIE-gwiazdkowej (frakcja / asteryski kroju / nacięcia / paznokcie),
#   rozstrzyga głos S95. Ten ratchet zostaje BEZ ZMIAN: nadal blokuje
#   StarIcon/Sparkle/4-ramienne path/⭐, a żaden z wariantów oceny go nie rusza.
#   Uwaga na FP: grep NIE jest comment-aware, więc samo słowo w komentarzu
#   uzasadniającym wywala pre-commit (przeformułuj komentarz, nie ratchet).
#
# KEEP (not scanned here):
#   Functional status-dots (health/on-off) — osobna zasada taste-owner #28.
#   Domain icons that are not stars (PushPin, Images, Palette, …).
#   Dot-grid atmospheric tiles (circles, not 4-point stars).
#
# EXIT: 0 if PASS, 1 if any hit.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SRC="${ROOT}/main/src"

print_boxed_header "No decorative sparkle/stars in frontend UI" "✨"

if [[ ! -d "$SRC" ]]; then
  print_success "No main/src — nothing to scan"
  exit 0
fi

VIOLATIONS=""

# Phosphor SparkleIcon / StarIcon in TS/TSX (Star = same tell in badges/ratings).
# Also dead data keys that would re-wire a sparkle the moment someone renders iconName.
ICON_HITS=$(grep -rnE "\b(SparkleIcon|StarIcon)\b|iconName: ['\"]Sparkle['\"]" "$SRC" \
  --include='*.ts' --include='*.tsx' 2>/dev/null || true)
if [[ -n "$ICON_HITS" ]]; then
  VIOLATIONS="${VIOLATIONS}${ICON_HITS}"$'\n'
fi

# Inline 5-star rating helper that came back.
SVG_HITS=$(grep -rnE "\bStarSvg\b" "$SRC" --include='*.ts' --include='*.tsx' 2>/dev/null || true)
if [[ -n "$SVG_HITS" ]]; then
  VIOLATIONS="${VIOLATIONS}${SVG_HITS}"$'\n'
fi

# 4-point star paths used as CSS tiles / masks (several coordinate families).
# S91: first ratchet missed the watermark family `M40 8 L43 36 L72 40`
# (for-clients highlight + visitMoment, FinalCtaBand, home benefit,
# for-studios operating/useCase). Prod kept serving it after the sweep
# because the guard never saw those coordinates.
PATH_HITS=$(grep -rnE "L72 18 L78 20|L13\\.5 9|L40 50 L41 53|M40 12 L42 36 L62 40|M50 18 L52 46 L78 50|M40 8 L43 36 L72 40|L72 40 L43 44 L40 72" \
  "$SRC" --include='*.css' --include='*.ts' --include='*.tsx' 2>/dev/null || true)
if [[ -n "$PATH_HITS" ]]; then
  VIOLATIONS="${VIOLATIONS}${PATH_HITS}"$'\n'
fi

# Star emoji in runtime UI (pages/components), not markdown docs.
EMOJI_HITS=$(grep -rn "⭐" "$SRC" --include='*.ts' --include='*.tsx' --include='*.css' 2>/dev/null || true)
if [[ -n "$EMOJI_HITS" ]]; then
  VIOLATIONS="${VIOLATIONS}${EMOJI_HITS}"$'\n'
fi

# Comment-aware: linia będąca komentarzem (JSDoc `*`, `//`, `/*`, `<!--`) NIE jest
# renderowanym kodem. Bez tego filtra DECISION-komentarz uzasadniający decyzję
# („ratchet blokuje StarIcon…") wywala pre-commit — trafiło dwa razy w jednej
# sesji (S96), więc guard uczy się rozróżniać kod od uzasadnienia. Zakres
# blokady jest bez zmian: liczy się kod, nie proza o kodzie.
VIOLATIONS=$(printf '%s' "$VIOLATIONS" | grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*|<!--)' || true)

print_separator

if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(printf '%s' "$VIOLATIONS" | grep -c . || true)
  print_error "No-sparkle FAILED — ${COUNT} decorative star/sparkle hit(s):"
  echo ""
  printf '%s' "$VIOLATIONS"
  echo ""
  echo "Fix: delete SparkleIcon/StarIcon (use a domain Phosphor icon or no icon);"
  echo "delete 4-point star SVG tiles/masks; ocena opinii = znak nie-gwiazdkowy (głos S95) albo tekst."
  exit 1
fi

print_success "No-sparkle passed — no SparkleIcon/StarIcon, star SVG tiles, or ⭐ in UI"
exit 0
