#!/usr/bin/env bash
# scroll-reset-multistep.sh — Multi-step wizard renderowany w app-shell MUSI
# resetować scroll na top przy zmianie kroku.
#
# INTENT:
#   AppLayout scrolluje wewnętrznym kontenerem #main-content (NIE window —
#   desktop frame + mobile inner-scroll). Wizard wielokrokowy (onboarding,
#   upload, delete-self) renderuje kolejne kroki w TYM SAMYM kontenerze: gdy
#   user przewinie długi krok N na dół (zgody RODO / lista konsekwencji / CTA)
#   i przejdzie do kroku N+1, pozycja scrolla ZOSTAJE — user ląduje w połowie
#   nowego kroku, nie widząc jego nagłówka/steppera. To dezorientacja w funnelu.
#   Static-census tego nie łapie (tylko interaktywny flow-pass) — stąd ratchet.
#
#   Klasa potwierdzona 3× DOM-probe: OnboardingPage (S32, scrollTop 664→0),
#   UploadAssetPage (S33, 791→0), DeleteSelfPage (S34, 122→0). Kanon fixu:
#     useEffect(() => {
#       const s = document.getElementById('main-content');
#       (s ?? window).scrollTo({ top: 0 });
#     }, [step]);
#
# RULE (structural, no counters/baselines):
#   Plik *.composition.tsx renderowany w AppLayout (zawiera `AppLayoutComposition`)
#   z przejściem między krokami (`setStep(` / `setCurrentStep(` / `setWizardStep(`)
#   jest VIOLATION, chyba że:
#     1. ma scroll-reset: jednocześnie `scrollTo` ORAZ `main-content`, OR
#     2. komentarz `scroll-reset-allow: <powód>` w pliku (kroki krótkie /
#        nie-inner-scroll / reset robiony gdzie indziej).
#
# SCOPE: main/src/UI/features/**/*.composition.tsx
#   Modale (AppDialogAtom) i organizmy POZA zakresem — mają własny scroll-
#   container, nie #main-content (np. CreateSessionModal).
#
# EXIT: 0 if no violations, 1 if found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
FEAT_DIR="${ROOT}/main/src/UI/features"

print_boxed_header "Scroll-reset multi-step: wizard w app-shell resetuje scroll przy zmianie kroku" "↕️"

if [[ ! -d "$FEAT_DIR" ]]; then
  print_info "No features dir — nothing to audit"
  exit 0
fi

declare -a FILES
mapfile -t FILES < <(find "$FEAT_DIR" -name "*.composition.tsx" -type f \
  -not -path "*/playground/*" | sort)

if [[ ${#FILES[@]} -eq 0 ]]; then
  print_info "No composition files — nothing to audit"
  exit 0
fi

print_header "Scanning ${#FILES[@]} composition files for multi-step wizards in app-shell"

VIOLATIONS=""
SCANNED=0
for f in "${FILES[@]}"; do
  # Tylko wizardy renderowane w AppLayout (scroll = #main-content).
  grep -q "AppLayoutComposition" "$f" || continue
  # Tylko z realnym przejściem między krokami.
  grep -qE "setStep\(|setCurrentStep\(|setWizardStep\(" "$f" || continue
  SCANNED=$((SCANNED + 1))

  # Escape-comment.
  if grep -q "scroll-reset-allow:" "$f"; then
    continue
  fi
  # Scroll-reset present (kanon: getElementById('main-content') + scrollTo).
  # `main-content` MUSI być w tej samej linii co getElementById (realny kod, nie
  # komentarz) — inaczej `main-content` w komentarzu + window.scrollTo-only w
  # kodzie fałszywie spełniłoby warunek bez resetu właściwego kontenera
  # (review S34, false-negative hardening). window-only reset → escape-comment.
  if grep -q "scrollTo" "$f" && grep "getElementById" "$f" | grep -q "main-content"; then
    continue
  fi
  VIOLATIONS="${VIOLATIONS}${f#"${ROOT}/"}"$'\n'
done

print_info "Multi-step wizards in app-shell: ${SCANNED}"
print_separator

if [[ -n "${VIOLATIONS//[$'\n']/}" ]]; then
  COUNT=$(printf '%s' "$VIOLATIONS" | grep -c . || true)
  print_error "Scroll-reset FAILED — ${COUNT} multi-step wizard bez resetu scrolla przy zmianie kroku:"
  echo ""
  printf '%s' "$VIOLATIONS"
  echo ""
  echo "Fix (wybierz jeden):"
  echo "  1. Dodaj useEffect resetujący scroll #main-content na zmianę kroku:"
  echo "       useEffect(() => {"
  echo "         const s = document.getElementById('main-content');"
  echo "         if (s) s.scrollTo({ top: 0 }); else window.scrollTo({ top: 0 });"
  echo "       }, [step]);"
  echo "     Kanon: UploadAssetPage / DeleteSelfPage.composition.tsx, auth/hooks/useStepScrollReset.ts"
  echo "  2. Realny wyjątek (kroki krótkie / nie inner-scroll / reset gdzie indziej)"
  echo "     → komentarz 'scroll-reset-allow: <powód>' w pliku."
  exit 1
fi

print_success "Scroll-reset passed — każdy multi-step wizard w app-shell resetuje scroll przy zmianie kroku"
exit 0
