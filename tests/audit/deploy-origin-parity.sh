#!/usr/bin/env bash
# deploy-origin-parity.sh — Guard: skrypt deployu sprawdza parytet z origin/master.
#
# INTENT:
#   Wszystkie deploye w tym repo budują albo odtwarzają artefakt z GITA, ale każdy
#   z innej strony — i każdy da się cicho oszukać:
#     • push-based (deploy-backend, deploy-frontend): artefakt powstaje z LOKALNEGO
#       drzewa i leci na prod. Lokalny master ZA origin = wypychasz starszy kod i
#       cofasz cudzą, już wdrożoną pracę.
#     • pull-based (deploy-docker-staging): zdalny box odtwarza się z origin
#       (`reset --hard`). Lokalne commity poza origin NIE dojadą, a deploy i tak
#       melduje sukces (S87: repo miało wtedy root 2 / main 4 / web-1 1 commitów ahead).
#   Oba warianty wyglądają identycznie: „deploy zakończony powodzeniem", tylko na
#   prodzie jest inny kod, niż myślisz. Mechanika porównania jest wspólna
#   (`git_parity_counts` w scripts/utils.sh); POLITYKA (blok/ostrzeżenie/pytanie)
#   należy do skryptu, bo kierunki znaczą co innego po każdej stronie.
#
# WHAT IT CHECKS:
#   Każdy scripts/deploy/deploy-* wywołuje `git_parity_counts`. Komentarze są
#   strippowane przed dopasowaniem, więc sama WZMIANKA w prozie nie zalicza pliku
#   (dokładnie ta klasa fałszywej zieleni, którą ten ratchet ma wykluczyć).
#
# ESCAPE: `origin-parity-allow: <powód>` w tej samej linii lub linię wyżej —
#   dla skryptów, które nie budują z drzewa (orkiestrator delegujący do składowych,
#   rollback wracający do release'u leżącego już na serwerze).
#
# EXIT: 0 = PASS, 1 = naruszenia.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SCAN_DIR="${SCRIPTS_DIR_OVERRIDE:-${ROOT}/scripts}/deploy"

print_boxed_header "Deploy: parytet z origin/master" "🔀"

if [[ ! -d "$SCAN_DIR" ]]; then
    print_success "Brak scripts/deploy — nic do sprawdzenia"
    exit 0
fi

violations=""
checked=0

while IFS= read -r f; do
    # Plik moze zniknac MIEDZY `find` a odczytem: edytory i skrypty zapisuja
    # atomowo (zapis do pliku tymczasowego + rename), a w tym repo pracuja
    # rownolegle sesje. Bez tego guarda `sed` czytal pustke, `grep -q` nie
    # trafial i audyt raportowal FALSZYWE naruszenie — co realnie zablokowalo
    # push, mimo ze ten sam audyt uruchomiony chwile pozniej przechodzil.
    # Bramka, ktora bywa czerwona bez powodu, uczy siegania po --no-verify.
    if [[ ! -r "$f" ]]; then
        print_info "pomijam $f — zniknal w trakcie skanu (zapis rownoleglej sesji?)"
        continue
    fi
    # Plik czytamy RAZ do zmiennej. Wczesniej byly dwa odczyty (sed + grep),
    # wiec okno na zniknniecie pliku zostawalo otwarte miedzy nimi i wracalo
    # tym samym falszywym naruszeniem.
    content="$(cat "$f" 2>/dev/null)" || continue
    [[ -z "$content" ]] && { print_info "pomijam $f — pusty odczyt (zapis w toku?)"; continue; }
    checked=$((checked + 1))
    # Kod bez komentarzy: wzmianka w prozie NIE moze zaliczyc pliku.
    code="$(printf '%s' "$content" | sed -e 's/^[[:space:]]*#.*//' -e 's/[[:space:]]#.*//')"
    if grep -q 'git_parity_counts' <<<"$code"; then
        continue
    fi
    if grep -q 'origin-parity-allow:' <<<"$content"; then
        continue
    fi
    violations+="$(printf '%s: brak sprawdzenia parytetu (git_parity_counts) przed wdrozeniem\n' "$f")"$'\n'
done < <(find "$SCAN_DIR" -maxdepth 1 -type f -name 'deploy-*')

violations="$(grep -v '^$' <<<"$violations" || true)"

# Zielen nad ZEREM zbadanych plikow to nie sukces, tylko zepsuty skan — ta sama
# regula co w sondzie motywu i w pozostalych straznikach tej fali.
if [[ "$checked" -eq 0 ]]; then
    print_error "Zero zbadanych skryptow deployu — skan nie mial na czym pracowac"
    exit 1
fi

if [[ -n "$violations" ]]; then
    print_error "Skrypty deployu bez sprawdzenia parytetu z origin/master:"
    echo "$violations" | sed "s|${ROOT}/||" | sed 's/^/    /'
    echo
    print_info "Fix: read -r BEHIND AHEAD <<< \"\$(git_parity_counts \"\$REPO_DIR\")\""
    print_info "     behind>0 przy deployu push-based = STOP (cofasz kod, ktory jest juz na prodzie)."
    print_info "     ahead>0  przy deployu pull-based = STOP (Twoj kod tam nie dojedzie)."
    print_info "Swiadomy wyjatek: 'origin-parity-allow: <powod>' (np. orkiestrator delegujacy do skladowych)."
    exit 1
fi

print_success "Deploy: wszystkie ${checked} skrypty sprawdzaja parytet z origin/master"
exit 0
