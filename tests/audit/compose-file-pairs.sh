#!/usr/bin/env bash
# compose-file-pairs.sh — Guard: docker compose ZAWSZE z kompletna para plikow.
#
# INTENT:
#   Kazde srodowisko tego repo jest zlozeniem DWOCH plikow compose:
#     dev     = docker-compose.dev.yml  + docker-compose.dev-ssl.yml
#     staging = docker-compose.prod.yml + docker-compose.staging.yml
#   Pominiecie drugiego pliku NIE wywala sie z bledem — docker po prostu nie widzi
#   czesci definicji, wiec skutek jest cichy i przesuniety w czasie:
#     • 2026-08-18: `up main-dev` bez override'a SSL -> kontener bez env z override'a
#       -> ALLOWED_DEV_ORIGINS niepelne -> Next 16 tnie websocket HMR -> przegladarka
#       reloaduje strone co ~50 s (widoczne TYLKO przez domene, nie przez localhost),
#     • `down` na samym compose prod nie zna serwisow stagingu (staging-db,
#       staging-caddy) — dotyka ich wylacznie jako "orphans", czyli przez efekt
#       uboczny flagi, a nie przez swoja definicje.
#   Lista plikow ma jedno zrodlo: scripts/containers/_compose.sh (dev_compose /
#   staging_compose). Ten straznik pilnuje, zeby nikt jej nie odtwarzal recznie.
#
# WHAT IT CHECKS (tylko podkomendy LIFECYCLE: up/down/build/create/start/restart/
#   rm/pull/stop/kill — to one tworza i rekonfiguruja kontenery; exec/logs/ps/config
#   czytaja istniejacy stan i sa nieszkodliwe bez override'a):
#   A. scripts/** — `docker compose` z `-f` poza _compose.sh = naruszenie:
#      w skryptach uzywa sie funkcji dev_compose / staging_compose.
#   B. package.json (root + submoduly) — wywolanie lifecycle MUSI zawierac obie
#      czesci kanonicznej pary (tam nie ma jak wolac funkcji shellowej).
#   Komentarze sa strippowane przed dopasowaniem, wiec proza opisujaca ZLY ksztalt
#   (ostrzezenie w recreate-dev: „Reczne `docker compose -f dev.yml up` bylo
#   zrodlem regresji") zostaje zielona.
#
# ESCAPE: `compose-pair-allow: <powod>` w tej samej linii albo linie wyzej.
#
# EXIT: 0 = PASS, 1 = naruszenia.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"

print_boxed_header "docker compose: kompletna para plikow" "🐳"

LIFECYCLE='(up|down|build|create|start|restart|rm|pull|stop|kill)'

scan_file() {
  # $1 = plik, $2 = tryb (scripts|manifest)
  awk -v mode="$2" -v fname="$1" -v lifecycle="$LIFECYCLE" '
    { raw = $0 }
    raw ~ /compose-pair-allow:/ { allow_next = 1; this_allow = 1 }

    {
      line = raw
      if (mode == "scripts") {
        # Strip komentarzy shellowych: wzmianka o zlym ksztalcie != naruszenie.
        sub(/^[ \t]*#.*/, "", line)
        sub(/[ \t]#.*/, "", line)
      }

      if (line ~ /docker[ \t]+compose/ && line ~ ("(^|[ \t\"'\''`;&|(])-f[ \t]") ) {
        # Podkomenda lifecycle gdziekolwiek po slowie compose?
        if (line ~ ("[ \t]" lifecycle "([ \t]|$|\")")) {
          if (!(this_allow || prev_allow)) {
            if (mode == "scripts") {
              printf "%s:%d: %s\n", fname, FNR, "wywolanie compose w scripts/ — uzyj dev_compose / staging_compose (_compose.sh)"
            } else {
              has_dev  = (line ~ /docker-compose\.dev\.yml/     && line ~ /docker-compose\.dev-ssl\.yml/)
              has_stg  = (line ~ /docker-compose\.prod\.yml/    && line ~ /docker-compose\.staging\.yml/)
              if (!has_dev && !has_stg) {
                printf "%s:%d: %s\n", fname, FNR, "niekompletna para plikow compose (dev.yml+dev-ssl.yml albo prod.yml+staging.yml)"
              }
            }
          }
        }
      }
      prev_allow = allow_next; allow_next = 0; this_allow = 0
    }
  ' "$1" || true
}

violations=""

# --- A. scripts/** (bez SSOT-a) ---------------------------------------------
SCAN_DIR="${SCRIPTS_DIR_OVERRIDE:-${ROOT}/scripts}"
if [[ -d "$SCAN_DIR" ]]; then
  while IFS= read -r f; do
    [[ "$(basename "$f")" == "_compose.sh" ]] && continue   # SSOT listy plikow
    violations+="$(scan_file "$f" scripts)"$'\n'
  done < <(find "$SCAN_DIR" -type f -not -path '*/node_modules/*')
fi

# --- B. manifesty package.json (root + submoduly) ----------------------------
for m in "${ROOT}/package.json" "${ROOT}"/*/package.json; do
  [[ -f "$m" ]] || continue
  case "$m" in */node_modules/*) continue ;; esac
  violations+="$(scan_file "$m" manifest)"$'\n'
done

violations="$(echo "$violations" | grep -v '^$' || true)"

if [[ -n "$violations" ]]; then
    print_error "docker compose bez kompletnej pary plikow:"
    echo "$violations" | sed "s|${ROOT}/||" | sed 's/^/    /'
    echo
    print_info "Fix (skrypty):    source scripts/containers/_compose.sh; dev_compose up -d  |  staging_compose down"
    print_info "Fix (package.json): dopisz brakujacy plik — dev: -f docker-compose.dev.yml -f docker-compose.dev-ssl.yml"
    print_info "                    staging/prod: -f docker-compose.prod.yml -f docker-compose.staging.yml"
    print_info "Swiadomy wyjatek: 'compose-pair-allow: <powod>' w tej linii lub linie wyzej."
    exit 1
fi

print_success "docker compose: wszystkie wywolania lifecycle maja kompletna pare plikow"
exit 0
