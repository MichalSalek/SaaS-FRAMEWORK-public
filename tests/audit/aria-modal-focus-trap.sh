#!/usr/bin/env bash
# aria-modal-focus-trap.sh — Guard: aria-modal lives in AppModalShell, nigdzie indziej.
#
# INTENT (turbo-review r40 → ewolucja):
#   Komponent hardkodujący `aria-modal="true"` OBIECUJE technologii asystującej, że
#   tło jest inert, a focus uwięziony. Bez focus-trapu ta obietnica to KŁAMSTWO:
#   Tab ucieka za modal, wirtualny kursor SR błądzi po tle, brak ESC / focus-restore.
#   r40 znalazł 4 takie modale (MarketingCatchOverlay, FirstPhotoCelebration,
#   ReportActionConfirm, UserDetailsDialog.tabs).
#
#   Pierwsza wersja strażnika wymagała tylko `useFocusTrap(` w tym samym pliku — to
#   łapało correctness, ale pozwalało na DYWERGENCJĘ boilerplate'u (każdy modal
#   ręcznie składał ref+trap+role+aria-modal+tabIndex(+backdrop), łatwo o pomyłkę).
#   Ewolucja: jest JEDEN primitive `AppModalShell` (UI/primitives/AppModalShell.tsx)
#   owijający cały kontrakt a11y. Hand-rolled `aria-modal` jest teraz NIEDOZWOLONY
#   poza shellem — nowy modal MUSI użyć AppModalShell (albo AppDialogAtom = Base UI,
#   który renderuje aria-modal w runtime, więc nie ma literału i nie jest skanowany).
#
#   jsx-a11y eslint NIE łapie tej klasy (nie ma pojęcia „zadeklarowałeś aria-modal,
#   ale nie uwięziłeś focusu" ani „nie użyłeś wspólnego primitive").
#
# WHAT IT CHECKS:
#   Każdy main/src/UI/**/*.tsx z literałem `aria-modal='true'` (pojedyncze/podwójne
#   cudzysłowy LUB JSX-boolean `aria-modal={true}`) jest naruszeniem, CHYBA że:
#     • to AppModalShell.tsx (kanoniczny dom literału), albo
#     • plik ma inline `aria-modal-focus-trap-allow: <powód>` — udokumentowany
#       outlier, który NIE pasuje do shella (drawer z gestem swipe, inline-alert
#       wbudowany w kartę, confirm wewnątrz Base UI Dialog). Każdy = świadoma decyzja.
#
#   COMMENT-AWARE (turbo-review S103): trafienie wyłącznie w linii komentarza NIE jest
#   naruszeniem. Strażnik pilnuje ATRYBUTU W JSX, a nie prozy o nim — DECISION
#   tłumaczący, czemu jakiś komponent świadomie NIE testuje `[aria-modal="true"]`,
#   zapalał go na czystym kodzie. To ta sama klasa fałszywej czerwieni co `": any"`
#   w komentarzu blokujące push przy zielonym tsc; filtr jest 1:1 z kanonem
#   `brand-literals.sh` — pomijamy linie `//` i ` *`, ale CELOWO nie `/*`, bo
#   `/* … */ kod` może nieść realny atrybut po domknięciu komentarza.
#
# EXIT: 0 gdy każdy literał aria-modal jest w shellu lub allow-commentowany, 1 wpp.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
UI_DIR="${ROOT}/main/src/UI"

print_boxed_header "aria-modal focus-trap guard" "🔒"

if [[ ! -d "$UI_DIR" ]]; then
  print_error "UI dir missing: ${UI_DIR#${ROOT}/}"
  exit 1
fi

print_header "Scanning main/src/UI/** — aria-modal allowed only in AppModalShell"

VIOLATIONS=0
CHECKED=0
ALLOWED=0

ARIA_MODAL_PATTERN="aria-modal[[:space:]]*=[[:space:]]*(['\"]true['\"]|\{[[:space:]]*true[[:space:]]*\})"

# Trafienia w KODZIE, po wycięciu treści komentarzy (wspólna mechanika z _utils.sh).
# Pierwsza wersja filtrowała po kształcie linii (`^//` albo `^*`, wzorem
# brand-literals) i to za mało: dominującym stylem w tym repo jest blok JSX
# `{/* … */}`, w którym kolejne linie zaczynają się zwykłym tekstem.
aria_modal_in_code() {
  strip_comments_keep_lines "$1" | grep -qE "$ARIA_MODAL_PATTERN"
}

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  # Sam grep po pliku łapie też prozę; realne naruszenie musi siedzieć w KODZIE.
  aria_modal_in_code "$file" || continue
  CHECKED=$((CHECKED + 1))
  REL="${file#${ROOT}/}"
  # Kanoniczny dom: primitive owijający ramkę modala (ref + useFocusTrap + role +
  # aria-modal + tabIndex + opcjonalny scrim/portal/scroll-lock).
  if [[ "$(basename "$file")" == "AppModalShell.atom.tsx" ]]; then
    continue
  fi
  # Udokumentowany outlier (NIE pasuje do AppModalShell). Wymaga realnego powodu.
  if grep -q "aria-modal-focus-trap-allow" "$file"; then
    ALLOWED=$((ALLOWED + 1))
    print_info "ALLOW (documented): ${REL}"
    continue
  fi
  VIOLATIONS=$((VIOLATIONS + 1))
  print_error "hand-rolled aria-modal (poza AppModalShell): ${REL}"
  print_info  "  Użyj <AppModalShell …> (UI/primitives/AppModalShell.tsx) zamiast ręcznego"
  print_info  "  aria-modal+useFocusTrap, ALBO dodaj inline 'aria-modal-focus-trap-allow: <powód>'"
  print_info  "  jeśli to świadomy outlier (drawer z gestem / inline-alert / Base UI Dialog)."
# DECISION (nie usuwaj tego komentarza): łapiemy też JSX-boolean `aria-modal={true}`
#   (nie tylko string-literały 'true'/"true") — to ta sama obietnica a11y, tylko inna
#   składnia, i równie łatwo ją hand-rollnąć poza AppModalShell. `aria-modal={false}`
#   i string 'false' NIE pasują (alternatywa zakotwiczona na `true`).
done < <(grep -rlE "$ARIA_MODAL_PATTERN" "$UI_DIR" --include="*.tsx" 2>/dev/null)

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "aria-modal-focus-trap FAILED — ${VIOLATIONS} hand-rolled aria-modal poza AppModalShell"
  print_info  "Sprawdzono: ${CHECKED} · Allowlist (outliery): ${ALLOWED}"
  echo ""
  exit 1
fi

print_success "aria-modal-focus-trap PASSED — aria-modal tylko w AppModalShell (${CHECKED} plików, ${ALLOWED} udokumentowanych outlierów)"
exit 0
