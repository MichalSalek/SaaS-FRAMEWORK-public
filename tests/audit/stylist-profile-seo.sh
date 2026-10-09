#!/bin/bash
# stylist-profile-seo.sh — Guard: the stylist profile SSR page renders structured data.
#
# WHY (regression 2026-07-01): the profile SSR fetch in stylist/[identifier].tsx used
#   POST+JSON-body against the GET-only backend handler (get-stylist-profile:
#   defineHandler method:'get', reads qStr(req.query,'identifier')). Method mismatch
#   → 405 → response.ok false → buildSeoMeta(null) fallback → generic title,
#   noindex,nofollow, and ZERO application/ld+json on EVERY /stylist/[id] page —
#   while those exact identifiers were advertised as indexable in
#   sitemap-profiles.xml. A silent "Submitted URL marked noindex" GSC failure that
#   deindexed the entire profile PSEO surface, invisible in the source (only the
#   rendered HTML revealed it). This ratchet keeps the fetch↔handler contract from
#   sliding back.
#
# CHECKS (main/src/pages/stylist/[identifier].tsx):
#   1. The profile SSR fetch is NOT POST (handler is GET-only → POST = 405 = deindex).
#   2. buildStylistProfileJsonLdItems is actually CALLED, its result is assigned
#      to jsonLdItems, and jsonLdItems is rendered through <JsonLdComposition>.
#
# EXIT: 0 if PASS, 1 if FAIL.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
FILE="${ROOT}/main/src/pages/stylist/[identifier].tsx"

print_boxed_header "Stylist profile SEO: SSR renders JSON-LD (GET fetch, no silent deindex)" "🔎"

if [[ ! -f "$FILE" ]]; then
  print_error "stylist/[identifier].tsx not found — profile PSEO entry point missing?"
  exit 1
fi

FAILED=0

# 1. The profile SSR fetch must not be POST. The public-profile endpoint is a QUERY
#    (GET-only); POST → 405 → empty JSON-LD → the whole profile surface deindexes.
if grep -qE "method:[[:space:]]*['\"]POST['\"]" "$FILE"; then
  print_error "Profile SSR fetch uses method:'POST' — handler get-stylist-profile is GET-only → 405 → empty JSON-LD → deindex. Fetch with GET + ?identifier=."
  FAILED=1
fi

# 2. The JSON-LD builder must be INVOKED and its result must reach the render.
# DECISION (nie usuwaj tego komentarza):
# SLEPA PLAMA ZAMKNIETA — sprawdzenie brzmialo `grep -q
# "buildStylistProfileJsonLdItems"` i zaspokajala je SAMA LINIA IMPORTU. Skasuj
# wywolanie w `getServerSideProps`, zostaw import — bramka dalej mowi „PASSED",
# a kazdy profil znow renderuje sie bez structured data, czyli dokladnie
# regresja, dla ktorej ten plik powstal. Straznik pilnowal obecnosci NAZWY,
# a nie zachowania.
# Sprawdzamy teraz TRZY ogniwa lancucha, bo kazde z nich osobno wystarczy
# do cichej deindeksacji:
#   (a) WYWOLANIE — nazwa z nawiasem otwierajacym (import nazwany go nie ma),
#       na kodzie z wycietymi komentarzami (grep_code_stripped), zeby wzmianka
#       w prozie nie udawala wywolania;
#   (b) PRZYPISANIE do `jsonLdItems` — wywolanie, ktorego wynik idzie
#       w prozniz, nie renderuje niczego;
#   (c) RENDER — `jsonLdItems` faktycznie trafia do <JsonLdComposition>.
# POMIAR: przed = 1 sprawdzenie, spelnialne przez import. Po = 3 sprawdzenia,
# wszystkie zielone na obecnym pliku; RED-first zweryfikowany przez usuniecie
# samego wywolania przy pozostawionym imporcie.
CALL_HITS="$(grep_code_stripped 'buildStylistProfileJsonLdItems\s*\(' "$FILE")"
if [[ -z "$CALL_HITS" ]]; then
  print_error "buildStylistProfileJsonLdItems is never CALLED in stylist/[identifier].tsx (an import alone is not a call) — profile renders no structured data."
  FAILED=1
fi

ASSIGN_HITS="$(grep_code_stripped 'jsonLdItems\s*=\s*buildStylistProfileJsonLdItems\s*\(' "$FILE")"
if [[ -z "$ASSIGN_HITS" ]]; then
  print_error "buildStylistProfileJsonLdItems(...) result is not assigned to jsonLdItems — the built structured data reaches nothing."
  FAILED=1
fi

RENDER_HITS="$(grep_code_stripped 'JsonLdComposition\s+data=\{jsonLdItems\}' "$FILE")"
if [[ -z "$RENDER_HITS" ]]; then
  print_error "jsonLdItems is not passed to <JsonLdComposition data={jsonLdItems}> — nothing emits application/ld+json."
  FAILED=1
fi

if [[ "$FAILED" -eq 0 ]]; then
  print_success "Stylist profile SSR builds JSON-LD via a GET fetch (no deindex regression)"
  exit 0
fi

exit 1
