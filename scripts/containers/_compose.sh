#!/usr/bin/env bash
# scripts/containers/_compose.sh
# =============================================================================
# SSOT PAR PLIKOW COMPOSE + asercja stanu kontenerow. Source'owany przez
# WSZYSTKIE skrypty z scripts/containers/ (build-and-up-dev, recreate-dev,
# build-and-up-staging) — zaden z nich nie sklada listy `-f` samodzielnie.
#
# DLACZEGO SSOT (nie duplikat w kazdym skrypcie): dev = compose bazowy + override
# SSL, i pominiecie override'a kosztowalo regresje 2026-08-18 (kontener bez env z
# override'a -> ALLOWED_DEV_ORIGINS niepelne -> Next 16 tnie websocket HMR ->
# przegladarka reloaduje strone co ~50 s, widoczne TYLKO przez domene). Klasa
# odradza sie przy KAZDYM nowym override — jedno miejsce z lista plikow zamyka ja
# strukturalnie. Strażnik: `npm run audit:compose-file-pairs`.
#
# Sciezki sa ABSOLUTNE (wyliczone z polozenia tego pliku) — skrypt odpalony z
# dowolnego CWD widzi te same kontenery. Nazwa projektu compose pozostaje
# `app-framework` (project-directory = katalog pierwszego `-f`), zweryfikowane.
# =============================================================================

_COMPOSE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

DEV_COMPOSE_LABEL="docker-compose.dev.yml + docker-compose.dev-ssl.yml (zawsze oba)"
STAGING_COMPOSE_LABEL="docker-compose.prod.yml + docker-compose.staging.yml (zawsze oba)"

# Dev: compose bazowy + override SSL (Caddy/LE na dev/api.dev).
dev_compose() {
  docker compose \
    -f "${_COMPOSE_ROOT}/docker-compose.dev.yml" \
    -f "${_COMPOSE_ROOT}/docker-compose.dev-ssl.yml" "$@"
}

# Staging: compose prod + override stagingu (lokalna DB + Caddy).
staging_compose() {
  docker compose \
    -f "${_COMPOSE_ROOT}/docker-compose.prod.yml" \
    -f "${_COMPOSE_ROOT}/docker-compose.staging.yml" "$@"
}

# --- Asercja stanu -----------------------------------------------------------
# `docker compose up -d` konczy sie sukcesem, gdy kontener ZOSTAL UTWORZONY — nie
# gdy w nim cokolwiek dziala. Wszystkie serwisy prod/staging maja `restart: always`,
# wiec kontener padajacy w petli pokazuje sie jako "Restarting" (a przez chwile po
# starcie nawet jako "Up") i goly `compose ps` raportowal go jako sukces deployu.
#
# Argumenty to nazwy SERWISOW z compose (main-dev, caddy), nie container_name
# (dev-caddy) — to samo nazewnictwo, ktorym poslugujesz sie w `npm run dev:recreate`,
# wiec nie trzeba nigdzie tlumaczyc jednych na drugie.
#
# Uzycie:  assert_compose_running staging_compose web-1-prod main-prod db caddy
#          ^ pierwszy argument = nazwa funkcji compose (dev_compose|staging_compose)
assert_compose_running() {
  local compose_fn="$1"; shift
  local expected=("$@")
  local rc=0
  local svc state ps_out

  # Rozroznij "kontener nie dziala" od "nie umiem odczytac stanu": przy braku/bledzie
  # plikow compose `ps` konczy sie bledem, a lista serwisow jest pusta — bez tego
  # guardu KAZDY serwis raportowal sie jako martwy i operator szukalby awarii tam,
  # gdzie jej nie ma (zlapane teeth-testem na stagingu 2026-08-21).
  if ! ps_out="$("$compose_fn" ps --format '{{.Service}}|{{.State}}' 2>&1)"; then
    error "Nie moge odczytac stanu kontenerow (docker compose ps zwrocil blad):"
    echo "$ps_out" | sed 's/^/    /' >&2
    return 1
  fi

  for svc in "${expected[@]}"; do
    # --status=running filtruje po stanie po stronie dockera; pusty wynik = serwis
    # nie dziala (nie istnieje / exited / restarting).
    state="$(echo "$ps_out" | awk -F'|' -v s="$svc" '$1==s {print $2; exit}')"
    if [ "${state:-}" = "running" ]; then
      success "Serwis OK: ${svc} (running)"
    else
      error "SERWIS NIE DZIALA: ${svc} (state='${state:-brak}') — deploy NIE jest sukcesem."
      rc=1
    fi
  done
  return $rc
}
