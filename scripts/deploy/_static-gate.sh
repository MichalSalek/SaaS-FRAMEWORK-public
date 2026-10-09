#!/bin/bash
# scripts/deploy/_static-gate.sh
# Wspólny strażnik serwowania public/ po deployu i po rollbacku.
#
# DLACZEGO OSOBNO OD HEALTH-GATE'A: health na "/" zwraca 200, nawet gdy CAŁE public/
# jest nieosiągalne — zagnieżdżenie public/public zabiło wtedy robots.txt, manifest,
# ikony, assetlinks i llms na dobę (incydent 2026-08-02/03), a deploy raportował sukces.
# Rollback potrzebuje tego samego sprawdzenia: wraca do release'u, który mógł zostać
# zbudowany feralnym skryptem — „HTML wstał" nie znaczy „strona działa".
#
# Dwa strzały: plik z ROOT public/ i plik z PODKATALOGU (zagnieżdżenie potrafi
# zostawić działający root i zabić głębsze ścieżki, np. deep-linki appki).
#
# Usage:  source "${SCRIPT_DIR}/_static-gate.sh"
#         assert_static_served "nailfolio.app" || exit 11

STATIC_GATE_PATHS=("robots.txt" ".well-known/assetlinks.json")

assert_static_served() {
  local domain="$1"
  local rc=0
  local static_path url code
  for static_path in "${STATIC_GATE_PATHS[@]}"; do
    url="https://${domain}/${static_path}"
    # `|| echo 000` doklejalo drugie "000" (curl przy odmowie polaczenia sam je wypisuje),
    # wiec komunikat o bledzie podawal kod HTTP, ktory nie istnieje.
    code="$(curl -sS -m 12 -o /dev/null -w "%{http_code}" "${url}" 2>/dev/null)" || code=""
    [ -n "$code" ] || code="000"
    if [ "$code" = "200" ]; then
      success "Static gate OK (${url} = 200)"
    else
      error "STATIC GATE FAIL: ${url} = ${code} — public/ nie serwuje (zagniezdzenie public/public? patrz DECISION w deploy-frontend PHASE 2)."
      rc=1
    fi
  done
  return $rc
}
