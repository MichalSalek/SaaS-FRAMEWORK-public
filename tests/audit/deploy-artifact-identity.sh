#!/usr/bin/env bash
# deploy-artifact-identity.sh — Guard: deploy potwierdza TOŻSAMOŚĆ ARTEFAKTU, nie liveness.
#
# INTENT:
#   Bramki zdrowia w tym repo odpowiadały dotąd na pytanie „czy coś odpowiada 200",
#   a nie „czy odpowiada TO, co właśnie wdrożyłem". Różnica jest cicha i kosztowna,
#   bo oba deploye produkcyjne mają ASYNCHRONICZNEGO odbiorcę:
#     • backend (Render): `git push` kończy się zerem NATYCHMIAST, a build leci potem.
#       `build_failed` zostawia prod na starym artefakcie — health przez cały czas
#       zielony (precedens 2026-07-19: 2× build_failed niezauważone 2 tygodnie).
#       Nawet `uptime < 300 s` nie wystarcza: restart/OOM daje ŚWIEŻY proces na STARYM
#       artefakcie.
#     • front (hosting współdzielony): scp + przepięcie symlinka + pm2 restart. Nieprzeładowany
#       proces albo nieprzepięty symlink oddaje HTML 200 z POPRZEDNIEGO release'u —
#       nie do odróżnienia od sukcesu, dopóki nie porównasz BUILD_ID.
#   Dlatego każdy deploy budujący artefakt MUSI porównać tożsamość: BUILD_ID Next
#   zbudowany lokalnie vs BUILD_ID raportowany przez żywy proces.
#
# WHAT IT CHECKS:
#   Każdy scripts/deploy/deploy-* albo woła wspólnego strażnika `assert_artifact_served`
#   (_artifact-gate.sh — front), albo sam porównuje BUILD_ID z polem `build_id` z
#   health-checka (backend). Komentarze są strippowane przed dopasowaniem, więc sama
#   WZMIANKA w prozie nie zalicza pliku — dokładnie ta klasa fałszywej zieleni,
#   której ten ratchet pilnuje.
#
# ESCAPE: `artifact-identity-allow: <powód>` w pliku — dla skryptów, które nie mają
#   asynchronicznego okna: orkiestrator delegujący do składowych, deploy pull-based
#   z synchronicznym łańcuchem (błąd wraca kodem wyjścia, nie ciszą).
#
# EXIT: 0 = PASS, 1 = naruszenia.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
SCAN_DIR="${SCRIPTS_DIR_OVERRIDE:-${ROOT}/scripts}/deploy"

print_boxed_header "Deploy: tozsamosc artefaktu (BUILD_ID)" "🧬"

if [[ ! -d "$SCAN_DIR" ]]; then
    print_success "Brak scripts/deploy — nic do sprawdzenia"
    exit 0
fi

violations=""
checked=0

while IFS= read -r f; do
    # Rownolegle sesje zapisuja pliki atomowo (tmp + rename) — plik moze zniknac
    # miedzy `find` a odczytem. Bramka, ktora bywa czerwona bez powodu, uczy
    # siegania po --no-verify (ta sama lekcja co w deploy-origin-parity).
    if [[ ! -r "$f" ]]; then
        print_info "pomijam $f — zniknal w trakcie skanu (zapis rownoleglej sesji?)"
        continue
    fi
    content="$(cat "$f" 2>/dev/null)" || continue
    [[ -z "$content" ]] && { print_info "pomijam $f — pusty odczyt (zapis w toku?)"; continue; }
    checked=$((checked + 1))

    if grep -q 'artifact-identity-allow:' <<<"$content"; then
        continue
    fi

    # Kod bez komentarzy: wzmianka w prozie NIE moze zaliczyc pliku.
    code="$(printf '%s' "$content" | sed -e 's/^[[:space:]]*#.*//' -e 's/[[:space:]]#.*//')"

    # (a) front: wspolny straznik; (b) backend: wlasne porownanie BUILD_ID <-> build_id.
    if grep -q 'assert_artifact_served' <<<"$code"; then
        continue
    fi
    if grep -q 'BUILD_ID' <<<"$code" && grep -q 'build_id' <<<"$code"; then
        continue
    fi

    violations+="$(printf '%s: brak weryfikacji tozsamosci artefaktu (BUILD_ID) po wdrozeniu\n' "$f")"$'\n'
done < <(find "$SCAN_DIR" -maxdepth 1 -type f -name 'deploy-*')

violations="$(grep -v '^$' <<<"$violations" || true)"

# Zielen nad ZEREM zbadanych plikow to nie sukces, tylko zepsuty skan.
if [[ "$checked" -eq 0 ]]; then
    print_error "Zero zbadanych skryptow deployu — skan nie mial na czym pracowac"
    exit 1
fi

if [[ -n "$violations" ]]; then
    print_error "Skrypty deployu bez weryfikacji tozsamosci artefaktu:"
    echo "$violations" | sed "s|${ROOT}/||" | sed 's/^/    /'
    echo
    print_info "Fix (front): assert_artifact_served \"\$SSH_CONN\" \"\$PORT\" \"\$DOMAIN\" \"\$BUILD_ID\"  (_artifact-gate.sh)"
    print_info "Fix (backend): porownaj lokalny .next/BUILD_ID z polem build_id z /api/health-check."
    print_info "Swiadomy wyjatek: 'artifact-identity-allow: <powod>' (orkiestrator, deploy synchroniczny)."
    exit 1
fi

print_success "Deploy: wszystkie ${checked} skrypty potwierdzaja TOZSAMOSC artefaktu"
exit 0
