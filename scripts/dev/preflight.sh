#!/usr/bin/env bash
# dev-preflight — wykrywa pięć znanych klas chorób dev-stacku (A-C =
# stale-serving, D = HMR origin-block, E = port frontu przejęty przez host),
# zanim spalą rundę diagnozy (klasy skatalogowane w pamięci projektu
# project_dev_container_staleness; A-C trafiły S51 w JEDNEJ sesji):
#
#   A. main-dev serwuje uszkodzony `.next` → KAŻDA trasa dynamiczna [param]
#      zwraca SSR 404 (photo/[id], stylist/[identifier], blog/[slug]...),
#      a census/QA zgłasza fałszywe „broken ekrany".
#   B. web-1-dev trzyma w pamięci stale Prisma client po zmianie schematu
#      (enum/kolumna) → endpointy domenowe = 500 DATABASE_ERROR.
#   C. turbopack serwuje ZBUFOROWANY SSR HTML ze ŚWIEŻYMI props → fałszywe
#      hydration errory (HTML z innej „ery" danych niż __NEXT_DATA__).
#   D. main-dev odrzuca upgrade WebSocketu HMR (/_next/webpack-hmr) z publicznego
#      originu deva (Caddy: dev.example.com), bo hosta nie ma w
#      ALLOWED_DEV_ORIGINS → klient Next po 13 nieudanych próbach robi
#      window.location.reload() co ~50 s, HMR martwy (regresja 2026-08-18:
#      recreate main-dev bez override'a SSL). Na localhost NIE widać (zawsze
#      dozwolony) — dlatego check celuje w domenę.
#   E. leftover `next dev` z HOSTA odpowiada na porcie frontu zamiast main-dev
#      (S86: `docker ps` kłamie — kontener żyje, ale ruch nie trafia do niego;
#      objaw 500 ENOENT build-manifest wygląda jak klasa A, a logi kontenera są
#      czyste). Dyskryminator: ten sam URL Z WNĘTRZA kontenera zwraca 200.
#
# Każdy FAIL = diagnoza + gotowa komenda naprawcza. Exit 0 = stack zdrowy.
#
# BUDŻET CZASU: na ciepłym stacku ~10 s. Na ZIMNYM dochodzi rozgrzewka (dwa
# żądania z limitem 45 s), bo Next kompiluje trasę dopiero przy pierwszym
# wejściu i zdrowy stack dostawał wcześniej diagnozę „nie odpowiada". Na
# martwym porcie curl wraca natychmiast, więc realnie martwy stack nadal
# failuje od razu; do 90 s czeka się tylko wtedy, gdy coś SŁUCHA i wisi.
#
# UŻYCIE:  npm run dev:preflight   |   bash scripts/dev/preflight.sh
# Wpięty jako krok 0 w scripts/qa-screenshot.cjs i qa-authed-screenshot.cjs
# (tylko dla targetów localhost; opt-out: SKIP_PREFLIGHT=1).
#
# ENV (wszystkie opcjonalne): FRONTEND_URL, BACKEND_URL, DEV_PUBLIC_ORIGIN,
# DB_CONTAINER/DB_USER/DB_NAME, DEMO_STYLIST_EMAIL, INTERNAL_SHARED_SECRET
# (jak w qa-authed-screenshot.cjs; gdy pusty — czytany z web-1/.env.development),
# COMPOSE_DEV/WEB1_ENV_DEV/STATS_MOLECULE (podmiana plików pod teeth-test gałęzi).

set -uo pipefail

# Ścieżki plików repo derywowane ze skryptu, NIE z CWD — preflight bywa odpalany
# z dowolnego katalogu (qa-screenshot.cjs woła go przez path.resolve).
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Override'owalne z env WYŁĄCZNIE po to, by dało się odpalić teeth-test każdej
# gałęzi diagnostycznej na podstawionych plikach, bez dotykania repo.
COMPOSE_DEV="${COMPOSE_DEV:-$ROOT_DIR/docker-compose.dev.yml}"
WEB1_ENV_DEV="${WEB1_ENV_DEV:-$ROOT_DIR/web-1/.env.development}"
STATS_MOLECULE="${STATS_MOLECULE:-$ROOT_DIR/main/src/UI/features/stylist/StylistProfileStats.molecule.tsx}"

FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
DB_CONTAINER="${DB_CONTAINER:-db}"
DB_USER="${DB_USER:-app_dev}"
DB_NAME="${DB_NAME:-db}"
# SSOT kont testowych: .shared-kernel/config/test-users.config.ts (DEMO_STYLIST).
# Literal copy — to skrypt bash, nie ma jak zaimportować TS (ten sam kompromis co
# AUTH_EMAILS w scripts/qa-authed-screenshot.cjs). Zmieniasz maila w kernelu → tu też.
DEMO_STYLIST_EMAIL="${DEMO_STYLIST_EMAIL:-demo-stylist-main@example.com}"
CURL="curl -s --max-time 6"
# Rozgrzewka przed pomiarem. Na ZIMNYM devie Next kompiluje trasę dopiero przy
# pierwszym żądaniu, a to potrafi trwać dłużej niż 6 s z $CURL — wtedy curl
# zwracał 000 i preflight meldował „front nie odpowiada", czyli FAŁSZYWY FAIL na
# zdrowym stacku (a diagnoza kazała recreate'ować kontener, który był w porządku).
# Rozgrzewka NIE jest pomiarem: jej wynik jest ignorowany, a gdy nikt nie słucha
# na porcie, curl wraca natychmiast z odmową połączenia, więc realnie martwy
# stack nadal failuje od razu, nie po 45 s.
warm() { curl -s -o /dev/null --max-time 45 "$1" >/dev/null 2>&1 || true; }
warm_post() {
  curl -s -o /dev/null --max-time 45 -X POST "$1" \
    -H 'content-type: application/json' -H "Origin: $FRONTEND_URL" \
    ${secret_header[@]+"${secret_header[@]}"} -d '{}' >/dev/null 2>&1 || true
}

fails=0
fail() { echo "✗ $1"; echo "  → FIX: $2"; fails=$((fails + 1)); }
ok()   { echo "✓ $1"; }
skip() { echo "− SKIP: $1"; }
# Wyjście awaryjne: dalsze checki nie mają jak nic ocenić, więc kończymy wcześnie.
bail() { echo "PREFLIGHT: FAIL ($fails)"; exit 1; }

# ── 0. Kontenery ────────────────────────────────────────────────────────────
running=$(docker ps --format '{{.Names}}' 2>/dev/null || true)
if [ -z "$running" ]; then
  fail "Docker nie odpowiada (daemon OFF?)" "start Dockera (owner-only), potem: npm run dev"
  bail
fi
for c in main-dev web-1-dev "$DB_CONTAINER"; do
  # -F: nazwa kontenera to literał, nie regex (kropka w nazwie matchowałaby cokolwiek).
  if ! grep -qxF "$c" <<<"$running"; then
    fail "kontener '$c' nie działa" "npm run dev  (scripts/containers/build-and-up-dev)"
  fi
done
[ "$fails" -gt 0 ] && bail

# ── Kanarek: account_id istniejącej stylistki (demo → dowolna) ──────────────
# rc psql rozróżnia „baza bez seeda" (rc=0, pusty wynik → SKIP A/C) od „psql nie
# działa" (rc≠0 → FAIL). Bez tego zły DB_USER/nazwa kontenera cicho wyłączał DWIE
# z pięciu klas, a skrypt kończył zielono.
psql_dev() { docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>&1; }
ACCOUNT_ID=""
db_err=""
q_out=$(psql_dev "SELECT sa.account_id FROM \"StylistAccount\" sa JOIN users u ON u.id=sa.created_by_user_id
   WHERE u.email='$DEMO_STYLIST_EMAIL' LIMIT 1"); q_rc=$?
if [ "$q_rc" -ne 0 ]; then
  db_err="$q_out"
else
  ACCOUNT_ID=$(tr -d '[:space:]' <<<"$q_out")
  if [ -z "$ACCOUNT_ID" ]; then
    q_out=$(psql_dev "SELECT account_id FROM \"StylistAccount\" LIMIT 1"); q_rc=$?
    if [ "$q_rc" -ne 0 ]; then db_err="$q_out"; else ACCOUNT_ID=$(tr -d '[:space:]' <<<"$q_out"); fi
  fi
fi
# psql_dev scala stderr do stdout (żeby mieć treść błędu w diagnozie), więc kanarek
# musi mieć KSZTAŁT id — inaczej NOTICE/WARNING wjechałby jako "account_id" i check A
# dostałby 404 na śmieciowym URL-u, raportując fałszywą klasę A.
if [ -n "$ACCOUNT_ID" ] && ! grep -qE '^[a-z0-9]{16,}$' <<<"$ACCOUNT_ID"; then
  db_err="psql zwrócił coś, co nie jest account_id: ${ACCOUNT_ID:0:80}"
  ACCOUNT_ID=""
fi
if [ -n "$db_err" ]; then
  fail "psql w kontenerze '$DB_CONTAINER' nie wykonał zapytania (${db_err:0:120}) — checki A i C NIE zostały wykonane" \
       "sprawdź kontener/dane dostępu (DB_CONTAINER/DB_USER/DB_NAME muszą zgadzać się z docker-compose.dev.yml), potem: docker logs --since 5m $DB_CONTAINER"
fi

# ── E. Kto NAPRAWDĘ odpowiada na porcie frontu (host vs kontener) ───────────
# Wołane tylko przy anomalii — na zdrowym stacku zero kosztu.
container_front_code() {
  docker exec main-dev node -e '
    fetch("http://localhost:3000" + process.argv[1], { signal: AbortSignal.timeout(5000) })
      .then(r => console.log(r.status))
      .catch(() => console.log("000"));
  ' "$1" 2>/dev/null | tr -d '[:space:]'
}

# ── A. Trasa dynamiczna [param] — SSR 200 ───────────────────────────────────
# Kanoniczny URL Z ukośnikiem: od 2026-09-23 proxy.ts robi 301 z wersji bez
# ukośnika, a curl z hosta nie idzie za przekierowaniem, podczas gdy fetch w
# kontenerze idzie — bez ukośnika host widział 301, kontener 200, i check E
# fałszywie ogłaszał „złodzieja portu".
if [ -z "$ACCOUNT_ID" ]; then
  [ -z "$db_err" ] && skip "check A/C — brak jakiejkolwiek stylistki w dev DB (świeży stack bez seeda?)"
else
  # UWAGA: bez `|| echo 000` — curl przy padzie połączenia i tak drukuje 000
  # przez -w, a fallback DOKLEJAŁ drugie 000 → "000000" psuło case/porównania.
  warm "$FRONTEND_URL/stylist/$ACCOUNT_ID/"
  code=$($CURL -o /dev/null -w '%{http_code}' "$FRONTEND_URL/stylist/$ACCOUNT_ID/" 2>/dev/null || true)
  code=${code:-000}
  if [ "$code" = "200" ]; then
    ok "trasa dynamiczna /stylist/[identifier] = 200"
  elif [ "$code" = "000" ]; then
    # Nikt nie odpowiada = nie ma czego dyskryminować sondą E (tam ktoś ODPOWIADA, tylko nie main-dev).
    fail "front nie odpowiada na $FRONTEND_URL" "npm run dev / sprawdź docker logs main-dev"
  elif [ "$(container_front_code "/stylist/$ACCOUNT_ID/")" = "200" ]; then
    fail "z HOSTA trasa dynamiczna = HTTP $code, ale TEN SAM URL wewnątrz kontenera main-dev = 200 — na porcie frontu odpowiada COŚ INNEGO niż main-dev (leftover 'next dev' hosta — klasa E; docker ps kłamie, logi kontenera będą czyste)" \
         "znajdź złodzieja portu: ss -ltnp 'sport = :3000'  (lub lsof -i :3000) → kill PID procesu HOSTA; NIE odpalaj drugiego next dev"
  else
    case "$code" in
      404) fail "trasa dynamiczna = SSR 404 (uszkodzony .next deva — klasa A; padają WSZYSTKIE [param])" \
                "npm run dev:recreate -- main-dev" ;;
      *)   fail "trasa dynamiczna = HTTP $code" "docker logs --since 5m main-dev" ;;
    esac
  fi
fi

# ── B. Backend + świeżość Prisma clienta ────────────────────────────────────
# dev-login stoi za INTERNAL_SHARED_SECRET (DECISION w pages/api/auth/dev-login):
# sekret skonfigurowany → brak/zły nagłówek = 404-maska PRZED businessLogic, więc
# sonda nigdy nie dotyka Prismy. Bez tego nagłówka „✓ backend żyje (404)" byłoby
# fałszywą zielenią, a gałąź 5xx (klasa B) martwa. Źródło sekretu jak w
# qa-authed-screenshot.cjs: env procesu, a gdy pusty — web-1/.env.development.
internal_secret="${INTERNAL_SHARED_SECRET:-}"
if [ -z "$internal_secret" ] && [ -f "$WEB1_ENV_DEV" ]; then
  internal_secret=$(sed -n 's/^INTERNAL_SHARED_SECRET=//p' "$WEB1_ENV_DEV" | head -1 \
    | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")
fi
secret_header=()
[ -n "$internal_secret" ] && secret_header=(-H "x-internal-secret: $internal_secret")

# Ta sama rozgrzewka po stronie backendu: pierwsze wejście w route API też płaci
# za kompilację, a gałąź 000 („backend nie odpowiada") jest tu równie myląca.
# POST, nie GET: `GET /api/auth/dev-login` oddaje 405 jeszcze przed handlerem,
# wiec rozgrzewka grzala odrzucenie zamiast realnej sciezki (walidacja, sesja, DB).
warm_post "$BACKEND_URL/api/auth/dev-login"
login_code=$($CURL -o /dev/null -w '%{http_code}' -X POST "$BACKEND_URL/api/auth/dev-login" \
  -H 'content-type: application/json' -H "Origin: $FRONTEND_URL" \
  ${secret_header[@]+"${secret_header[@]}"} \
  -d "{\"email\":\"$DEMO_STYLIST_EMAIL\"}" 2>/dev/null || true)
login_code=${login_code:-000}
case "$login_code" in
  2*)  ok "backend żyje, dev-login mintuje sesję ($login_code)" ;;
  000) fail "backend nie odpowiada na $BACKEND_URL" "npm run dev / docker logs web-1-dev" ;;
  500) fail "dev-login = HTTP 500 (stale Prisma client po zmianie schematu — klasa B)" \
            "docker restart web-1-dev" ;;
  5*)  fail "dev-login = HTTP $login_code — backend niegotowy albo proxy nie ma upstreamu (to NIE klasa B; restart w tej fazie tylko wydłuży czekanie)" \
            "poczekaj aż web-1-dev wstanie i powtórz; jeśli utknęło: docker logs --since 5m web-1-dev" ;;
  404) fail "dev-login = 404 (maska sekretu/env) — sonda klasy B ŚLEPA, request nie dociera do Prismy" \
            "porównaj INTERNAL_SHARED_SECRET w web-1/.env.development z tym w kontenerze i sprawdź NODE_ENV/NODE_ENV_MANUAL (maska zapala się też poza DEVELOPMENT): npm run dev:recreate -- web-1-dev" ;;
  *)   fail "dev-login = HTTP $login_code — sonda klasy B nie dotarła do DB (406 = Origin '$FRONTEND_URL' spoza CORS_ALLOWED_ORIGINS)" \
            "docker logs --since 5m web-1-dev" ;;
esac
if [ -n "$ACCOUNT_ID" ]; then
  body=$($CURL "$BACKEND_URL/api/v1/public/get-stylist-profile?identifier=$ACCOUNT_ID" || true)
  if grep -q '"view_count"' <<<"$body"; then
    ok "endpoint domenowy zwraca dane (Prisma client świeży)"
  elif grep -qE 'DATABASE_ERROR|GENERAL_ERROR' <<<"$body"; then
    fail "endpoint domenowy = błąd DB (stale Prisma client — klasa B)" "docker restart web-1-dev"
  else
    fail "endpoint domenowy bez oczekiwanych danych (odpowiedź: ${body:0:120})" \
         "docker logs --since 5m web-1-dev"
  fi
fi

# ── C. Spójność SSR HTML ↔ __NEXT_DATA__ (turbopack stale-HTML) ─────────────
# Kanarek: liczba statItem w HTML musi zgadzać się z liczbą wynikającą z PROPS
# tej samej odpowiedzi. HTML z innej „ery" niż props = mismatch → fałszywe
# hydration errory. Formuła jest LUSTRZANA do gate'a widoczności statów, więc
# progi CZYTAMY z molecule (STAT_MIN_TO_SHOW = SSOT, owner-głos 2026-07-15:
# „prace" zawsze + bookmarks/likes/views powyżej progu) — ręczna kopia progów
# rozjeżdżała się przy każdym tuningu i dawała fałszywe MISMATCH.
# UWAGA S56: view_count w SSR ma suppressHydrationWarning (żywy licznik toleruje
# różnicę SSR↔client bez regeneracji drzewa — patrz DECISION w
# StylistProfileStats.molecule). statItem NADAL renderowany w SSR gdy próg
# przekroczony, więc kanarek (liczba statItem) pozostaje aktualny.
stat_min() {
  sed -n 's/.*STAT_MIN_TO_SHOW = {\(.*\)}.*/\1/p' "$STATS_MOLECULE" 2>/dev/null | head -1 \
    | sed -n "s/.*$1:[[:space:]]*\([0-9][0-9]*\).*/\1/p"
}
if [ -n "$ACCOUNT_ID" ]; then
  MIN_BOOKMARKS=$(stat_min bookmarks); MIN_LIKES=$(stat_min likes); MIN_VIEWS=$(stat_min views)
  if [ -z "$MIN_BOOKMARKS" ] || [ -z "$MIN_LIKES" ] || [ -z "$MIN_VIEWS" ]; then
    skip "check C — nie odczytałem progów STAT_MIN_TO_SHOW z ${STATS_MOLECULE#"$ROOT_DIR"/} (zmienił się kształt stałej? zaktualizuj parser stat_min)"
  else
    cres=$(FRONTEND_URL="$FRONTEND_URL" ACCOUNT_ID="$ACCOUNT_ID" \
      MIN_BOOKMARKS="$MIN_BOOKMARKS" MIN_LIKES="$MIN_LIKES" MIN_VIEWS="$MIN_VIEWS" node -e '
      (async () => {
        const res = await fetch(`${process.env.FRONTEND_URL}/stylist/${process.env.ACCOUNT_ID}`, {
          signal: AbortSignal.timeout(6000),
        });
        const html = await res.text();
        const m = html.match(/"initialProfile":({.*?"total_likes":\d+)/);
        if (!m) { console.log("SKIPDATA"); return; }
        const num = key => Number((m[1].match(new RegExp(`"${key}":(\\d+)`)) || [])[1] ?? 0);
        const min = key => Number(process.env[key]);
        const viewCount = num("view_count");
        const statItems = (html.match(/statItem/g) || []).length;
        const expected =
          1 +
          (num("bookmark_count") >= min("MIN_BOOKMARKS") ? 1 : 0) +
          (num("total_likes") >= min("MIN_LIKES") ? 1 : 0) +
          (viewCount >= min("MIN_VIEWS") ? 1 : 0);
        console.log(statItems === expected ? "OK" : `MISMATCH html=${statItems} expected=${expected} view_count=${viewCount}`);
      })().catch(e => console.log("ERR " + e.message));
    ' 2>&1)
    case "$cres" in
      OK)        ok "SSR HTML spójny z __NEXT_DATA__ (brak stale-HTML)" ;;
      SKIPDATA)  skip "check C — strona bez initialProfile (backend padł w SSR? patrz check B)" ;;
      MISMATCH*) fail "SSR HTML z innej ery niż props ($cres) — turbopack stale-HTML (klasa C; fałszywe hydration errory)" \
                      "npm run dev:recreate -- main-dev" ;;
      *)         skip "check C — nie udało się ocenić ($cres)" ;;
    esac
  fi
fi

# ── D. HMR: allowlista originów deva ────────────────────────────────────────
# D1 (zawsze): env kontenera vs SSOT w docker-compose.dev.yml. Łapie CAŁĄ listę
# (także LAN IP, którego handshake przez domenę nie dotyka) i działa bez Caddy'ego
# — to dokładnie regresja 2026-08-18: recreate main-dev bez obu plików compose
# zostawiał kontener ze starym/pustym ALLOWED_DEV_ORIGINS.
compose_origins=$(sed -n 's/^[[:space:]]*-[[:space:]]*ALLOWED_DEV_ORIGINS=//p' "$COMPOSE_DEV" 2>/dev/null | head -1 | tr -d '\r')
container_origins=$(docker inspect main-dev --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
  | sed -n 's/^ALLOWED_DEV_ORIGINS=//p' | head -1 | tr -d '\r')
if [ ! -f "$COMPOSE_DEV" ]; then
  fail "nie znalazłem ${COMPOSE_DEV} — nie mam z czym porównać allowlisty HMR kontenera" \
       "uruchom preflight z repo (ścieżki liczone od scripts/dev/) albo wskaż plik: COMPOSE_DEV=... npm run dev:preflight"
elif [ -z "$compose_origins" ]; then
  fail "ALLOWED_DEV_ORIGINS zniknął z docker-compose.dev.yml (SSOT allowlisty HMR)" \
       "przywróć wpis w usłudze main-dev (patrz DECISION w tym pliku), potem: npm run dev:recreate -- main-dev"
elif [ "$container_origins" != "$compose_origins" ]; then
  fail "kontener main-dev ma inną allowlistę HMR niż compose (kontener: '${container_origins:-BRAK}' vs SSOT: '$compose_origins') — stary env po recreate bez obu plików compose albo edycja compose bez recreate (klasa D)" \
       "npm run dev:recreate -- main-dev"
else
  ok "ALLOWED_DEV_ORIGINS w main-dev = SSOT compose ($compose_origins)"
fi

# D2 (gdy dev-caddy): handshake WebSocketu przez publiczny origin — dowód end-to-end.
# Next 16 odrzuca upgrade /_next/webpack-hmr z Origin spoza allowedDevOrigins
# (`socket.end('Unauthorized')` — surowy tekst bez linii statusu, więc przez Caddy
# widać to jako 502; 403 zapala się tylko na zwykłym HTTP, nie na upgrade) → klient
# po 13 nieudanych handshake'ach robi window.location.reload() (~co 50 s) i Fast
# Refresh nie działa wcale. Handshake sprawdzamy END-TO-END przez Caddy (jak
# przeglądarka), z --resolve na 127.0.0.1, żeby nie zależeć od DNS/LAN. Po 101
# serwer trzyma socket otwarty (zero ramek) → curl czeka do --max-time, a bash na
# cały pipeline — stąd krótki timeout (loopback TLS = ms). 502 rozróżniamy sondą
# GET: „Caddy nie dosięga upstreamu" vs „origin zablokowany".
DEV_PUBLIC_ORIGIN="${DEV_PUBLIC_ORIGIN:-https://dev.example.com}"
dev_scheme="${DEV_PUBLIC_ORIGIN%%://*}"
dev_hostport="${DEV_PUBLIC_ORIGIN#*://}"; dev_hostport="${dev_hostport%%/*}"
dev_host="${dev_hostport%%:*}"; dev_port="${dev_hostport##*:}"
# Bez jawnego portu domyślny wynika ze SCHEMATU (http→80), nie zawsze 443.
if [ "$dev_port" = "$dev_hostport" ]; then
  [ "$dev_scheme" = "http" ] && dev_port=80 || dev_port=443
fi
DEV_RESOLVE=(--resolve "${dev_host}:${dev_port}:127.0.0.1")
if grep -qxF dev-caddy <<<"$running"; then
  # DECISION (nie usuwaj tego komentarza) — SCIEZKA HMR ZALEZY OD BUNDLERA, WIEC PROBUJEMY OBU:
  # do 2026-09-16 stalo tu na sztywno `/_next/webpack-hmr`. Next 16 idzie domyslnie
  # Turbopackiem i wystawia HMR pod `/_next/hmr`, wiec proba pod stara sciezka wracala PUSTA —
  # a `case` nizej traktowal pusta odpowiedz jak odrzucenie i orzekal „host poza
  # ALLOWED_DEV_ORIGINS". Sprzecznie z wlasnym checkiem A dwie linie wyzej, ktory tej samej
  # allowlisty pilnuje i swiecil na zielono. Zmierzone: `/_next/hmr` przez te sama domene
  # zwraca 101, czyli HMR zyl przez caly czas, a straznik pokazywal fałszywą czerwień
  # i przypisywal jej przyczyne, ktorej nie zmierzyl.
  # Probujemy najpierw Turbopacka, potem webpacka — pierwszy 101 wygrywa.
  ws_probe() {
    curl -s -i --http1.1 --max-time 2 "${DEV_RESOLVE[@]}" \
      -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
      -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H "Origin: $DEV_PUBLIC_ORIGIN" \
      "$DEV_PUBLIC_ORIGIN$1" 2>/dev/null | head -1 | tr -d '\r'
  }
  ws_status=$(ws_probe /_next/hmr)
  case "$ws_status" in
    *" 101 "*) : ;;
    *) ws_status=$(ws_probe /_next/webpack-hmr) ;;
  esac
  case "$ws_status" in
    *" 101 "*) ok "HMR WebSocket przez $dev_hostport = 101 (origin na allowliście main-dev)" ;;
    *" 403 "*|*" 502 "*|"")
      probe=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "${DEV_RESOLVE[@]}" \
        "$DEV_PUBLIC_ORIGIN/robots.txt" 2>/dev/null || true)
      case "${probe:-000}" in
        2*|3*) fail "HMR WebSocket przez $dev_hostport odrzucony (${ws_status:-brak odpowiedzi}), choć HTTP przez Caddy działa — host poza ALLOWED_DEV_ORIGINS main-dev → Next reloaduje stronę co ~50 s, HMR martwy (klasa D)" \
                    "npm run dev:recreate -- main-dev   (lista: docker-compose.dev.yml; recreate BEZ obu plików compose lub bez hosta na liście = regresja)" ;;
        *)     fail "Caddy nie dosięga upstreamu main-dev przez $dev_hostport (HMR: ${ws_status:-brak odpowiedzi}, GET robots.txt: ${probe:-000}) — to sieć/upstream, NIE allowlista" \
                    "docker logs --since 5m dev-caddy; docker logs --since 5m main-dev   (main-dev dopiero wstaje? poczekaj i powtórz; Caddy zgubił upstream po recreate? npm run dev:recreate -- caddy)" ;;
      esac ;;
    *) fail "HMR WebSocket przez $dev_hostport: nieoczekiwana odpowiedź ($ws_status)" \
            "docker logs --since 5m main-dev | grep -i 'cross-origin'" ;;
  esac
else
  skip "check D2 — dev-caddy nie działa (stack bez SSL override; HMR przez domenę nietestowalny)"
fi

# ── F. Moduły ładowane RAZ przy starcie backendu (instrumentation) ────────────
# `web-1/src/instrumentation.ts` importuje listenery zdarzeń (maile o aktywności,
# parowaniu, sesjach) i monitory zdrowia JEDEN raz, przy bootcie procesu. Turbopack
# dev NIE uruchamia instrumentation ponownie, gdy te pliki się zmienią: subskrypcje
# trzymają stare domknięcia aż do restartu. Zmierzone S124/s34: po commicie bramki
# zgody na maile trzy z czterech ścieżek wysyłały dalej, bo kontener wystartował
# przed zmianą — każdy test maili na devie oceniał wtedy stary kod.
web1_started=$(docker inspect web-1-dev --format '{{.State.StartedAt}}' 2>/dev/null || true)
if [ ! -f "$ROOT_DIR/web-1/src/instrumentation.ts" ]; then
  # Podłoga obecności: bez pliku `find` nic nie znajdzie i check świeciłby na
  # zielono nad drzewem, którego nie zmierzył.
  fail "check F nie widzi web-1/src/instrumentation.ts pod $ROOT_DIR — nie mam czego mierzyć" \
       "uruchom preflight z repo (npm run dev:preflight) albo popraw ścieżki checku F"
elif [ -z "$web1_started" ]; then
  skip "check F — kontener web-1-dev nie działa (nie ma czego porównać)"
else
  boot_changed=$(find "$ROOT_DIR/web-1/src/instrumentation.ts" \
    "$ROOT_DIR/web-1/src/application/email-handler" \
    "$ROOT_DIR/web-1/src/application/health" \
    -type f -name '*.ts' ! -name '*.test.ts' -newermt "$web1_started" 2>/dev/null | head -5)
  if [ -n "$boot_changed" ]; then
    fail "backend dev działa na STARYM kodzie modułów bootowych (zmienione po starcie kontenera $web1_started): $(echo "$boot_changed" | sed "s#$ROOT_DIR/##" | tr '\n' ' ')" \
         "docker restart web-1-dev   (instrumentation i listenery zdarzeń nie przeładowują się przez HMR)"
  else
    ok "moduły bootowe backendu (instrumentation, listenery maili, monitory) nie są nowsze niż start web-1-dev"
  fi
fi

echo
if [ "$fails" -gt 0 ]; then
  echo "PREFLIGHT: FAIL ($fails) — napraw stack ZANIM zaczniesz QA/diagnozę (to artefakty deva, nie bugi produktu)."
  exit 1
fi
echo "PREFLIGHT: OK — dev-stack zdrowy."
