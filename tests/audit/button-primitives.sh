#!/usr/bin/env bash
# button-primitives.sh — Guard the icon-action <button> → <Button> consolidation
# (FDX FAZA 4 / W4.5). Prevent NEW raw icon-action buttons from re-drifting in.
#
# INTENT:
#   <Button> (main/src/UI/components/Button/Button.tsx) is the single source for
#   action buttons. Icon-only action buttons should use
#   <Button variant='ghost' icon={…} ariaLabel='…'> (canonical exemplar:
#   admin/components/ColorRow.tsx). The historical drift was bespoke per-feature
#   icon-button classes (`*iconButton`, `*actionBtn`) defined ad-hoc on raw
#   <button> elements. This audit fails when a NEW raw <button> uses one of those
#   icon-action class families outside the documented allowlist.
#
# DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
#   Rodziny tokenów były dopasowywane WIELKOŚCIĄ LITER: `iconButton|actionBtn`.
#   W złożeniach camelCase człon jest jednak KAPITALIZOWANY (`cardActionBtn`,
#   `rowIconButton`), więc wzorzec ich nie widział. Zmierzone: przy starym wzorcu
#   przechodziły na zielono `admin/components/UsersTable.organism.tsx` (dwa surowe
#   `styles.iconBtn`, w tym jeden czysto ikonowy) oraz
#   `admin/components/AnnouncementCard.molecule.tsx` (trzy `styles.cardActionBtn`).
#   Stąd `[Ii]con` / `[Aa]ction` w rodzinach.
#
#   ŚWIADOMIE POZA ZASIĘGIEM: rodzina zamykania i odrzucania (`closeButton`,
#   `closeBtn`, `dismissBtn`) — szuflada, sidebar admina, baner cookies, baner
#   odliczania triala. To NIE są przyciski akcji w rozumieniu systemu projektowego,
#   tylko chrom nakładki: ciasny „×" w rogu, którego `<Button variant='ghost'>`
#   (44 px, własne paddingi) nie odwzorowuje. Wciągnięcie ich tutaj wymusiłoby
#   cztery regresje wizualne bez ani jednej realnej wady. Gdyby kiedyś powstał
#   prymityw `<CloseButton>`, należy mu się OSOBNY strażnik, nie rozszerzenie tego.
#
#   Prefiks tokenu to `*[Ss]tyles.`, a nie `styles.` — arkusz bywa importowany pod
#   aliasem (`import pageStyles from '../AdminUsersPage.module.css'`), a zaszyta
#   nazwa `styles` przepuszczała każde takie użycie. Zmierzone: dwa surowe
#   `<button className={pageStyles.iconBtn}>` w stopce dialogu użytkownika.
#
# WHAT IT CHECKS:
#   A raw `<button …>` element whose className token (set via styles.<Token>)
#   matches the icon-action families `*iconButton` or `*actionBtn`.
#   It deliberately does NOT flag `<Button … className={styles.actionBtn}>`
#   (the design-system component used with a layout-modifier class is fine —
#   only the lowercase raw `<button>` element is a primitive escape).
#
# ALLOWLIST (intentional raw icon-action buttons — bespoke visual identity that
#   <Button variant='ghost'> does NOT reproduce 1:1; each carries a DECISION
#   comment in source explaining why it stays raw):
#     - salon-staff/StaffMemberCard.tsx        (.iconButton: spring hover + danger color-mix variant)
#     - admin/components/ReportCardActions.tsx  (.actionBtn: icon+TEXT moderation actions, semantic per-action colour)
#     - admin/components/ReportActionConfirm.tsx(.actionBtn: confirm-step action buttons, same family)
#     - admin/components/AnnouncementCard.tsx   (.cardActionBtn: 32px danger-on-hover, DECISION in source)
#   (Removed S122: UserDetailsDialog — moved to AppSheet, whose close button is
#    a ButtonAtom; no raw <button> left there.)
#   (Removed S113: two pairing entries whose files no longer exist — see the
#    existence assertion below, which now makes that impossible to leave behind.)
#   Layout-modifier use on the <Button> component (CookieBanner) is NOT a
#   violation and is excluded by the raw-element match itself.
#
# EXIT: 0 if no new violations, 1 if a raw icon-action <button> is found
#   outside the allowlist.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
UI_DIR="${ROOT}/main/src/UI"

# Icon-action class families to guard (suffix-matched token after `styles.`).
# Matches e.g. styles.iconButton, styles.iconButtonDanger, styles.actionBtn,
# styles.cardActionBtn (any *iconButton* / *actionBtn* token).
# Note: `[.]` (not `\.`) — POSIX/awk-safe literal dot (avoids awk escape warning;
# ERE grep treats it identically).
TOKEN_RE='[A-Za-z0-9_]*[Ss]tyles[.][A-Za-z0-9_]*([Ii]conButton|[Ii]conBtn|[Aa]ctionBtn|[Aa]ctionButton)[A-Za-z0-9_]*'

# Allowlist: paths (relative to ROOT) where a raw icon-action <button> is an
# intentional, DECISION-documented escape hatch (bespoke visual identity).
ALLOWLIST=(
  "main/src/UI/features/salon-staff/StaffMemberCard.organism.tsx"
  "main/src/UI/features/admin/components/ReportCardActions.molecule.tsx"
  "main/src/UI/features/admin/components/ReportActionConfirm.molecule.tsx"
)

# Każdy wpis allowlisty MUSI istnieć. Martwa kotwica to zwolnienie, które niczego
# nie zwalnia, i jedyny ślad po pliku, którego już nie ma — a przy okazji cicha
# zachęta, żeby allowlistę rozbudowywać zamiast czyścić. Zmierzone S113: dwa wpisy
# (PairingClaimPage.parts, PairingSuccessScreen) wskazywały nieistniejące pliki.
for allowed in "${ALLOWLIST[@]}"; do
  if [[ ! -f "${ROOT}/${allowed}" ]]; then
    echo "ALLOWLIST wskazuje nieistniejący plik: ${allowed}" >&2
    echo "Usuń martwy wpis z ALLOWLIST w tests/audit/button-primitives.sh." >&2
    exit 1
  fi
done

print_boxed_header "Button primitives: icon-action <button> no re-drift" "🔘"

VIOLATIONS=0
FOUND=""

declare -a TSX_FILES
mapfile -t TSX_FILES < <(find "$UI_DIR" -name "*.tsx" -type f -print0 \
  | tr '\0' '\n' | grep -v '^$' \
  | grep -v '/playground/' | grep -v '/ui-library/')

print_header "Scanning raw <button> elements for *iconButton / *actionBtn tokens"

for tsx in "${TSX_FILES[@]}"; do
  [[ -z "$tsx" ]] && continue
  REL_PATH="${tsx#${ROOT}/}"

  # Skip allowlisted files entirely.
  ALLOWED=0
  for allowed in "${ALLOWLIST[@]}"; do
    if [[ "$REL_PATH" == "$allowed" ]]; then
      ALLOWED=1
      break
    fi
  done
  [[ "$ALLOWED" -eq 1 ]] && continue

  # Fast pre-filter: file must contain both a raw lowercase <button and a guarded token.
  grep -qE '<button' "$tsx" 2>/dev/null || continue
  grep -qE "$TOKEN_RE" "$tsx" 2>/dev/null || continue

  # Per raw <button …> element, scan its opening tag (until the closing `>` of
  # the tag) for a guarded className token. awk state machine: we enter a button
  # opening-tag region at `<button`, and leave it at the first line containing
  # `>` (covers single- and multi-line opening tags). `<Button` (capital B,
  # the DS component) is intentionally NOT matched — only the raw element.
  HITS=$(awk -v re="$TOKEN_RE" '
    {
      line = $0
    }
    # Enter a raw <button opening tag (word-boundary: <button followed by space,
    # > or newline — not <Button the component).
    /<button([[:space:]]|>|$)/ { in_tag = 1; tag_start = NR }
    in_tag {
      if (line ~ re) {
        print tag_start
        in_tag = 0
        next
      }
      # Opening tag ends at the first `>` (end of attributes).
      if (line ~ />/) { in_tag = 0 }
    }
  ' "$tsx" | sort -un | tr '\n' ',' | sed 's/,$//')

  if [[ -n "$HITS" ]]; then
    VIOLATIONS=$((VIOLATIONS + 1))
    FOUND="${FOUND}${REL_PATH}:${HITS}"$'\n'
    print_error "VIOLATION — ${REL_PATH}: raw <button> with *iconButton/*actionBtn at line(s): ${HITS}"
  fi
done

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "button-primitives audit FAILED — ${VIOLATIONS} file(s) with new raw icon-action <button>"
  echo ""
  echo "Files with violations:"
  echo "$FOUND"
  echo "Fix: use <Button variant='ghost' icon={…} ariaLabel='…'> for icon-only"
  echo "     actions (exemplar: main/src/UI/features/admin/components/ColorRow.tsx)."
  echo "     If the button has a genuinely bespoke visual identity that <Button>"
  echo "     cannot reproduce, add it to the ALLOWLIST in this script WITH a"
  echo "     DECISION comment in source explaining why it stays raw."
  exit 1
fi

print_success "button-primitives audit passed — no new raw icon-action <button> outside allowlist"
exit 0
