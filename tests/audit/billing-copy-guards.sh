#!/usr/bin/env bash
# billing-copy-guards.sh — strażnicy klas bugów z turbo-review r39 (billing/copy SSOT).
#
# CHECK 1 (planId literals): żaden quoted literal przypisany do planId poza kernelem.
#   Klasa P0 r39: trial checkout pisał metadata.planId:'pro' po migracji na 'price-N'
#   → cała ścieżka trialu martwa (FREE fallback). Kanon: PLAN_ID_MAP z
#   .shared-kernel/domain/stripe/stripe.config.ts. Inline opt-out:
#   `planid-literal-allow: <powód>` w tej samej linii.
#
# CHECK 2 (email CTA routes): w szablonach maili (web-1 email-handler) po
#   "{{appUrl}}" NIE wolno kleić surowej ścieżki ("{{appUrl}}/..."). Klasa P1 r39:
#   /billing/upgrade, /billing, /onboarding — trasy nieistniejące we froncie (404
#   z maila). Kanon: interpolacja ${ROUTES_FRONT.X} z routing.config (SSOT).
#
# CHECK 3 (ceny planów w copy): main/src/locales/*/common.json nie może zawierać
#   kwot pieniężnych ("N zł|PLN|EUR|€") NASZYCH planów — Stripe = jedyne SSOT cen
#   (decyzja B37); zmiana ceny w Stripe nie może zostawiać kłamstwa w copy.
#   Allowlista key-path (poniżej): testimoniale RAW (static.reviews.*) i klucze
#   z kwotami, które nie są cenami naszych planów.
set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"

trap cleanup_temp_files EXIT

print_boxed_header "Billing/copy guards: planId SSOT + email CTA routes + ceny w locales" "💳"

VIOLATIONS=0

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 1 — planId string-literals poza kernelem
# ─────────────────────────────────────────────────────────────────────────────
print_header "CHECK 1 — quoted planId literals (kanon: PLAN_ID_MAP)"

PLANID_HITS=$(grep -rEn "planId['\"]?[[:space:]]*[:=][[:space:]]*['\"]" \
  "${ROOT}/web-1/src" "${ROOT}/main/src" \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out --exclude-dir=dist \
  --exclude-dir=READONLY-shared-kernel \
  2>/dev/null | grep -v "planid-literal-allow:" || true)

if [[ -z "$PLANID_HITS" ]]; then
  print_success "Zero quoted planId literals poza kernelem (PLAN_ID_MAP = SSOT)"
else
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    REL=$(echo "$line" | sed "s|${ROOT}/||")
    print_error "PLANID LITERAL: ${REL} — użyj PLAN_ID_MAP z .shared-kernel/domain/stripe/stripe.config.ts (lub inline 'planid-literal-allow: <powód>')"
    VIOLATIONS=$((VIOLATIONS + 1))
  done <<< "$PLANID_HITS"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 2 — surowe ścieżki po {{appUrl}} w szablonach maili
# ─────────────────────────────────────────────────────────────────────────────
print_header "CHECK 2 — email CTA: {{appUrl}}/<raw-path> zakazane (kanon: ROUTES_FRONT)"

CTA_HITS=$(grep -rEn '\{\{appUrl\}\}/' \
  "${ROOT}/web-1/src/application/email-handler" \
  --include="*.ts" \
  2>/dev/null || true)

if [[ -z "$CTA_HITS" ]]; then
  print_success "Wszystkie CTA maili interpolują ROUTES_FRONT (zero surowych ścieżek po {{appUrl}})"
else
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    REL=$(echo "$line" | sed "s|${ROOT}/||")
    print_error "RAW EMAIL CTA: ${REL} — surowa ścieżka po {{appUrl}}; interpoluj \${ROUTES_FRONT.X} z routing.config.ts (trasa zweryfikowana przez TS)"
    VIOLATIONS=$((VIOLATIONS + 1))
  done <<< "$CTA_HITS"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 3 — kwoty pieniężne w main/src/locales/*/common.json
# ─────────────────────────────────────────────────────────────────────────────
print_header "CHECK 3 — ceny planów w locales (Stripe = SSOT cen, B37)"

PRICE_HITS=$(node -e '
const fs = require("fs");
const root = process.argv[1];
// Allowlista key-path: testimoniale RAW (mogą cytować ceny) + klucze z kwotami,
// które nie są cenami naszych planów. Per-klucz, nie wzorzec.
const ALLOW = [
  /\.reviews\./,
  /^static\.pricing\.anchorBanner\.text$/,
  /^static\.compare\.faq\.a4$/,
];
const PRICE = /[1-9][0-9]* ?(zł|PLN|EUR|€)/;
const out = [];
for (const lang of ["pl", "en", "de"]) {
  const file = root + "/main/src/locales/" + lang + "/common.json";
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const walk = (o, p) => {
    for (const [k, v] of Object.entries(o)) {
      const kp = p ? p + "." + k : k;
      if (typeof v === "string") {
        if (PRICE.test(v) && !ALLOW.some(re => re.test(kp))) {
          out.push(lang + "/common.json :: " + kp + " :: " + JSON.stringify(v.slice(0, 70)));
        }
      } else if (v && typeof v === "object") {
        walk(v, kp);
      }
    }
  };
  walk(j, "");
}
process.stdout.write(out.join("\n"));
' "${ROOT}" 2>/dev/null || true)

if [[ -z "$PRICE_HITS" ]]; then
  print_success "Zero kwot naszych planów w common.json (poza allowlistą reviews/konkurencja)"
else
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    print_error "PRICE IN COPY: ${line} — kwoty planów żyją w Stripe (B37); przeredaguj bez kwoty lub rich-tag <price>, ewentualnie rozszerz allowlistę (tylko nie-nasze ceny)"
    VIOLATIONS=$((VIOLATIONS + 1))
  done <<< "$PRICE_HITS"
fi

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 4 — lede ceny 0 PLN (trial/free) w locales
# Owner 2026-08-19: slot-bohater bez kwoty („Darmowy okres próbny" / „Za darmo")
# = AI-oklep + ukrywa, że teraz jest 0. Klucze trialLede/freeLede MUSZĄ nieść
# „0 PLN" we wszystkich językach. 0 nie łapie CHECK 3 ([1-9]…), więc osobny
# strażnik. Nie-nasze ceny i narracja trialu bez slotu ceny (FAQ/CTA) zostają.
# ─────────────────────────────────────────────────────────────────────────────
print_header "CHECK 4 — trialLede/freeLede must include 0 PLN (×3 locales)"

LEDE_HITS=$(node -e '
const fs = require("fs");
const root = process.argv[1];
const out = [];
for (const lang of ["pl", "en", "de"]) {
  const file = root + "/main/src/locales/" + lang + "/common.json";
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const walk = (o, p) => {
    for (const [k, v] of Object.entries(o)) {
      const kp = p ? p + "." + k : k;
      if (typeof v === "string") {
        if ((k === "trialLede" || k === "freeLede") && !v.includes("0 PLN")) {
          out.push(lang + "/common.json :: " + kp + " :: " + JSON.stringify(v));
        }
      } else if (v && typeof v === "object") {
        walk(v, kp);
      }
    }
  };
  walk(j, "");
}
process.stdout.write(out.join("\n"));
' "${ROOT}" 2>/dev/null || true)

if [[ -z "$LEDE_HITS" ]]; then
  print_success "Wszystkie trialLede/freeLede niosą 0 PLN (PL/EN/DE)"
else
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    print_error "ZERO-PRICE LEDE: ${line} — slot ceny 0 musi pokazywać 0 PLN (owner 2026-08-19)"
    VIOLATIONS=$((VIOLATIONS + 1))
  done <<< "$LEDE_HITS"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
print_separator
if [[ "$VIOLATIONS" -gt 0 ]]; then
  print_error "Billing/copy guards FAILED — ${VIOLATIONS} violation(s)"
  exit 1
fi

print_success "Billing/copy guards passed — planId SSOT, CTA z ROUTES_FRONT, copy bez cen planów"
exit 0
