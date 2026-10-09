#!/usr/bin/env bash
# prisma-error-narrowing.sh — Ban `instanceof Prisma.*Error` (Turbopack-unsafe) in web-1.
#
# INTENT:
#   Under Turbopack the same module is realized multiple times, so
#   `error instanceof Prisma.PrismaClientKnownRequestError` returns FALSE even for a REAL
#   PrismaError (duplicated class identity across bundle realizations). Every catch that routes
#   a Prisma code (P2002 idempotency / P2025 / P2003 / ...) via instanceof silently SKIPS its
#   graceful branch and falls to an unmapped HTTP 500 under concurrency (proven live: a
#   session-container CREATE race took 54/100 x 500 before the fix). The SSOT structural
#   detectors live in web-1/src/application/db/prisma-error.ts (isPrismaErrorCode / isP2002 /
#   isP2025 / isP2003 / isDeadlock / isConcurrencyConflict) + serialization-conflict.ts
#   (isSerializationConflict) — all hasCode-based property checks, Turbopack-safe. Use THOSE.
#
# RULE: any NON-COMMENT line in web-1/src/{domain,application} matching `instanceof Prisma.`
#   (the Prisma namespace form) is a VIOLATION. Local sentinel classes (GalleryQuotaRaceRollback,
#   PairingLimitExceededRollback, SessionClosedInTxError, ...) use `instanceof <LocalClass>` and
#   are NOT flagged — only the bundler-unsafe `instanceof Prisma.*`. Comment-aware (lines starting
#   with // , * , /* and trailing // comments are skipped, so the many DECISION comments that cite
#   "instanceof Prisma" documentarily do not trip it). Escape: an inline/above comment
#   `prisma-error-narrowing-allow: <reason>`. Baseline 0 — the eradication already landed; this
#   ratchet LOCKS it so a new op cannot silently reintroduce the class.
#
# SCOPE: web-1/src/domain + web-1/src/application (the Prisma-touching code). Generated client
#   dirs + *.d.ts excluded. .shared-kernel does not import the Prisma client (no scan needed).
#
# EXIT: 0 if PASS, 1 if violations found.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"
WEB1_SRC="${ROOT}/web-1/src"

print_boxed_header "Prisma error narrowing: no instanceof Prisma.*Error (Turbopack-unsafe)" "🧨"

VIOLATIONS=$(node -e '
const fs = require("fs"), path = require("path");
const roots = process.argv.slice(1);
const RX = /\binstanceof\s+Prisma\./;
// KROK 3b: bare `=== '\''P2025'\''` (P2025 detection by raw string compare) is banned too —
// all 28 inline sites were consolidated to isP2025() (@app/db/prisma-error), baseline 0.
// Locks that consolidation: a new op must use isP2025(error), not `(error.)?code === '\''P2025'\''`.
// Scope = P2025 ONLY (P2002/P2003 bare-compares are NOT migrated yet → out of scope here).
const RX_P2025 = /===\s*['\''"]P2025['\''"]/;
const ALLOW = /prisma-error-narrowing-allow:/;
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
      const lines = fs.readFileSync(p, "utf8").split("\n");
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        const codePart = line.split("//")[0];          // drop trailing line-comment
        const hit = RX.test(codePart) || RX_P2025.test(codePart);
        if (!hit) return;
        if (ALLOW.test(line) || lines.slice(Math.max(0, i - 3), i).some(l => ALLOW.test(l))) return;
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
  print_error "prisma-error-narrowing FAILED — ${COUNT} site(s): instanceof Prisma.* (Turbopack-unsafe) OR bare === 'P2025':"
  echo ""
  echo "$VIOLATIONS" | sed "s|${ROOT}/||"
  echo ""
  echo "Fix: use the structural SSOT detectors from @app/db/prisma-error"
  echo "  (isPrismaErrorCode / isP2002 / isP2025 / isP2003 / isDeadlock / isConcurrencyConflict)"
  echo "  or isSerializationConflict from @app/db/serialization-conflict — hasCode-based,"
  echo "  Turbopack-safe. NEVER 'instanceof Prisma.*' (duplicated class identity returns false)."
  echo "  If genuinely unavoidable, add a comment: // prisma-error-narrowing-allow: <reason>"
  exit 1
fi

print_success "prisma-error-narrowing passed — zero instanceof Prisma.* (structural detectors only)"
exit 0
