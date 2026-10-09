#!/usr/bin/env bash
# lock-discipline.sh — Ban raw `FOR UPDATE` pessimistic row-locks OUTSIDE the canonical
# lock primitives (KROK 3b, epic gleaming-tumbling-puddle).
#
# INTENT:
#   Lock-order is a GLOBAL invariant: every multi-row writer must take FOR UPDATE locks in the
#   canonical order User -> StylistAccount -> SessionContainer -> SupportThread (lock-rows.ts
#   DECISION) so an ABBA 40P01 deadlock is impossible by construction. A new op that hand-rolls
#   `SELECT … FOR UPDATE` in a random order silently reintroduces the deadlock class (invisible to
#   TS / mock-unit / sequential tests — only fires under real parallelism). This ratchet forces new
#   pessimistic locks THROUGH a reviewed primitive instead of ad-hoc inline SQL.
#
# RULE: any NON-COMMENT line in web-1/src/{domain,application} containing the SQL `FOR UPDATE`
#   keyword is a VIOLATION, EXCEPT:
#     - the canonical lock-primitive files (ALLOWLIST below): the application/db lock primitive
#       plus the per-domain concurrency lock helpers that own their table's lock SQL;
#     - a line carrying (or within 3 lines below) an inline escape `lock-discipline-allow: <reason>`
#       for a genuinely-bespoke lock (different key/columns than a primitive — e.g. lock-and-READ
#       by created_by_user_id in user-state's active-sub gate).
#   Comment-aware: lines starting with // , * , /* and trailing // comments are stripped, so the many
#   DECISION comments that cite "FOR UPDATE" documentarily do not trip it.
#   Baseline 0 — the inline copy-paste sites (gallery-pin, salon-staff) were consolidated to
#   lockStylistAccount; this ratchet LOCKS that so a new op cannot silently re-introduce ad-hoc locks.
#
# SCOPE: web-1/src/domain + web-1/src/application. Generated client dirs + *.d.ts excluded.
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
WEB1_SRC="${ROOT}/web-1/src"
# Floor obecności (S102): pusty/nieistniejący katalog = fail, nie ciche „0 ✓".
require_source_dir "$WEB1_SRC" "źródeł web-1"

print_boxed_header "Lock discipline: no raw FOR UPDATE outside canonical lock primitives" "🔒"

VIOLATIONS=$(node -e '
const fs = require("fs"), path = require("path");
const roots = process.argv.slice(1);
const RX = /\bFOR\s+UPDATE\b/;
const ALLOW = /lock-discipline-allow:/;
// Canonical lock-SQL homes — these files OWN the FOR UPDATE primitives/wrappers.
const ALLOWLIST = [
  "application/db/lock-rows.ts",
  "domain/moderation/operations/moderation-admin-concurrency.helper.ts",
  "domain/session-container/operations/session-container-concurrency.helper.ts",
  "domain/support/operations/support-thread-lock.helper.ts",
];
const isAllowlisted = (p) => ALLOWLIST.some(a => p.replace(/\\/g, "/").endsWith(a));
const out = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      if (p.includes("/prisma/js-client") || p.includes("/prisma-app-logs/js-client")) continue;
      walk(p);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
      if (isAllowlisted(p)) continue;
      const lines = fs.readFileSync(p, "utf8").split("\n");
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        const codePart = line.split("//")[0];          // drop trailing line-comment
        if (!RX.test(codePart)) return;
        // escape on this line or up to 15 lines above. FOR UPDATE sits at the END of a
        // multi-line $queryRaw template, so the escape comment leading the statement (typed<...>
        // generic + SELECT/FROM/WHERE lines) can be ~10 lines up; 15 gives margin so a future
        // tweak to the SQL formatting does not silently drop the escape. Leak risk (two raw
        // FOR UPDATE within 15 lines in a NON-allowlisted file) is implausible post-consolidation.
        if (ALLOW.test(line) || lines.slice(Math.max(0, i - 15), i).some(l => ALLOW.test(l))) return;
        out.push(`${p}:${i + 1}  ${trimmed}`);
      });
    }
  }
};
for (const r of roots) walk(r);
process.stdout.write(out.join("\n"));
' "${WEB1_SRC}/domain" "${WEB1_SRC}/application")

print_separator

if [[ -n "$VIOLATIONS" ]]; then
  COUNT=$(echo "$VIOLATIONS" | wc -l | tr -d ' ')
  print_error "lock-discipline FAILED — ${COUNT} ad-hoc FOR UPDATE site(s) outside canonical primitives:"
  echo ""
  echo "$VIOLATIONS" | sed "s|${ROOT}/||"
  echo ""
  echo "Fix: take the lock through a canonical primitive — lockStylistAccount (@app/db/lock-rows),"
  echo "  or the per-domain concurrency helper (moderation/session-container/support). New locks MUST"
  echo "  follow the canonical order User->StylistAccount->SessionContainer->SupportThread (lock-rows.ts)."
  echo "  If the lock is genuinely bespoke (different key/columns than a primitive), add an inline"
  echo "  comment: // lock-discipline-allow: <reason>"
  exit 1
fi

print_success "lock-discipline passed — zero ad-hoc FOR UPDATE (canonical primitives + approved escapes only)"
exit 0
