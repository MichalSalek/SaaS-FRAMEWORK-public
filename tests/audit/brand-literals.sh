#!/usr/bin/env bash
# brand-literals.sh — Guard against hardcoded brand-identity literals outside
# the BRAND_CONFIG SSOT.
#
# INTENT:
#   .shared-kernel/domain/platform/brand.config.ts (BRAND_CONFIG) is the single
#   source of truth for brand identity: domain, deep-link scheme, contact emails,
#   social handles, android package id. Hardcoded 'nailfolio.app' / 'nailfolio://'
#   / '@nailfolio_app' / 'com.nailfolio.app' literals in runtime TS/TSX create
#   silent drift when any of these change. Consumers must import BRAND_CONFIG.* .
#
# WHAT IT CHECKS:
#   1. Brand-identity literals in .ts/.tsx/.json under main/src, main/public,
#      web-1/src and .shared-kernel, EXCLUDING comment lines, copy channels and
#      the env-driven origin fallback (see allowlist).
#   2. PARITY: assetlinks.json `package_name` == BRAND_CONFIG.androidPackage.
#
# DECISION (nie usuwaj tego komentarza):
#   SLEPA PLAMA ZAMKNIETA — straznik skanowal WYLACZNIE `.ts`/`.tsx` (1994
#   plikow), a literaly marki mieszkaja rowniez w JSON-ie. POMIAR: 70 trafien
#   w 10 plikach `.json`, ktorych ta bramka nigdy nie widziala, w tym JEDNO
#   maszynowe. Rozdzial przebiega tak:
#
#   (a) 69 trafien = KOPIA DLA CZLOWIEKA (main/src/locales/{pl,en,de}/*.json,
#       .shared-kernel/domain/email/locales/email-i18n.*.json): adresy
#       support@/kontakt@/privacy@ w zdaniach, „nailfolio.app" w regulaminie
#       i w instrukcji „otwierasz nailfolio.app w przegladarce", handle
#       @nailfolio w FAQ. To NIE jest dryf do zamkniecia importem: string ICU
#       nie moze siegnac po `BRAND_CONFIG`, a wstawianie tam interpolacji
#       zamienia czytelne zdanie w szablon i psuje tlumaczenie (fleksja PL,
#       Sie-Form DE). Ten kanal ma juz WLASNY mechanizm w tym repo —
#       `npm run copy:grep` plus zasada „zmiana faktu produktowego = sweep
#       wszystkich powierzchni kopii" (AGENTS.md). Dlatego katalogi locale sa
#       na allowliscie, ta sama logika co juz zapisana wyzej dla golej nazwy
#       „Nailfolio" („lives mostly in i18n copy — a separate channel").
#       Konsekwencja przyjeta swiadomie: zmiana domeny wymaga sweepu kopii,
#       a nie zapali tej bramki.
#
#   (b) 1 trafienie = KONFIGURACJA MASZYNOWA:
#       main/public/.well-known/assetlinks.json → `package_name`. Tu allowlista
#       byla by najgorszym z wyjsc, bo to jest DOKLADNIE ten dubel, o ktorym
#       brand.config.ts pisze we wlasnym komentarzu DECISION: „androidPackage
#       MUST stay in sync with assetlinks.json (package_name) … Change both
#       together" — i nie mial ani jednej bramki, ktora by tego pilnowala.
#       Rozjazd = cicha smierc App Links (weryfikacja Androida nie dopasuje
#       pakietu, deep-linki logowania wracaja do przegladarki), bez bledu
#       kompilacji i bez czerwonego testu. Plik jest statycznym assetem
#       serwowanym doslownie, wiec NIE MOZE importowac configu — jedyna
#       mozliwa bramka to asercja PARZYSTOSCI, i taka jest ponizej.
#
# ALLOWLIST — intentional, not violations:
#   - brand.config.ts                  — the SSOT definition itself.
#   - READONLY-shared-kernel/          — propagated kernel copies (mirror SSOT).
#   - *.test.ts / *.test.tsx           — assertions verifying rendered output
#                                        must hold the literal (else tautological).
#   - pages/dev/architecture.tsx       — recon doc (literals in prose/examples).
#   - comment / JSDoc lines            — descriptive prose, not runtime values.
#   - environment.utils.api.ts         — env-driven origin fallback
#   - auth-token-bridge.ts             — env-driven origin fallback
#     (both: `ENV_VARS.FRONTEND_PUBLIC_DOMAIN || 'nailfolio.app'`, transport,
#      env-configurable by design and multi-line; see brand.config.ts §DECISION).
#   - resend.ts                        — Resend FROM (`noreply@nailfolio.app`) is a
#     deliberate constant on the Resend-verified domain, intentionally NOT env
#     (anti env-sprawl; domain immutable, Mailgun fallback owns its own FROM).
#     See in-file JSDoc DECISION above RESEND_FROM.
#   - main/src/locales/**              — user-facing copy (see DECISION (a) above).
#   - .shared-kernel/domain/email/locales/** — the same, for transactional email.
#   - main/public/.well-known/assetlinks.json — literal is REQUIRED there;
#     covered by the parity assertion instead (see DECISION (b) above).
#
# NOT IN SCOPE (deliberate): the bare brand NAME 'Nailfolio' is the single most
#   stable brand element (one change in product history) and lives mostly in i18n
#   copy (a separate channel). BRAND_CONFIG.name remains the declared SSOT for
#   when it is needed; this ratchet guards only the volatile literals (domain,
#   scheme, contact emails, social, package).
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"

print_boxed_header "Brand literals: BRAND_CONFIG SSOT enforcement audit" "🏷️"

PATTERN='nailfolio\.app|nailfolio://|@nailfolio_app|com\.nailfolio'

VIOLATIONS=0
VIOLATION_FILES=""

while IFS= read -r -d $'\0' file; do
  REL_PATH="${file#${ROOT}/}"

  # ─── Exclusions (allowlist) ──────────────────────────────────────────────
  case "$REL_PATH" in
    *.test.ts|*.test.tsx)                                                continue ;;
    *READONLY-shared-kernel*)                                            continue ;;
    */brand.config.ts)                                                   continue ;;
    main/src/pages/dev/architecture.tsx)                                 continue ;;
    web-1/src/application/environment/environment.utils.api.ts)         continue ;;
    web-1/src/application/auth/better-auth/auth-token-bridge.ts)         continue ;;
    web-1/src/application/email-handler/adapters/resend.ts)              continue ;;
    main/src/locales/*)                                                  continue ;;
    .shared-kernel/domain/email/locales/*)                               continue ;;
    main/public/.well-known/assetlinks.json)                             continue ;;
  esac

  # grep brand pattern (single-file grep → output is "lineno:content"), then
  # drop pure comment / JSDoc lines.
  MATCHES=$(grep -nE "$PATTERN" "$file" 2>/dev/null | awk '
    {
      content = $0
      sub(/^[0-9]+:/, "", content)              # strip "lineno:" prefix
      gsub(/^[[:space:]]+/, "", content)        # trim leading whitespace
      # Skip ONLY pure comment lines: a `//` line-comment or a ` *` JSDoc body
      # line. Deliberately NOT `/*` openers — a `/* ... */ code` line could carry
      # a real literal after the close, so it must NOT be silently skipped.
      # The env-driven origin fallback is handled by the file-level allowlist
      # above (environment.utils.api.ts / auth-token-bridge.ts), NOT by a
      # line-content match (which a real literal could ride on to escape).
      if (content ~ /^(\/\/|\*)/) next
      print
    }') || true

  if [[ -n "$MATCHES" ]]; then
    LINES=$(echo "$MATCHES" | cut -d: -f1 | sort -un | tr '\n' ',' | sed 's/,$//')
    VIOLATION_FILES="${VIOLATION_FILES}${REL_PATH}:${LINES}"$'\n'
    VIOLATIONS=$((VIOLATIONS + 1))
    print_error "VIOLATION — ${REL_PATH} at line(s): ${LINES}"
    print_info  "  Fix: import BRAND_CONFIG from '@kernel/domain/platform/brand.config' and use BRAND_CONFIG.*"
    echo "$MATCHES" | head -3 | while IFS= read -r line; do
      print_info "    $(echo "$line" | sed 's/^[[:space:]]*//')"
    done
  fi
done < <(find "${ROOT}/main/src" "${ROOT}/main/public" "${ROOT}/web-1/src" "${ROOT}/.shared-kernel" \
    -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.json" \) -print0 2>/dev/null \
  | grep -zv "node_modules\|\.next\|/out/\|/dist/")

# ═══ PARITY: assetlinks.json package_name == BRAND_CONFIG.androidPackage ══════
# Hand-maintained mirror declared by brand.config.ts's own DECISION comment and
# until now guarded by nothing. Drift = App Links verification stops matching,
# native deep-link login degrades to the browser — silently, with every gate green.
ASSETLINKS="${ROOT}/main/public/.well-known/assetlinks.json"
BRAND_CFG="${ROOT}/.shared-kernel/domain/platform/brand.config.ts"

if [[ ! -f "$ASSETLINKS" ]]; then
  print_error "PARITY — brak ${ASSETLINKS#"${ROOT}/"} (App Links nie zweryfikuja sie bez tego pliku)"
  VIOLATIONS=$((VIOLATIONS + 1))
elif [[ ! -f "$BRAND_CFG" ]]; then
  print_error "PARITY — brak ${BRAND_CFG#"${ROOT}/"} (SSOT marki przeniesiony? zaktualizuj brand-literals.sh)"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  PKG_JSON=$(grep -oE '"package_name"[[:space:]]*:[[:space:]]*"[^"]+"' "$ASSETLINKS" | sed -E 's/.*"([^"]+)"$/\1/' | sort -u)
  PKG_TS=$(grep -oE "androidPackage:[[:space:]]*'[^']+'" "$BRAND_CFG" | sed -E "s/.*'([^']+)'$/\1/")

  if [[ -z "$PKG_JSON" ]]; then
    print_error "PARITY — nie znalazlem package_name w assetlinks.json (ksztalt pliku sie zmienil)"
    VIOLATIONS=$((VIOLATIONS + 1))
  elif [[ -z "$PKG_TS" ]]; then
    print_error "PARITY — nie znalazlem androidPackage w brand.config.ts (ksztalt configu sie zmienil)"
    VIOLATIONS=$((VIOLATIONS + 1))
  elif [[ "$PKG_JSON" != "$PKG_TS" ]]; then
    print_error "PARITY DRIFT — assetlinks.json package_name='${PKG_JSON}' != BRAND_CONFIG.androidPackage='${PKG_TS}'"
    print_info  "  Fix: zmien OBA razem (brand.config.ts §DECISION androidPackage). Rozjazd = App Links nie weryfikuja sie na urzadzeniu."
    VIOLATIONS=$((VIOLATIONS + 1))
  else
    print_success "PARITY — assetlinks.json package_name == BRAND_CONFIG.androidPackage (${PKG_TS})"
  fi
fi

print_separator

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo ""
  print_error "brand-literals audit FAILED — ${VIOLATIONS} issue(s): hardcoded brand literal and/or assetlinks parity drift"
  echo ""
  exit 1
fi

print_success "brand-literals audit PASSED — brand identity uses BRAND_CONFIG SSOT"
exit 0
