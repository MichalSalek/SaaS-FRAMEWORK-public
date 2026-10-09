#!/usr/bin/env bash
# openapi-fresh.sh — Enforce that the committed OpenAPI spec == fresh regen z DTO-SSOT.
#
# RULE: main/src/application/api-docs/openapi.generated.json (mapa API /dev/api) jest
# GENEROWANY ze źródła (@kernel DTO + ROUTES_API + API_HTTP_METHODS) przez
# scripts/gen-openapi.ts. Zmiana kontraktu (nowy endpoint/domena, zmiana REQUEST/
# RESPONSE) bez regeneracji = committed spec się starzeje i /dev/api kłamie.
#
# Dlaczego regen-diff (nie liczniki): identyczny wzorzec co dto-completeness freshness
# (census 2026-07-09) — jedyna droga złapania „zmiana pola bez regen". Regen idzie do
# pliku TEMP przez OPENAPI_OUT (trap EXIT sprząta), committed spec NIGDY nie mutowany.
#
# Skutek: docs API są SAMO-UZUPEŁNIAJĄCE się — nie da się scommitować zmiany DTO bez
# odświeżenia mapy (nowa domena wchodzi auto przez discoverDomains w generatorze).
set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
COMMITTED="$ROOT/main/src/application/api-docs/openapi.generated.json"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

print_boxed_header "OpenAPI freshness (spec == regen z DTO-SSOT)" "📘"

if [[ ! -f "$COMMITTED" ]]; then
  print_error "Brak committed spec: ${COMMITTED#"$ROOT/"}"
  print_info "Uruchom: cd main && npm run dev:gen-openapi"
  exit 1
fi

# Regeneracja do TEMP (OPENAPI_OUT) — committed nie jest mutowany.
if ! ( cd "$ROOT/main" && OPENAPI_OUT="$TMP" npx tsx scripts/gen-openapi.ts >/dev/null 2>&1 ); then
  print_error "gen-openapi nie wykonał się — sprawdź main/scripts/gen-openapi.ts"
  exit 1
fi

print_separator
if ! diff -q "$COMMITTED" "$TMP" >/dev/null 2>&1; then
  print_error "OpenAPI spec NIEŚWIEŻY — DTO/routing/methods zmienione bez regeneracji."
  print_info "Napraw: cd main && npm run dev:gen-openapi  (i zacommituj openapi.generated.json)"
  exit 1
fi

print_success "OpenAPI spec świeży — zgodny z DTO-SSOT (mapa /dev/api aktualna)"
exit 0
