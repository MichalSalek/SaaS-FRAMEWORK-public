#!/usr/bin/env bash
# better-auth-dispatch-contract.sh — Kontrakt dwóch pól, które Better Auth USTAWIA
# W RUNTIME na `ctx.context`, a których NIE DEKLARUJE w typach.
#
# INTENT:
#   `ctx.context.returned` i `ctx.context.responseHeaders` są pisane przez hook-runner
#   biblioteki (`dist/api/dispatch.mjs`) tuż przed `hooks.after`:
#
#       internalContext.context.returned = result.response;
#       internalContext.context.responseHeaders = result.headers ?? void 0;
#
#   Stoją na nich DWIE rzeczy, obie na gorącej ścieżce logowania:
#     - `better-auth-failure-tracking.ts` — audyt CANNOT_LOGIN (nieudane logowania,
#       artefakt bezpieczeństwa: brute-force / credential-stuffing);
#     - `better-auth-hooks.ts handleLoginTokenBridge` — MOSTEK TOKENÓW, czyli wariant C
#       exchange-code (przepisanie nagłówka `location` na redirect z jednorazowym kodem).
#       Bez tego skorupa natywna nie dostaje tokenu i logowanie umiera.
#
#   Biblioteka deklaruje oba pola WYŁĄCZNIE na wewnętrznym, NIEEKSPORTOWANYM
#   `DispatchContext` (`dist/api/dispatch.d.mts`); `GenericEndpointContext` niesie goły
#   `AuthContext`, w którym ich nie ma. Czyli tsc tej zależności NIE PILNUJE — do 1.6.25
#   przechodziło to bocznym kanałem strukturalnym, od 1.7.x tsc daje TS2339 i jedynym
#   wyjściem jest udokumentowany rzut w `better-auth-dispatch-context.ts`.
#
# PO CO TEN STRAŻNIK — CZYLI PO CO W OGÓLE ODPINAĆ WERSJĘ:
#   `better-auth` był PRZYPIĘTY dokładnie na 1.6.25 właśnie dlatego, że zniknięcie
#   `returned` psuje się CICHO: `extractFailureFromReturned(undefined)` grzecznie zwraca
#   `null`, żaden test nie czerwienieje, żaden log nie krzyczy, a audyt nieudanych logowań
#   po prostu przestaje istnieć. Przypięcie było obejściem leczącym skutek. Ten strażnik
#   leczy przyczynę: zamienia ciche ryzyko na GŁOŚNE — czerwoną bramkę przy pushu zamiast
#   niespodzianki na produkcji. Rzut w akcesorze jest bezpieczny dokładnie tak długo,
#   jak długo POŁOWA A poniżej jest zielona, i to jest cała umowa.
#
#   Mierzone (2026-09-16): 1.6.25 i 1.7.5 mają w tym miejscu IDENTYCZNY runtime;
#   `getEndpointResponse` — własny helper biblioteki — czyta `ctx.context.returned`
#   dokładnie tak samo, więc nie ma dziś lepszego, „bardziej publicznego" zaczepienia.
#
# CO SPRAWDZA:
#   POŁOWA A (runtime biblioteki): w ZAINSTALOWANYM `better-auth/dist/api/dispatch.mjs`
#     nadal stoją OBA przypisania. Pakiet jest szukany przez rozwiązanie modułu (łańcuch
#     `node_modules` od `web-1/` w górę), a NIE po sztywnej ścieżce — dzięki temu
#     hoisting/dedup npm-a nic tu nie zmienia.
#   POŁOWA B (repo): nikt nie czyta tych pól z pominięciem akcesora
#     `better-auth-dispatch-context.ts` — jednego miejsca z rzutem i jednego miejsca
#     do sprawdzenia przy następnym podbiciu biblioteki.
#
# MIERZALNOŚĆ (lekcja S87/S113 — „nie umiem zmierzyć" ≠ „jest dobrze"):
#   Brak pakietu, brak `dispatch.mjs` albo pusty odczyt nad NIEPUSTYM plikiem = EXIT 1
#   z jasnym komunikatem, nigdy cicha zieleń. Tak samo brak samego akcesora.
#
# ESCAPE: brak. Te dwa pola albo są, albo logowanie jest zepsute — nie ma tu „uzasadnionego
#   wyjątku", a escape byłby wyłącznie sposobem na przegłosowanie czerwieni.
#
# EXIT: 0 = PASS, 1 = kontrakt złamany.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"

print_boxed_header "Better Auth: kontrakt dispatch (returned + responseHeaders)" "🔐"

ACCESSOR_REL="web-1/src/application/auth/better-auth/better-auth-dispatch-context.ts"
ACCESSOR="${ROOT}/${ACCESSOR_REL}"

# --- asercja kotwicy: akcesor MUSI istnieć (S113 własność 3) ---
if [[ ! -f "$ACCESSOR" ]]; then
  print_error "Brak akcesora: ${ACCESSOR_REL}"
  echo "   To jedyne miejsce w repo, któremu wolno rzutować te pola."
  echo "   Jeśli został przeniesiony — zaktualizuj ŚCIEŻKĘ w tym strażniku, nie kasuj sprawdzenia."
  exit 1
fi

FAILED=0

# ─────────────────────────────────────────────────────────────────────────────
print_header "POŁOWA A — runtime zainstalowanego better-auth"

DISPATCH="$(node -e '
const fs = require("fs"), path = require("path");
const start = process.argv[1];
// Łańcuch node_modules od web-1/ w górę — odporne na hoisting i na dedup do roota.
let dir = start, found = null;
while (true) {
  const cand = path.join(dir, "node_modules", "better-auth", "dist", "api", "dispatch.mjs");
  if (fs.existsSync(cand)) { found = cand; break; }
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}
process.stdout.write(found ?? "");
' "${ROOT}/web-1")"

if [[ -z "$DISPATCH" ]]; then
  print_error "Nie znalazłem better-auth/dist/api/dispatch.mjs w łańcuchu node_modules od web-1/."
  echo "   NIE UMIEM ZMIERZYĆ kontraktu → to jest czerwień, nie zieleń."
  echo "   Najpewniej: brak 'npm install' w web-1/ albo zmiana układu paczki."
  exit 1
fi

print_info "dispatch.mjs: ${DISPATCH#$ROOT/}"

if [[ ! -s "$DISPATCH" ]]; then
  print_error "dispatch.mjs jest PUSTY — odczyt niemiarodajny."
  exit 1
fi

BA_VERSION="$(node -e '
const fs=require("fs"), path=require("path");
const p = path.join(path.dirname(process.argv[1]), "..", "..", "package.json");
try { process.stdout.write(JSON.parse(fs.readFileSync(p,"utf8")).version ?? "?"); }
catch { process.stdout.write("?"); }
' "$DISPATCH")"
print_info "wersja better-auth: ${BA_VERSION}"

# Przypisania, nie wzmianki: szukamy `context.returned =` / `context.responseHeaders =`
# (z dowolnym prefiksem obiektu), z wykluczeniem porównań `==`/`===`.
check_assignment() {
  local field="$1" label="$2"
  local hits
  hits="$(grep -cE "context\.${field}[[:space:]]*=[^=]" "$DISPATCH" || true)"
  if [[ "$hits" -gt 0 ]]; then
    print_success "${label}: przypisanie obecne (${hits}×)"
  else
    print_error "${label}: BRAK przypisania w dispatch.mjs (better-auth ${BA_VERSION})"
    echo "     Skutek, gdyby to przeszło niezauważone:"
    if [[ "$field" == "returned" ]]; then
      echo "       audyt CANNOT_LOGIN przestaje zapisywać nieudane logowania — PO CICHU."
    else
      echo "       mostek tokenów (wariant C exchange-code) nie przepisze nagłówka location"
      echo "       → skorupa natywna nie dostaje tokenu → logowanie martwe."
    fi
    echo "     Co zrobić: przypiąć better-auth do ostatniej działającej wersji ALBO"
    echo "     zmigrować ${ACCESSOR_REL} na nowe API i zaktualizować ten strażnik."
    FAILED=1
  fi
}

check_assignment "returned" "ctx.context.returned"
check_assignment "responseHeaders" "ctx.context.responseHeaders"

# ─────────────────────────────────────────────────────────────────────────────
print_header "POŁOWA B — repo czyta te pola wyłącznie przez akcesor"

SCAN_DIRS=()
for d in "${ROOT}/web-1/src" "${ROOT}/main/src" "${ROOT}/.shared-kernel"; do
  [[ -d "$d" ]] && SCAN_DIRS+=("$d")
done

if [[ ${#SCAN_DIRS[@]} -eq 0 ]]; then
  print_error "Brak katalogów źródłowych do skanu — nie umiem zmierzyć POŁOWY B."
  exit 1
fi

OFFENDERS="$(node -e '
const fs = require("fs"), path = require("path");
const accessorRel = process.argv[1];
const roots = process.argv.slice(2);

// Strip komentarzy ORAZ tresci literalow tekstowych, z zachowaniem numerow linii.
// Liczymy KOD, nie WZMIANKI — i to nie jest ostroznosc na zapas: pierwszy przebieg
// tego straznika wywrocil sie na wlasnym tescie, bo nazwa testu brzmiala
// describe(...kontrakt ctx.context.returned...). DECISION-y i opisy testow cytuja
// te pola doslownie i nie moga wywracac straznika, ktory ich pilnuje.
//
// Cudzyslowy zapisane HEKSADECYMALNIE (\x27 \x22 \x60) celowo: ten skaner jedzie
// w node -e wewnatrz bash-owego literalu w apostrofach, wiec kazdy doslowny
// apostrof albo backtick zamknalby go w polowie. Nie "upraszczac" tego z powrotem.
const QUOTES = /([\x27\x22\x60])(?:\\.|(?!\1)[^\\])*\1/g;
const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
   .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
   .replace(QUOTES, (m, q) => q + m.slice(1, -1).replace(/[^\n]/g, " ") + q);

const out = [];
const walk = (dir) => {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === "dist" || e.name === "out") continue;
      if (e.name.startsWith("READONLY-")) continue; // kopie jądra = artefakt
      walk(p);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(e.name) || e.name.endsWith(".d.ts")) continue;
    const norm = p.split(path.sep).join("/");
    if (norm.endsWith(accessorRel)) continue; // jedyne dozwolone miejsce
    let src;
    try { src = fs.readFileSync(p, "utf8"); } catch { continue; }
    if (src.length === 0) continue;
    const code = strip(src);
    code.split("\n").forEach((line, i) => {
      if (/\.context\s*\??\.\s*(returned|responseHeaders)\b/.test(line)) {
        out.push(norm + ":" + (i + 1) + ": " + line.trim());
      }
    });
  }
};
roots.forEach(walk);
process.stdout.write(out.join("\n"));
' "src/application/auth/better-auth/better-auth-dispatch-context.ts" "${SCAN_DIRS[@]}")"

if [[ -n "$OFFENDERS" ]]; then
  print_error "Bezpośredni odczyt pól dispatch z pominięciem akcesora:"
  echo "$OFFENDERS" | sed 's|^|     |'
  echo ""
  echo "   Czytaj przez getDispatchReturned() / getDispatchResponseHeaders()"
  echo "   z ${ACCESSOR_REL}. Powód: te pola nie są w typach biblioteki, więc każdy"
  echo "   odczyt wymaga rzutu — a rzut rozsiany po plikach to rzut, którego przy"
  echo "   następnym podbiciu wersji nikt nie znajdzie."
  FAILED=1
else
  print_success "Zero bezpośrednich odczytów poza akcesorem"
fi

# --- podłoga obecności: liczymy MIEJSCA UŻYCIA, nie pliki (S113 własność 2) ---
USAGES="$(grep -rhoE "getDispatch(Returned|ResponseHeaders)\(" "${SCAN_DIRS[@]}" \
  --include=*.ts --include=*.tsx 2>/dev/null | wc -l | tr -d ' ')"
# akcesor deklaruje 2 eksporty + 2 realne wywołania w kodzie produkcyjnym
if [[ "$USAGES" -lt 2 ]]; then
  print_error "Podłoga obecności: znaleziono ${USAGES} wywołań akcesora (oczekiwane >= 2)."
  echo "   Albo mostek tokenów / audyt CANNOT_LOGIN zniknął, albo strażnik mierzy pustkę."
  FAILED=1
else
  print_success "Podłoga obecności: ${USAGES} wywołań akcesora"
fi

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  print_success "PASS — kontrakt dispatch trzyma (runtime + repo)"
  exit 0
fi
print_error "FAIL — kontrakt dispatch złamany"
exit 1
