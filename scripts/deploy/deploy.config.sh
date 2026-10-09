#!/usr/bin/env bash
# scripts/deploy/deploy.config.sh
# =============================================================================
# SSOT konfiguracji deployu app-FRAMEWORK. Source'owany przez WSZYSTKIE skrypty
# deployu (deploy-frontend, deploy-backend, rollback-frontend, deploy-docker-staging
# oraz containers/build-and-up-staging). Jedyne miejsce z portami / domenami /
# hostem / branchem — zmieniasz TU, nie w package.json i nie w skryptach.
#
# Topologia (pelny opis: docs/DEPLOYMENT.md):
#   - front `main`  -> hosting wspoldzielony : build standalone lokalnie -> scp -> pm2 (port zarezerwowany)
#   - back  `web-1` -> Render        : build .next lokalnie -> push brancha `deploy` (.next w gicie)
#   - staging       -> host w LAN    : ssh -> git reset --hard origin/master -> docker compose
# =============================================================================

# --- SSH / host frontu (hosting wspoldzielony) --------------------------------
DEPLOY_SSH_USER="deploy-user"
DEPLOY_SSH_HOST="host.example.com"
DEPLOY_NODE_INTERPRETER="/path/on/server/bin/node"   # Node 24 na serwerze (placeholder)
# Katalog bazowy release'ow na serwerze (wzgledem $HOME); aktywny release
# wskazuje symlink `current`. Placeholder w publicznej migawce.
DEPLOY_REMOTE_BASE="path/on/server"

# --- Frontend: main -> hosting wspoldzielony ---------------------------------
# PORT MUSI byc zarezerwowany w panelu hostingu i zgadzac sie z konfiguracja
# proxy domeny (proxy -> 127.0.0.1:PORT). Port NIEzarezerwowany ->
# EPERM -> 502 (incydent 2026-06-25). 0000 = placeholder w publicznej migawce.
FRONTEND_PROJECT="main"
FRONTEND_DOMAIN_PRODUCTION="nailfolio.app"
FRONTEND_PORT_PRODUCTION="0000"
# Preview NIE jest obecnie provisionowany (brak domeny w panelu hostingu, brak
# zarezerwowanego portu). Przed pierwszym deployem preview: zarezerwuj port,
# dodaj domene jako proxy na localhost:<port>
# i wpisz realny port w FRONTEND_PORT_PREVIEW ponizej.
FRONTEND_DOMAIN_PREVIEW="preview.example.com"
FRONTEND_PORT_PREVIEW=""   # USTAW po rezerwacji portu (patrz wyzej)

# --- Backend: web-1 -> Render -----------------------------------------------
# Render sledzi branch `deploy`, ktory trzyma SKOMPILOWANY .next w gicie
# (.gitignore brancha `deploy` odignorowuje .next, chowa tylko .next/cache/).
# Render: build = no-op, start = `npm start` (next start na zacommitowanym .next).
BACKEND_PROJECT="web-1"
BACKEND_RENDER_BRANCH="deploy"
BACKEND_NODE_VERSION="24.15.0"   # = web-1/.node-version (pin Rendera; build lokalny MUSI zgadzac sie wersja)
# Deploy gate MUSI byc niezalezny od DB: zawieszony Neon nie oznacza, ze nowy
# proces Rendera nie wystartowal. Endpoint zwraca APP_OK + uptime procesu
# + build_id (= .next/BUILD_ID zywego procesu). Gate porownuje build_id z artefaktem
# zbudowanym lokalnie, bo sam uptime dowodzi tylko "swiezy proces" — a swiezy proces
# potrafi wstac na STARYM artefakcie (build_failed na topie, restart, OOM).
BACKEND_HEALTH_URL="https://api.nailfolio.app/api/health-check"

# --- Staging: caly stack -> host w LAN (docker compose) ----------------------
# Deploy stagingu NIE wysyla lokalnych plikow: laczy sie po SSH i odtwarza box z
# origin/master (`npm run install:docker:staging:reset` -> git:pull:reset). Stad
# pre-flight parytetu gita w deploy-docker-staging — inaczej "deploy udany"
# oznaczalby wdrozenie CUDZEGO, starszego commita.
# Kazda z tych wartosci mozna nadpisac zmienna srodowiskowa o tej samej nazwie
# bez prefiksu STAGING_ (SSH_USER/SSH_HOST/REMOTE_WORKDIR) — sciezka ratunkowa
# dla innego boxa, bez edycji repo.
STAGING_SSH_USER="deploy-user"
STAGING_SSH_HOST="staging-host.example.lan"
STAGING_REMOTE_WORKDIR="app-FRAMEWORK"
# Health-gate stagingu: front przez Caddy (:443) i backend (:3101) — ten sam cert.
# Backendowy endpoint raportuje takze stan DB (staging ma wlasna lokalna baze).
STAGING_HEALTH_URL_FRONTEND="https://staging.example.com/"
STAGING_HEALTH_URL_BACKEND="https://staging.example.com:3101/api/v1/internal/health-public"
# Serwisy, ktore MUSZA dzialac po deployu (nazwy SERWISOW z compose prod+staging,
# nie container_name — asercja mowi tym samym jezykiem, co pliki compose).
STAGING_EXPECTED_SERVICES="main-prod web-1-prod db caddy"

# --- Sekrety (opcjonalne) — gitignored, NIE commitowac ----------------------
# Render API (bogatsza weryfikacja statusu deployu/rollbacku) trzymaj w
# scripts/deploy/deploy.config.local.sh:  RENDER_API_KEY, RENDER_BACKEND_SERVICE_ID.
# Podstawowa weryfikacja (health-gate w skryptach) NIE wymaga tych sekretow.
_DEPLOY_CONFIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# `[ -f X ] && source X` zwraca 1, gdy pliku NIE ma — a kod wyjscia OSTATNIEJ
# komendy tego pliku jest kodem wyjscia `source`, wiec pod `set -e` (utils.sh)
# brak opcjonalnych sekretow ubijalby skrypt wywolujacy. Dzis maskuje to tylko
# definicja funkcji ponizej; `if` uniezaleznia config od kolejnosci linii.
# shellcheck source=/dev/null
if [ -f "${_DEPLOY_CONFIG_DIR}/deploy.config.local.sh" ]; then
  source "${_DEPLOY_CONFIG_DIR}/deploy.config.local.sh"
fi

# --- Helper: rozwiaz DOMAIN + PORT frontu z ENV_NAME ------------------------
# Uzywany przez deploy-frontend i rollback-frontend. Ustawia globalne DOMAIN, PORT.
resolve_frontend_target() {
  local env_name="${1:-}"
  case "$env_name" in
    production) DOMAIN="$FRONTEND_DOMAIN_PRODUCTION"; PORT="$FRONTEND_PORT_PRODUCTION" ;;
    preview)    DOMAIN="$FRONTEND_DOMAIN_PREVIEW";    PORT="$FRONTEND_PORT_PREVIEW" ;;
    *) echo "[deploy.config] nieznany ENV_NAME '${env_name}' (uzyj: production|preview)" >&2; return 1 ;;
  esac
  if [ -z "${PORT}" ]; then
    echo "[deploy] Środowisko PREVIEW nie jest skonfigurowane (brak zarezerwowanego portu/domeny na hostingu). Instrukcja provisioningu: patrz komentarz w deploy.config.sh sekcja Preview." >&2
    return 1
  fi
}
