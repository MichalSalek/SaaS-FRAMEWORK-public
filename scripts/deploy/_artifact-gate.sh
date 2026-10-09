#!/bin/bash
# scripts/deploy/_artifact-gate.sh
# Wspólny strażnik TOŻSAMOŚCI ARTEFAKTU frontu po deployu i po rollbacku.
#
# DLACZEGO OSOBNO OD HEALTH-GATE'A I STATIC-GATE'A: `assert_http_ok` dowodzi, że
# COŚ odpowiada 200, `assert_static_served` — że public/ jest osiągalne. Żaden z nich
# nie mówi, KTÓRY artefakt serwuje pm2: nieprzeładowany proces, nieprzepięty symlink
# albo release wstały ze starego katalogu dają dokładnie ten sam zielony wynik.
# BUILD_ID Next (`.next/BUILD_ID`, w HTML jako `"buildId":"..."`) jest tożsamością
# artefaktu — porównanie zamyka ostatnie ogniwo „ten build jest live".
# Backendowy odpowiednik żyje w deploy-backend (pole `build_id` w /api/health-check).
#
# DLACZEGO PYTAMY ORIGIN PO SSH, A NIE DOMENĘ: front stoi za Cloudflare z Cache Rule
# (edge-TTL 4 h), a purge leci DOPIERO po health-gate — pytanie przez domenę potrafi
# dostać stary HTML z edge'a i dać FAŁSZYWĄ czerwień. `127.0.0.1:PORT` na hoście mierzy
# dokładnie ten proces, o który pytamy. Domena jest fallbackiem (z cache-busterem), gdy
# SSH/curl zdalny zawiedzie.
#
# Usage:  source "${SCRIPT_DIR}/_artifact-gate.sh"
#         assert_artifact_served "$SSH_CONN" "$PORT" "$DOMAIN" "$EXPECTED_BUILD_ID" || exit 14

ARTIFACT_GATE_TRIES=5
ARTIFACT_GATE_DELAY=3

# Wyciąga BUILD_ID z HTML-a Next (`__NEXT_DATA__`). Pusty stdout = nie ustalono.
# Bez `| head -1`: pod `pipefail` (utils.sh) zamkniecie potoku przez `head` daje sedowi
# SIGPIPE, czyli status 141 dla CALEGO podstawienia — mierzylibysmy wtedy nie artefakt,
# tylko wlasny potok. Pierwsza linie bierzemy rozwinieciem, juz po odczycie.
_extract_build_id() {
  local matched
  matched="$(sed -n 's/.*"buildId":"\([^"]*\)".*/\1/p')"
  printf '%s' "${matched%%$'\n'*}"
}

_probe_build_id_origin() {
  local ssh_conn="$1" port="$2"
  timeout 45 ssh -o BatchMode=yes -o ConnectTimeout=15 "${ssh_conn}" \
    "curl -sS -m 15 http://127.0.0.1:${port}/" 2>/dev/null | _extract_build_id
}

_probe_build_id_domain() {
  local domain="$1"
  # Unikalny query = MISS na edge'u (o ile Cache Rule nie ignoruje query stringa);
  # dlatego to fallback, a nie źródło pierwszego wyboru.
  curl -sS -m 20 -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' \
    "https://${domain}/?_artifact_gate=$(date +%s)" 2>/dev/null | _extract_build_id
}

assert_artifact_served() {
  local ssh_conn="$1" port="$2" domain="$3" expected="$4"
  local i live=""

  if [ -z "$expected" ] || [ "$expected" = "unknown" ]; then
    warn "Artifact gate POMINIETY: nieznany oczekiwany BUILD_ID (brak .next/BUILD_ID)."
    return 0
  fi

  for i in $(seq 1 "$ARTIFACT_GATE_TRIES"); do
    live="$(_probe_build_id_origin "$ssh_conn" "$port")"
    [ -n "$live" ] || live="$(_probe_build_id_domain "$domain")"

    if [ "$live" = "$expected" ]; then
      success "Artifact gate OK (BUILD_ID ${expected} — TEN artefakt serwuje pm2)"
      return 0
    fi
    info "artifact ${i}/${ARTIFACT_GATE_TRIES}: live=${live:-brak}, oczekiwany=${expected}"
    # `[ ... ] && sleep` zwracaloby 1 w ostatniej iteracji (falszywy niezerowy status
    # funkcji pod `set -e`, gdyby ktos wywolal ja poza kontekstem `if`).
    if [ "$i" -lt "$ARTIFACT_GATE_TRIES" ]; then
      sleep "$ARTIFACT_GATE_DELAY"
    fi
  done

  if [ -z "$live" ]; then
    # Brak sygnalu != dowod awarii (nietypowy HTML, brak curl na hoscie, SSH down).
    # Blokowanie deployu na braku pomiaru byloby falszywa czerwienia — glosny warn.
    warn "Artifact gate BEZ WERDYKTU: nie udalo sie odczytac BUILD_ID ani z origin (127.0.0.1:${port}), ani z ${domain}."
    warn "Deploy NIE zostal potwierdzony na poziomie artefaktu — zweryfikuj recznie."
    return 0
  fi

  error "ARTIFACT GATE FAIL: serwowany BUILD_ID '${live}' != wdrazany '${expected}'."
  error "Proces pm2 nie podniosl sie na nowym release (symlink current? pm2 restart?) — HTML 200 tego NIE pokazuje."
  return 1
}
