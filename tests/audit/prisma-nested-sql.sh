#!/usr/bin/env bash
# prisma-nested-sql.sh — Ban a nested `Prisma.sql` fragment inside a TAGGED
# `$queryRaw`/`$executeRaw` template. Build the whole query with `Prisma.sql`
# and pass the finished object as an ARGUMENT: `$queryRaw(query)`.
#
# INTENT:
#   Flattening a nested SQL fragment is done by the `Sql` constructor through
#   `child instanceof Sql`. That check only holds when the fragment AND the outer
#   template come from the SAME realization of the `sql-template-tag` module. In
#   the tagged form
#
#       tx.$queryRaw`SELECT … ${fragment} FOR UPDATE`
#
#   the outer template is built by the Prisma client RUNTIME and the fragment by
#   the CALLING module — and under Next/Turbopack bundling those are not the same
#   class. `instanceof` returns false, so the fragment is passed to Postgres as a
#   BIND PARAMETER instead of SQL:
#
#       SELECT … AND "status"::text = 'ACTIVE' $3 FOR UPDATE
#       → 42601 syntax error at or near "$3" → HTTP 500
#
#   Live cost (2026-09-10): every write path taking the active-pair lock (manual
#   visit create, note, result photo, delete) plus — through the `Prisma.empty`
#   branch, which breaks identically — CLIENT_GET_CONTACT_FOR_STYLIST, all 500 on
#   production. The argument form is immune by construction: the flattening then
#   happens inside `Prisma.sql` IN THE CALLING MODULE, so both sides of
#   `instanceof` come from one copy of the module and the client receives a single
#   flat `Sql`. It is also the convention every other nesting site in this repo
#   already follows (admin-log-groups, messaging-query, support-thread-aggregates,
#   cached-counts-backfill, admin-attention, gallery.seed).
#
# WHY A GUARD AND NOT A TEST:
#   Unit tests CANNOT catch this class. The test seam mocks `$queryRaw`/
#   `$executeRaw` (web-1/src/test-utils/setup.ts stubs both on the tx proxy), so
#   the broken form returns the mock's rows and every suite stays green — the
#   fragment never reaches a Postgres parser. Nothing else is mechanical: tsc is
#   happy (both forms typecheck), ESLint has no rule, code review missed it. This
#   ratchet is the ONLY mechanical defence.
#
# WHY IT EXISTS AT ALL — THIRD OCCURRENCE OF ONE CLASS:
#   „duplicated class identity across bundles" has now landed three times in this
#   project, each time silently:
#     1. `instanceof Prisma.PrismaClientKnownRequestError` returning FALSE under
#        Turbopack → every P2002 catch-site was dead code (guarded since:
#        prisma-error-narrowing.sh).
#     2. Module-level mutable state in a module Next bundles TWICE (instrumentation
#        + pages/api) → 207 events queued, 0 emails sent.
#     3. This one — a nested `Prisma.sql` in a tagged template.
#   The class was written down in the skill memory after #1 and #2 and STILL
#   landed a third time, because prose does not block a push. This does.
#
# WHAT IT FLAGS:
#   A `${…}` interpolation inside a TAGGED `$queryRaw`/`$executeRaw` template whose
#   expression is either
#     (a) a literal `Prisma.sql` / `Prisma.empty` / `Prisma.join(…)`, or
#     (b) an identifier the file declares as a SQL fragment — assigned from
#         `Prisma.sql`/`Prisma.empty`/`Prisma.join`, or annotated `: Prisma.Sql`
#         (declaration or function parameter).
#   (b) is the shape that actually shipped: the pre-fix lock-rows.ts interpolated
#   `${activeClientClause}`, a VARIABLE — a guard grepping only for a literal
#   `Prisma.sql` between backticks would have reported green over the live 500.
#
# WHAT IT ALLOWS:
#   - The argument form `$queryRaw(Prisma.sql\`…\`)` / `$queryRaw(query)` — the fix.
#   - Ordinary VALUE interpolation in a tagged template (`${accountId}`, `${key}`):
#     that is exactly what tagged templates are for, and it is bind-parameter safe.
#
# FALSE POSITIVES — honest scope:
#   The scanner is textual and PER-FILE. A builder declared in the same file is
#   covered (`function buildClause(): Prisma.Sql`, or a const whose body builds
#   fragments), but a fragment IMPORTED from another module is NOT seen: that is a
#   false NEGATIVE, not a false positive. In the other direction
#   a value variable that merely happens to be initialised from an expression
#   MENTIONING `Prisma.sql` would be flagged; no such site exists today, and the
#   right answer there is the argument form anyway.
#   Deliberate exception: `// prisma-nested-sql-allow: <reason>` on the offending
#   line, anywhere inside the template, or on the line above it. The reason is
#   MANDATORY — a bare marker is itself a violation (an escape nobody had to
#   justify is how a ratchet rots into decoration).
#
# SCOPE: web-1/src + scripts/ + .shared-kernel (*.ts, no *.d.ts), excluding
#   node_modules and the generated `*/js-client/` clients. Comment-aware: the
#   comment strip runs BEFORE the scan, so the DECISION block in lock-rows.ts that
#   spells the broken form out verbatim does not trip its own guard.
#
# EXIT: 0 if PASS, 1 if a nested fragment sits in a tagged template.

set -euo pipefail
source "$(dirname "$0")/_utils.sh"

ROOT="$(get_project_root)"

print_boxed_header "Prisma nested SQL: no fragment inside a tagged \$queryRaw template" "🧩"

require_source_dir "${ROOT}/web-1/src" "web-1 sources" "ts"

SCAN_DIRS=()
for d in "${ROOT}/web-1/src" "${ROOT}/scripts" "${ROOT}/.shared-kernel"; do
  [[ -d "$d" ]] && SCAN_DIRS+=("$d")
done

print_header "Scanning raw-SQL call sites for nested Prisma.sql fragments"

REPORT=$(node -e '
const fs = require("fs"), path = require("path");
const roots = process.argv.slice(1);

// Comment strip, line numbers preserved (same rule and same accepted trade-off as
// strip_comments_keep_lines in _utils.sh: comment markers inside a string literal
// are treated as comments — cheaper than a string parser in a guard, and the
// failure mode is a false negative, never a false alarm).
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
   .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));

const skipWs = (s, i) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };

const skipQuoted = (s, i) => {
  const q = s[i]; let j = i + 1;
  while (j < s.length) {
    if (s[j] === "\\") { j += 2; continue; }
    if (s[j] === q || s[j] === "\n") return j + 1;
    j++;
  }
  return j;
};

// `<…>` after $queryRaw is always a generic; balanced so nested type args
// (Array<{ date: Date; count: bigint }>) survive.
const skipGenerics = (s, i) => {
  let depth = 0, j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === "<") depth++;
    else if (c === ">") { depth--; if (depth === 0) return j + 1; }
    j++;
  }
  return -1;
};

// Walk a template literal from its opening backtick; collect every `${…}` body.
const scanTemplate = (s, i) => {
  const interps = []; let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "`") return { end: j, interps };
    if (c === "$" && s[j + 1] === "{") {
      const r = scanInterp(s, j + 2);
      if (!r) return { end: j, interps };
      interps.push({ text: r.text, at: j });
      j = r.end + 1; continue;
    }
    j++;
  }
  return { end: s.length - 1, interps };
};

// Balanced `${ … }` body; strings and nested templates are skipped whole.
function scanInterp(s, k) {
  let depth = 1, j = k;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "{") { depth++; j++; continue; }
    if (c === "}") { depth--; if (depth === 0) return { end: j, text: s.slice(k, j) }; j++; continue; }
    if (c === "\x27" || c === "\"") { j = skipQuoted(s, j); continue; }
    if (c === "`") { j = scanTemplate(s, j).end + 1; continue; }
    j++;
  }
  return null;
}

// Statement text from an `=` up to the top-level `;` (or a closing bracket that
// belongs to an enclosing construct) — enough to see a ternary spanning lines.
const scanStatement = (s, i) => {
  let j = i, depth = 0;
  while (j < s.length) {
    const c = s[j];
    if (c === "\x27" || c === "\"") { j = skipQuoted(s, j); continue; }
    if (c === "`") { j = scanTemplate(s, j).end + 1; continue; }
    if (c === "(" || c === "[" || c === "{") { depth++; j++; continue; }
    if (c === ")" || c === "]" || c === "}") { if (depth === 0) break; depth--; j++; continue; }
    if (c === ";" && depth === 0) break;
    j++;
  }
  return s.slice(i, j);
};

const FRAGMENT_LITERAL = /Prisma\.(?:sql\s*`|empty\b|join\s*\()/;
const ALLOW = /prisma-nested-sql-allow:[ \t]*(\S?)/;

const files = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === "js-client") continue;
      walk(p);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
      files.push(p);
    }
  }
};
roots.forEach(walk);

let sites = 0;
const violations = [];
const badEscapes = [];

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  if (!/\$(?:queryRaw|executeRaw)\b/.test(raw)) continue;
  const code = stripComments(raw);
  const rawLines = raw.split("\n");
  const lineOf = (idx) => code.slice(0, idx).split("\n").length;

  // Escape markers are read from the ORIGINAL text (they live in comments, which
  // the strip above blanked out). A marker with no reason is itself a finding.
  const escapes = new Set();
  rawLines.forEach((line, i) => {
    const m = line.match(ALLOW);
    if (!m) return;
    if (!m[1]) { badEscapes.push(`${file}:${i + 1}: prisma-nested-sql-allow: without a reason`); return; }
    escapes.add(i + 1);
  });

  // Identifiers this file holds a SQL FRAGMENT in — the shape that actually
  // shipped (`${activeClientClause}`), invisible to a literal-only grep.
  const fragVars = new Set();
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*Prisma\.Sql\b/g)) fragVars.add(m[1]);
  // A builder DECLARED in this file (`function buildScopeFilter(…): Prisma.Sql`)
  // counts too — `${buildScopeFilter(body)}` in a tagged template breaks exactly
  // like the variable form. The arrow-assigned twin is already covered by the
  // declaration scan below (its body mentions Prisma.sql).
  for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\([\s\S]{0,400}?\)\s*:\s*Prisma\.Sql\b/g)) fragVars.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=/g)) {
    if (FRAGMENT_LITERAL.test(scanStatement(code, m.index + m[0].length))) fragVars.add(m[1]);
  }

  for (const m of code.matchAll(/\$(?:queryRaw|executeRaw)\b/g)) {
    sites++;
    let i = skipWs(code, m.index + m[0].length);
    if (code[i] === "<") {
      const g = skipGenerics(code, i);
      if (g < 0) continue;
      i = skipWs(code, g);
    }
    if (code[i] !== "`") continue; // argument form `$queryRaw(query)` — the fix
    const tpl = scanTemplate(code, i);
    const startLine = lineOf(i), endLine = lineOf(tpl.end);
    let escaped = false;
    for (let l = startLine - 1; l <= endLine; l++) if (escapes.has(l)) escaped = true;

    for (const it of tpl.interps) {
      const expr = it.text.trim();
      const idents = expr.match(/[A-Za-z_$][\w$]*/g) || [];
      const literal = FRAGMENT_LITERAL.test(expr);
      const viaVar = idents.some((id) => fragVars.has(id));
      if (!literal && !viaVar) continue;
      if (escaped) continue;
      violations.push(
        `${file}:${lineOf(it.at)}: \${${expr.replace(/\s+/g, " ")}} — ` +
        (literal ? "literal Prisma fragment" : "SQL fragment variable") +
        " interpolated into a TAGGED raw template"
      );
    }
  }
}

console.log(JSON.stringify({ sites, violations, badEscapes }));
' "${SCAN_DIRS[@]}")

SITES=$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).sites))' "$REPORT")
FINDINGS=$(node -e '
const r = JSON.parse(process.argv[1]);
[...r.badEscapes, ...r.violations].forEach((v) => console.log("  " + v));
' "$REPORT")

require_scanned "$SITES" "wywołań \$queryRaw/\$executeRaw"
print_info "Przeskanowano ${SITES} wywołań surowego SQL"

print_separator

if [[ -n "$FINDINGS" ]]; then
  COUNT=$(echo "$FINDINGS" | grep -c '' || true)
  print_error "Prisma nested SQL FAILED — ${COUNT} naruszenie(a):"
  echo ""
  echo "$FINDINGS"
  echo ""
  echo "Fix: build the whole query with Prisma.sql and pass it as an ARGUMENT."
  echo ""
  echo "  BROKEN (fragment arrives as a bind parameter → 42601 → HTTP 500):"
  echo "    const clause = cond ? Prisma.sql\`AND x = 1\` : Prisma.empty;"
  echo "    await tx.\$queryRaw\`SELECT … \${clause} FOR UPDATE\`;"
  echo ""
  echo "  CORRECT (flattening happens in THIS module, one flat Sql reaches Prisma):"
  echo "    const query = Prisma.sql\`SELECT … \${clause} FOR UPDATE\`;"
  echo "    await tx.\$queryRaw(query);"
  echo ""
  echo "Canon + full rationale: web-1/src/application/db/lock-rows.ts (DECISION at lockActivePair)."
  echo "Deliberate exception: '// prisma-nested-sql-allow: <reason>' on the line (reason mandatory)."
  exit 1
fi

print_success "Prisma nested SQL passed — every nested fragment goes through the argument form"
exit 0
