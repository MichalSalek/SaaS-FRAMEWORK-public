#!/bin/bash
# circular-imports.sh — Guard: zero runtime/value import cycles in main/src i web-1/src.
#
# INTENT (FQC W0.5e + BDX W1.6, scalone S102):
#   Cykl na krawędzi WARTOŚCI potrafi wywrócić moduł w runtimie (TDZ crash):
#   symbol jest czytany, zanim drugi moduł skończył się wyliczać. Backend miał
#   27 takich cykli, WSZYSTKIE przez jeden węzeł — `eventLogIO.wrapper.api.ts`
#   sięgał po dwa user-utils przez BARREL `@app/interceptors/do*-interceptors`,
#   który re-eksportował interceptory importujące z powrotem `recordAuditEvent_IO`.
#   Naprawa: import z REALNYCH źródeł (`@domain/user/...`), nie z barrela.
#
# CO SPRAWDZA:
#   `madge --circular` po `src` każdego workspace'u, skonfigurowane przez jego
#   własny `.madgerc`:
#     - skipTypeImports: true → liczą się TYLKO krawędzie wartości. Krawędzie
#       `import type` są wymazywane przez TS, więc nigdy nie dochodzą do runtime.
#     - excludeRegExp: READONLY-shared-kernel → propagowana kopia kernela jest
#       domeną kernela, jej (type-only) cykle są poza zakresem ratchetu.
#   web-1 dodatkowo rozwiązuje aliasy `@app`/`@domain`/`@kernel` przez tsConfig —
#   BEZ tego zaaliasowane importy wyglądają na zewnętrzne i madge widzi 0 cykli
#   tam, gdzie jest ich 27 (dowód RED-FIRST: przywróć import barrela → 27, EXIT 1).
#
#   Baseline = 0 cykli wartości w obu workspace'ach.
#
# SCALENIE DWÓCH SKRYPTÓW (S102): `circular-deps.sh` (web-1) i `circular-imports.sh`
#   (main) były tym samym kodem z podmienioną nazwą katalogu i inną prozą — dwie
#   kopie jednej reguły, czyli dokładnie ten dług, który reszta tego katalogu
#   ściga w kodzie produktu. Jeden skrypt, pętla po workspace'ach.
set -euo pipefail
source "$(dirname "$0")/_utils.sh"

PROJECT_ROOT=$(get_project_root)

print_boxed_header "CIRCULAR IMPORTS AUDIT — main + web-1 (madge — value cycles)" "🔄"

FAILED=0

for WS in main web-1; do
  WS_DIR="$PROJECT_ROOT/$WS"
  require_source_dir "$WS_DIR/src" "źródeł $WS"

  if [[ ! -d "$WS_DIR/node_modules/madge" ]]; then
    # Fail-open ŚWIADOMY i głośny: madge jest devDependency, więc w świeżym
    # klonie bez `npm ci` w submodule tej bramki fizycznie nie ma czym uruchomić.
    # Ostrzeżenie, nie czerwień — ale w run-all widać je tylko w logu, więc
    # traktuj je jak brak pomiaru, nie jak wynik.
    print_warning "madge nie zainstalowany w $WS (devDep) — pomijam cykle tego workspace'u."
    continue
  fi

  if MADGE_OUT=$(cd "$WS_DIR" && npx --no-install madge --circular --extensions ts,tsx src 2>&1); then
    print_success "$WS: zero value-cykli importów (madge skipTypeImports)."
    continue
  fi

  print_error "$WS: madge wykrył runtime/value-cykle (ryzyko TDZ crash):"
  echo "$MADGE_OUT" | grep -vE "^- Finding|^Processed|Finding files" | tail -30
  FAILED=1
done

if [[ $FAILED -ne 0 ]]; then
  print_info "Fix: przenieś współdzielony symbol poza cykl / odwróć zależność / importuj z realnego źródła zamiast barrela / zamień jednokierunkowy import na 'import type'."
  exit 1
fi

exit 0
