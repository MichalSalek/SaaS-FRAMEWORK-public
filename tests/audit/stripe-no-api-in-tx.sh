#!/usr/bin/env bash
# stripe-no-api-in-tx.sh — Guard: no Stripe API call on the in-transaction webhook path
# (turbo-review S89, class D2-F1/PRMA).
#
# INTENT:
#   The Stripe webhook dispatch (routeStripeEvent + every handler it calls) runs INSIDE
#   `$transaction(PRISMA_TX)` — maxWait 5s, timeout 25s — while the Stripe SDK's own timeout
#   is 20s (STRIPE_CONFIG.API_TIMEOUT_MS). One degraded Stripe call therefore consumes most or
#   all of the transaction budget while holding a pooled connection, the tx times out, the row
#   rolls back to processed=false, and the janitor retries it into the same wall — a retry storm
#   whose root cause looks like a DB problem.
#
#   Everything a handler needs from Stripe is resolved BEFORE the tx opens, by
#   `prefetchStripeEventContext` (application/webhooks/stripe/stripe-event-prefetch.ts), and
#   threaded down as `prefetch`. S89 moved the last three offenders out: the checkout session
#   expand (hottest path — one call per new paying account), the schedule's subscription
#   lookup, and the dispute's charge lookup.
#
#   A NEW `getStripe()` call in the router or in a webhook handler = regression of that class,
#   unless it is a documented pre-tx/fallback/post-commit-effect site.
#
# WHAT IT CHECKS (scope: web-1/src/application/stripe/webhooks/handlers + the router):
#   Any NON-COMMENT line calling `getStripe()` is a violation unless the line — or one of the
#   3 lines above it — carries the inline escape `d2f1-allow: <reason>` (per section-discipline
#   convention: escapes live at the site, no central allowlist). Comment-aware, so the DECISION
#   prose that names these calls documentarily does not trip it.
#
# RED-FIRST: verified by teeth-test — dropping the escape from either surviving fallback, and
#   adding a fresh unescaped getStripe() call to a handler, each make this script exit 1; an
#   escape sitting 4+ lines away does NOT satisfy it.
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"

print_boxed_header "Stripe webhooks: no Stripe API call inside the transaction" "⏱️"

VIOLATIONS=$(node -e '
const fs = require("fs"), path = require("path");
const root = process.argv[1];
const TARGETS = [
  "web-1/src/application/stripe/webhooks/handlers",
  "web-1/src/application/webhooks/stripe/stripe-event-router.ts",
];
const ESCAPE = /d2f1-allow:/;
const out = [];

const stripComments = (src) => {
  let inBlock = false;
  return src.split("\n").map((raw) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) return "";
      line = line.slice(end + 2);
      inBlock = false;
    }
    for (;;) {
      const start = line.indexOf("/*");
      if (start === -1) break;
      const end = line.indexOf("*/", start + 2);
      if (end === -1) { line = line.slice(0, start); inBlock = true; break; }
      line = line.slice(0, start) + line.slice(end + 2);
    }
    const c = line.indexOf("//");
    if (c !== -1) line = line.slice(0, c);
    return line;
  });
};

let scanned = 0;

const check = (file) => {
  if (!file.endsWith(".ts") || file.endsWith(".d.ts") || file.includes(".test.")) return;
  scanned++;
  const raw = fs.readFileSync(file, "utf8");
  const rawLines = raw.split("\n");
  const code = stripComments(raw);
  const rel = file.replace(/\\/g, "/").split("/web-1/")[1];
  code.forEach((line, i) => {
    if (!line.includes("getStripe()")) return;
    const window = rawLines.slice(Math.max(0, i - 3), i + 1).join("\n");
    if (ESCAPE.test(window)) return;
    out.push(rel + ":" + (i + 1) + " — " + rawLines[i].trim());
  });
};

for (const t of TARGETS) {
  const p = path.join(root, t);
  if (!fs.existsSync(p)) continue;
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    // REKURENCJA, nie jeden poziom (S102): poprzednia wersja robiła
    // `readdirSync(p).forEach(check)`, a `check` czyta PLIK — więc pierwszy
    // podkatalog w `handlers/` wypadłby ze skanu bez śladu. Dziś katalog jest
    // płaski, czyli dziura była utajona, nie martwa: wystarczyłby jeden
    // refaktor porządkujący handlery, żeby strażnik przestał cokolwiek mierzyć.
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else check(full);
      }
    };
    walk(p);
  } else {
    check(p);
  }
}
// Floor obecności (S102): zero przeskanowanych plików to nie „czysto", tylko
// rozjazd ścieżek TARGETS ze strukturą repo — meldujemy to jako błąd.
if (scanned === 0) {
  process.stderr.write("SCAN_FLOOR: zero plikow do przeskanowania — sprawdz TARGETS");
  process.exit(2);
}
process.stdout.write(out.join("\n"));
' "${ROOT}")

# ─────────────────────────────────────────────────────────────────────────────
# CHECK 2 — JEDEN SKOK DALEJ (S113, 2026-09-10)
#
# DECISION (nie usuwaj tego komentarza):
# Check 1 mierzy TOKEN (`getStripe()` w handlerze), a reguła mówi o WYWOŁANIU API
# na ścieżce w transakcji. Różnica nie jest teoretyczna: wywołanie wchodziło do
# transakcji przez helper leżący JEDEN katalog obok (`stripe-webhooks.utils.ts`),
# więc w handlerze nie było ani jednego `getStripe()` i strażnik świecił zielono.
# Zmierzone S113: `subscription-lifecycle.handler` wołał `extractPlanIdFromSubscription`
# (→ `extractPlanIdFromPrice` → `stripe.prices.retrieve`) wewnątrz `$transaction`,
# a wywoływana funkcja ma we WŁASNYM DECISION napisane, że nie wolno jej tak wołać.
#
# Dlatego liczymy osiągalność jednym skokiem: w pliku helperów wyznaczamy punkt stały
# funkcji „skażonych" (wołają `getStripe()` wprost albo wołają inną skażoną), a potem
# szukamy ich wywołań w handlerach i routerze. Ta sama furtka co w Check 1:
# `d2f1-allow: <powód>` w oknie 3 linii.
REACH_VIOLATIONS=$(node -e '
const fs = require("fs"), path = require("path");
const root = process.argv[1];
const UTILS = "web-1/src/application/stripe/webhooks/stripe-webhooks.utils.ts";
const TARGETS = [
  "web-1/src/application/stripe/webhooks/handlers",
  "web-1/src/application/webhooks/stripe/stripe-event-router.ts",
];
const ESCAPE = /d2f1-allow:/;
const utilsPath = path.join(root, UTILS);
if (!fs.existsSync(utilsPath)) {
  process.stderr.write("SCAN_FLOOR: brak " + UTILS);
  process.exit(2);
}
const utilsSrc = fs.readFileSync(utilsPath, "utf8").split("\n");

// Ciała funkcji top-level: od `const NAME = ` do najbliższej linii `};` w kolumnie 0.
const bodies = new Map();
for (let i = 0; i < utilsSrc.length; i++) {
  const m = utilsSrc[i].match(/^(?:export\s+)?const\s+(\w+)\s*=/);
  if (!m) continue;
  let end = i + 1;
  while (end < utilsSrc.length && !/^\};/.test(utilsSrc[end])) end++;
  bodies.set(m[1], utilsSrc.slice(i, end + 1).join("\n"));
}

// Punkt stały: skażona = woła getStripe() albo inną skażoną.
const tainted = new Set();
for (const [name, body] of bodies) if (/getStripe\(\)/.test(body)) tainted.add(name);
for (let pass = 0; pass < 10; pass++) {
  let grew = false;
  for (const [name, body] of bodies) {
    if (tainted.has(name)) continue;
    for (const t of tainted) {
      if (new RegExp("\\b" + t + "\\s*\\(").test(body)) { tainted.add(name); grew = true; break; }
    }
  }
  if (!grew) break;
}
if (tainted.size === 0) {
  process.stderr.write("SCAN_FLOOR: zero skazonych helperow — sprawdz parser cial funkcji");
  process.exit(2);
}

const out = [];
const check = (file) => {
  if (!file.endsWith(".ts") || file.endsWith(".d.ts") || file.includes(".test.")) return;
  const rawLines = fs.readFileSync(file, "utf8").split("\n");
  const rel = file.replace(/\\/g, "/").split("/web-1/")[1];
  rawLines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    for (const t of tainted) {
      if (!new RegExp("\\b" + t + "\\s*\\(").test(code)) continue;
      const window = rawLines.slice(Math.max(0, i - 3), i + 1).join("\n");
      if (ESCAPE.test(window)) return;
      out.push(rel + ":" + (i + 1) + " — wywoluje " + t + "() (-> Stripe API): " + line.trim());
      return;
    }
  });
};
for (const t of TARGETS) {
  const p = path.join(root, t);
  if (!fs.existsSync(p)) continue;
  if (fs.statSync(p).isDirectory()) {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full); else check(full);
      }
    };
    walk(p);
  } else check(p);
}
process.stdout.write(out.join("\n"));
' "${ROOT}")

if [[ -n "${REACH_VIOLATIONS}" ]]; then
  VIOLATIONS="${VIOLATIONS}${VIOLATIONS:+$'\n'}${REACH_VIOLATIONS}"
fi

if [[ -n "${VIOLATIONS}" ]]; then
  print_error "Stripe API call on the in-transaction webhook path:"
  echo "${VIOLATIONS}" | while IFS= read -r line; do
    echo "  ❌ ${line}"
  done
  echo ""
  echo "  Fix: resolve it in prefetchStripeEventContext (stripe-event-prefetch.ts), BEFORE the"
  echo "  \$transaction, and thread the value down through routeStripeEvent's prefetch argument."
  echo "  If the call genuinely belongs here (documented fallback / post-commit effect), add an"
  echo "  inline '// d2f1-allow: <reason>' on or just above the line."
  exit 1
fi

print_success "No Stripe API call remains on the in-transaction path"
exit 0
