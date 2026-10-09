#!/usr/bin/env bash
# stale-artifacts.sh — flaguje ukończone/przestarzałe zapiski historyczne w docs/.
#
# Deterministyczny: marker-UKOŃCZENIA w nagłówku BEZ markera-OTWARTOŚCI = kandydat do kasacji.
# NIE utrzymujemy list wyjątków (per feedback_audit_determinism: logika, nie allowlist).
# Pliki "zachowane bo deferred" mają marker-otwartości w nagłówku → NIE są flagowane.
#
# Cel: zapobiec gromadzeniu się "review/tracker z wszystkim DONE", które zniekształcają
# obraz ("wszystko zrobione") i zapychają kontekst agentom robiącym rozeznanie.
#
# DWA KATALOGI, DWA CYKLE ŻYCIA (rozdzielone 2026-09-16, S121):
#   _TRACKERS/_REVIEWS są z założenia KRÓTKOŻYJĄCE — mają zostać domknięte i skasowane,
#   więc wiek JEST tam sygnałem i nudge >14d zostaje.
#   PLANS_TODO to BACKLOG. Plan czekający na wykonanie ma prawo leżeć nietknięty
#   miesiącami — flagowanie go po mtime to pomiar niewłaściwej rzeczy, a 13 fałszywych
#   ostrzeżeń na przebieg uczy czytelnika ignorować CAŁE wyjście (dokładnie ten sam
#   mechanizm, przez który strażnik pod-skanujący jest gorszy niż jego brak).
#   Sensowny sygnał dla planu to OSIEROCENIE względem master-indeksu — i to w OBIE
#   strony: plik bez wiersza w indeksie (rozeznanie go nie zobaczy) oraz wiersz
#   indeksu wskazujący na nieistniejący plik (kaskada dokumentacji niedokończona).
#   To jest drift, przed którym ostrzega sekcja DOCUMENTATION CASCADE w AGENTS.md,
#   a dotąd nie mierzył go nikt.
#
# Użycie:  npm run audit:stale-artifacts        (advisory, exit 0)
#          npm run audit:stale-artifacts -- --strict   (exit 1 gdy znajdzie completed-bez-otwartych)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DIRS=("docs/_TRACKERS" "docs/_REVIEWS" "docs/PLANS_TODO")
STALE_DAYS="${STALE_DAYS:-14}"
HEADER_LINES="${HEADER_LINES:-12}"

# Marker, że praca w pliku jest zamknięta:
DONE_RE='✅ *DONE|✅ *COMPLETED|✅ *COMPLETE|COMPLETED —|COMPLETED$|Status:.*\bDONE\b|WSZYSTKIE FAZY DONE|Tracker zamknięty|zamkniięt|zamknięt|Status FINAL|audit DONE|LP audit DONE'
# Marker, że są realnie otwarte pozycje (→ plik ma prawo istnieć):
OPEN_RE='DEFERRED|PENDING|IN PROGRESS|🔄|\bWIP\b|TODO|otwart|🔜|⏸|do om[oó]wienia|PRE-PLAN|🔶|kontynuuj|pamięć między sesjami|wymagają pracy|launch-blocker|blocker|\bopen\b|ODŁOŻ|ODLOZ|zachowany'

# Linia, która NIESIE pozycję: punkt listy, wiersz tabeli albo wyboldowany
# identyfikator pozycji (**P1.**, **BUG-3**). Świadomie BEZ podnagłówków `##` —
# osierocona sekcja bez treści to nie jest otwarta pozycja. Tytuł (`# `) i cytat
# (`> `) też nie pasują, więc kryterium liczy się na CAŁYM pliku: krótka lista
# mieści się w całości poniżej progu HEADER_LINES i obcinanie nagłówka gubiłoby
# jej jedyne pozycje.
ITEM_RE='^[[:space:]]*([-*+][[:space:]]|[0-9]+\.[[:space:]]|\||\*\*[A-ZŁŚŻ0-9])'

flagged=0; stale=0; total=0; orphan=0; dangling=0
INDEX="docs/PLANS_TODO/_MASTER_IMPLEMENTATION_INDEX.md"
# Asercja kotwicy (S113, własność 3): bez indeksu nie umiemy zmierzyć osierocenia,
# a „nie umiem zmierzyć" nie jest werdyktem „jest dobrze".
if [ ! -f "$INDEX" ]; then
  echo "BŁĄD: brak $INDEX — nie da się sprawdzić osierocenia planów." >&2
  exit 1
fi
echo "── Stale-artifacts audit (docs/_TRACKERS · _REVIEWS · PLANS_TODO) ──"
for d in "${DIRS[@]}"; do
  [ -d "$d" ] || continue
  while IFS= read -r f; do
    base="$(basename "$f")"
    case "$base" in _PLAN_TEMPLATE.md|README.md|_MASTER_IMPLEMENTATION_INDEX.md) continue;; esac
    total=$((total+1))
    header="$(head -n "$HEADER_LINES" "$f")"
    has_done=0; has_open=0
    grep -qiE "$DONE_RE" <<<"$header" && has_done=1
    grep -qiE "$OPEN_RE" <<<"$header" && has_open=1
    # Plik nazwany wg konwencji „lista otwartych pozycji" (wzorzec, który ten sam
    # skrypt poleca niżej) jest zamknięty DOPIERO, gdy w treści nie ma już ANI JEDNEJ
    # pozycji. Nagłówek takiego pliku z natury melduje „findingi ZAMKNIĘTE, poniżej
    # tylko to, co zostało" → sam DONE_RE brał go za ukończony i kazał skasować żywą
    # listę (2026-08-31: testy-api-OPEN-ITEMS.md z 3 decyzjami produktowymi i 3
    # pozycjami technicznymi). Liczymy pozycje w CIELE, nie frazy w nagłówku —
    # i robimy to W OBIE STRONY: nagłówek takiego pliku nie może go ani uratować,
    # ani skazać. Rozszerzanie OPEN_RE o słowa z tego nagłówka („pozostałe",
    # „wymagają") dawało odwrotny błąd: pusta lista zostawała „otwarta" na wieki.
    case "$base" in
      *OPEN-ITEMS.md|*open-items.md)
        items="$(grep -cE "$ITEM_RE" "$f")"
        if [ "$items" -gt 0 ]; then has_open=1; else has_open=0; has_done=1; fi
        ;;
    esac
    if [ "$has_done" = 1 ] && [ "$has_open" = 0 ]; then
      echo "  ❌ COMPLETED bez otwartych pozycji → kandydat do kasacji: $f"
      flagged=$((flagged+1))
    elif [ "$d" = "docs/PLANS_TODO" ]; then
      # Backlog: mierzymy osierocenie względem indeksu, NIE wiek (patrz nagłówek).
      if ! grep -qF "$base" "$INDEX"; then
        echo "  ⚠️  plan bez wiersza w master-indeksie → rozeznanie go nie zobaczy: $f"
        orphan=$((orphan+1))
      fi
    elif [ -n "$(find "$f" -mtime +"$STALE_DAYS" 2>/dev/null)" ]; then
      echo "  ⚠️  stale (>${STALE_DAYS}d, brak markera DONE) → zweryfikuj aktualność: $f"
      stale=$((stale+1))
    fi
  done < <(find "$d" -maxdepth 1 -type f -name '*.md' | sort)
done
# Druga strona osierocenia: indeks obiecuje plik, którego nie ma (kaskada urwana).
while IFS= read -r ref; do
  [ -f "docs/PLANS_TODO/$ref" ] || {
    echo "  ⚠️  master-indeks wskazuje na nieistniejący plan → dokończ kaskadę: $ref"
    dangling=$((dangling+1))
  }
done < <(grep -oE '\]\(([A-Z0-9_]+\.md)\)' "$INDEX" | sed -E 's/^\]\((.*)\)$/\1/' | sort -u)

echo "──"
echo "Przeskanowano: $total · completed-bez-otwartych: $flagged · stale>${STALE_DAYS}d: $stale · plany osierocone: $orphan · martwe odnośniki indeksu: $dangling"
if [ "$flagged" -gt 0 ]; then
  echo "→ Zredukuj do otwartych-pozycji (wzór docs/_REVIEWS/mr360-OPEN-ITEMS.md) lub usuń (git zachowa historię)."
fi
if [ "${1:-}" = "--strict" ] && [ "$flagged" -gt 0 ]; then exit 1; fi
exit 0
