#!/usr/bin/env bash
# stripe-claim-first.sh — Guard: every transaction that routes a Stripe webhook event
# MUST claim the StripeEvent row FIRST (turbo-review S89).
#
# INTENT:
#   Two independent paths process the same Stripe event: the webhook hot path
#   (pages/api/v1/webhooks/stripe/index.ts) and the janitor sweeper
#   (application/stripe/webhooks/janitor/stripe-event-janitor.operations.ts). Their mutual
#   exclusion CANNOT rest on the session-level advisory lock — that lock is dead under Neon
#   transaction pooling (acquire/unlock land on different backends) and `pg_try_advisory_lock`
#   is REENTRANT on a backend already holding the key, so a pooled hot path can walk straight
#   through a lock the janitor "holds". The only guard that survives pooling is the conditional
#   row-claim `claimEventForProcessingTx` (UPDATE … WHERE processed=false) taken as the FIRST
#   statement inside the transaction.
#
#   The janitor used to write the row LAST (bare markEventProcessedTx after the handler). That
#   left a window in which the hot path saw processed=false, claimed it, and ran the handler in
#   parallel → DUPLICATE post-commit effects (two emails / second autoCancel / duplicated
#   critical alert; the recency-CAS in updateAccountPlanStatus is `lte`, so an identical
#   eventCreatedAt passes twice). It also inverted the lock order against the hot path
#   (per-account advisory-xact-lock before the StripeEvent row-lock), i.e. a latent ABBA
#   deadlock. Claim-first fixes BOTH invariants at once, so it is not a style preference.
#
#   A new/edited caller that routes the event before claiming it = regression of that class.
#
# WHAT IT CHECKS (scope: web-1/src, excluding the router that DEFINES routeStripeEvent):
#   Every file CALLING `routeStripeEvent(` must also call `claimEventForProcessingTx(`, and the
#   first such call must appear on an EARLIER line than the first `routeStripeEvent(` call.
#   Comment-aware: `//`-prefixed and trailing-comment text is stripped before matching, so the
#   many DECISION comments naming these functions (including ones that show the OLD order as
#   the thing not to do) cannot produce either a false PASS or a false FAIL.
#
# ESCAPE: inline `// claim-first-allow: <reason>` on the routeStripeEvent call line.
#
# RED-FIRST: verified by teeth-test on BOTH call sites — moving the claim after
#   routeStripeEvent, and deleting the claim entirely, each make this script exit 1; a
#   comment-only mention of claimEventForProcessingTx does NOT satisfy it.
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
WEB1_SRC="${ROOT}/web-1/src"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$WEB1_SRC" "źródeł web-1"

print_boxed_header "Stripe webhooks: claim the event row before routing it" "🎟️"

VIOLATIONS=$(node -e '
const fs = require("fs"), path = require("path");
const root = process.argv[1];
// The router DEFINES routeStripeEvent; it never opens a transaction of its own.
const DEFINER = "application/webhooks/stripe/stripe-event-router.ts";
const ALLOW = /claim-first-allow:/;
const out = [];

// Strip line comments and block-comment bodies so a documentary mention of either
// function name can neither trip the guard nor satisfy it.
const stripComments = (src) => {
  const lines = src.split("\n");
  let inBlock = false;
  return lines.map((raw) => {
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
    const lineComment = line.indexOf("//");
    if (lineComment !== -1) line = line.slice(0, lineComment);
    return line;
  });
};

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "js-client", "generated"].includes(entry.name)) continue;
      walk(p);
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
    const rel = p.replace(/\\/g, "/").split("/web-1/src/")[1];
    if (rel === DEFINER) continue;

    const raw = fs.readFileSync(p, "utf8");
    const rawLines = raw.split("\n");
    const code = stripComments(raw);

    const routeAt = code.findIndex((l) => l.includes("routeStripeEvent("));
    if (routeAt === -1) continue;
    if (ALLOW.test(rawLines[routeAt] ?? "")) continue;

    const claimAt = code.findIndex((l) => l.includes("claimEventForProcessingTx("));
    if (claimAt === -1) {
      out.push(rel + ":" + (routeAt + 1) + " — routes the event without ever claiming it (claimEventForProcessingTx missing)");
      continue;
    }
    if (claimAt > routeAt) {
      out.push(rel + ":" + (routeAt + 1) + " — routeStripeEvent runs BEFORE claimEventForProcessingTx (line " + (claimAt + 1) + "); claim must be the first statement of the tx");
    }
  }
};

walk(root);
process.stdout.write(out.join("\n"));
' "${WEB1_SRC}")

if [[ -n "${VIOLATIONS}" ]]; then
  print_error "Stripe event routed without a preceding row-claim:"
  echo "${VIOLATIONS}" | while IFS= read -r line; do
    echo "  ❌ ${line}"
  done
  echo ""
  echo "  Fix: make claimEventForProcessingTx(tx, eventId) the FIRST statement inside the"
  echo "  \$transaction, before routeStripeEvent. It is what keeps the hot path and the janitor"
  echo "  from processing one event twice (the advisory lock is dead under pooling) AND what"
  echo "  keeps the lock order identical on both paths."
  exit 1
fi

print_success "Every routeStripeEvent caller claims the StripeEvent row first"
exit 0
