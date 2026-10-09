#!/usr/bin/env node
// event-reader-writer.mjs — AST helper for tests/audit/event-reader-writer.sh.
//
// Finds every backend READ of the EventLog table filtered by a specific
// `APP_EVENTS.INFO.<Group>.<Key>` value, and every mechanism that WRITES a row
// under that value, then reports a READ key that no WRITE mechanism ever
// produces. Real incident (2026-09-23): a daily admin digest queried
// `event: APP_EVENTS.INFO.ACCOUNT.ACCOUNT_CREATED`, but nothing in the
// codebase ever wrote ACCOUNT_CREATED — the digest could never fire. Fixed to
// read USER_REGISTERED (the event Better Auth's user.create hook actually
// writes). This script is the mechanical guard against a repeat.
//
// WHY AST AND NOT SAME-LINE REGEX (AGENTS.md "GUARDS MEASURE THE RULE, NOT A
// KEYWORD"): prettier wraps a `where: {...}` object across many lines, and a
// Prisma call's `where` is frequently built as a separate `const where = {...}`
// mutated afterwards (`where.event = {...}`) rather than written inline. A
// same-line grep sees neither shape. The TypeScript compiler API (`typescript`,
// already a root devDependency) parses the real AST once per file, so both
// shapes resolve the same way regardless of formatting.
//
// READ SITE — a call `<expr>.eventLog.<findMany|findFirst|findUnique|count|
// groupBy|aggregate>({ where: <W>, ... })` (also `tx.eventLog...` and a `where`
// built as a local `const where = {...}` and later mutated via
// `where.event = ...`, both resolved by name within the file) whose `where`
// carries an `event` property that is:
//   - a direct `APP_EVENTS.INFO.<G>.<K>` member access, OR
//   - a bare string literal, OR
//   - `{ in: [...] }` (or `{ equals: <X> }`) where every element resolves to
//     one of the above, including a local `const ARR = [APP_EVENTS..., ...]`
//     spread in the SAME file (one level of resolution — an imported array or
//     one built via `.map()`/`.filter()` is NOT resolved: false negative,
//     documented, matches the scope the calling guard's header promises).
// `{ notIn: ... }`, `{ contains: ... }` and similar substring/exclusion
// operators do not name a single key to check for a writer, so they are
// OUT-OF-SCOPE by definition, not violations.
// A `respondSuccess(res, data, APP_EVENTS.INFO...)` / `{ event: APP_EVENTS... }`
// response envelope is not a Prisma call at all, so it is structurally
// invisible to this scan — never mistaken for a read.
//
// WRITE MECHANISM — a key counts as written when it is produced by any of:
//   (A) `recordAuditEvent_IO({ eventName: <X>, ... })`
//   (B) `writeRawEventLog_IO({ eventName: <X>, ... })` — the lower-level
//       writer called directly by ~20 admin/auth/webhook sites that bypass (A)
//   (C) `sendTransactionalEmail(templateId, user, <X>, ...)` — forwards its
//       3rd positional arg into (A) one call down (email-transactional.ts);
//       resolved at the CALLER because the forwarding site itself receives it
//       as a plain parameter (dynamic, unresolvable in isolation)
//   (D) `<expr>.eventLog.create({ data: { event: <X>, ... } })` /
//       `.createMany({ data: [{ event: <X> }, ...] })` — a handful of sites
//       (export-user-data rate-limit marker, the writer function's own
//       `db.eventLog.create` — dynamic there, so a no-op) write the row
//       directly, bypassing (A)/(B)
//   (E) `infoEvent: '<VALUE>'` (or an APP_EVENTS member) inside
//       `.shared-kernel/domain/email/email-schedule.config.ts` — the
//       lifecycle sweep calls (A)/(B) with `eventName: rule.infoEvent`, a
//       parameter dynamic at every call site, so the literal is validated at
//       its only static source instead (same approach as the existing
//       event-log-registration.sh audit, Step 3b/3c)
// In every mechanism, <X> is classified by the SAME resolver used for reads
// (direct member / string literal / same-file local array), so a dynamic
// eventName (a bare parameter, `rule.infoEvent`, `dunningRule.infoEvent`) is
// simply not counted from THAT call site — never a false WRITE.
//
// VALUE RESOLUTION: an `APP_EVENTS.INFO.<G>.<K>` reference is compared by its
// runtime STRING VALUE, resolved from `.shared-kernel/domain/events/
// app-events.const.ts` when that file is present and parses; if not (or the
// specific path is not in it), this falls back to the property name <K> —
// true for every INFO event in this repo except one
// (CANNOT_DELETE_MAIN_POLICY -> 'ADMIN_CANNOT_DELETE_MAIN_POLICY', unrelated
// to any EventLog read/write site found when this guard was built). This
// makes app-events.const.ts a BEST-EFFORT input, not a hard anchor — unlike
// event-log-registration.sh, this guard's correctness does not depend on it
// existing (a deliberate simplification: no fixture needs to stub it).
//
// ESCAPE: `event-reader-writer-allow: <reason>` as a comment anywhere on the
// line of the offending `event:`/`where.event =` or on the line directly
// above it (mirrors prisma-nested-sql-allow). A bare marker with no reason is
// itself reported as a failure, scanned file-wide independent of call sites.
//
// HONEST SCOPE: per-file and one-hop. A read/write key threaded through an
// imported array, a `.map()`/`.filter()` projection, or a cross-file constant
// is DYNAMIC — not checked, not a false positive, not a false green (reported
// as "unresolved", never silently dropped from the stats).
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('usage: event-reader-writer.mjs <project-root>');
  process.exit(2);
}

const WEB1_SRC = path.join(ROOT, 'web-1/src');
const KERNEL = path.join(ROOT, '.shared-kernel');
const APP_EVENTS_FILE = path.join(
  KERNEL,
  'domain/events/app-events.const.ts'
);
const EMAIL_SCHEDULE_FILE = path.join(
  KERNEL,
  'domain/email/email-schedule.config.ts'
);

const READ_METHODS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'count',
  'groupBy',
  'aggregate',
]);
const WRITE_CREATE_METHODS = new Set(['create', 'createMany']);

const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.next',
  'js-client',
  'READONLY-shared-kernel',
  '_fixtures',
  'dist',
  'out',
]);

// ── walk ────────────────────────────────────────────────────────────────
const walk = (dir, out) => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
};

// ── AST helpers ─────────────────────────────────────────────────────────
const unwrap = node => {
  while (node) {
    switch (node.kind) {
      case ts.SyntaxKind.ParenthesizedExpression:
      case ts.SyntaxKind.AsExpression:
      case ts.SyntaxKind.SatisfiesExpression:
      case ts.SyntaxKind.NonNullExpression:
      case ts.SyntaxKind.TypeAssertionExpression:
        node = node.expression;
        continue;
      default:
        break;
    }
    break;
  }
  return node;
};

const findProperty = (objNode, name) =>
  objNode.properties.find(p => {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
      return p.name.text === name;
    }
    if (ts.isShorthandPropertyAssignment(p)) {
      return p.name.text === name;
    }
    return false;
  });

const matchAppEventsMember = node => {
  if (!ts.isPropertyAccessExpression(node)) return null;
  const key = node.name.text;
  const groupNode = node.expression;
  if (!ts.isPropertyAccessExpression(groupNode)) return null;
  const group = groupNode.name.text;
  const infoNode = groupNode.expression;
  if (!ts.isPropertyAccessExpression(infoNode) || infoNode.name.text !== 'INFO') {
    return null;
  }
  const rootNode = infoNode.expression;
  if (!ts.isIdentifier(rootNode) || rootNode.text !== 'APP_EVENTS') return null;
  return { group, key, path: `APP_EVENTS.INFO.${group}.${key}` };
};

// ── PATH_TO_VALUE map (best-effort — see header) ──────────────────────────
const PATH_TO_VALUE = new Map();
const loadAppEventsValueMap = filePath => {
  if (!fs.existsSync(filePath)) return false;
  let sf;
  try {
    sf = ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
  } catch {
    return false;
  }
  // Walk to `const APP_EVENTS = { ... INFO: { GROUP: { KEY: 'VALUE' } } }`.
  let infoObj = null;
  const findAppEvents = node => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'APP_EVENTS' &&
      node.initializer
    ) {
      const init = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(init)) {
        const infoProp = findProperty(init, 'INFO');
        if (infoProp && ts.isPropertyAssignment(infoProp)) {
          const infoVal = unwrap(infoProp.initializer);
          if (ts.isObjectLiteralExpression(infoVal)) infoObj = infoVal;
        }
      }
      return;
    }
    ts.forEachChild(node, findAppEvents);
  };
  findAppEvents(sf);
  if (!infoObj) return false;
  for (const groupProp of infoObj.properties) {
    if (!ts.isPropertyAssignment(groupProp) || !ts.isIdentifier(groupProp.name)) {
      continue;
    }
    const group = groupProp.name.text;
    const groupVal = unwrap(groupProp.initializer);
    if (!ts.isObjectLiteralExpression(groupVal)) continue;
    for (const keyProp of groupVal.properties) {
      if (!ts.isPropertyAssignment(keyProp) || !ts.isIdentifier(keyProp.name)) {
        continue;
      }
      const valNode = unwrap(keyProp.initializer);
      if (ts.isStringLiteralLike(valNode)) {
        PATH_TO_VALUE.set(`APP_EVENTS.INFO.${group}.${keyProp.name.text}`, valNode.text);
      }
    }
  }
  return true;
};
const appEventsMapLoaded = loadAppEventsValueMap(APP_EVENTS_FILE);

const resolveMemberValue = mem => PATH_TO_VALUE.get(mem.path) || mem.key;

// ── WRITE_KEYS (mechanism E first — file-scoped, no per-file context needed) ─
const WRITE_KEYS = new Set();
let scheduleInfoEventCount = 0;
const scheduleFileExists = fs.existsSync(EMAIL_SCHEDULE_FILE);
if (scheduleFileExists) {
  const sf = ts.createSourceFile(
    EMAIL_SCHEDULE_FILE,
    fs.readFileSync(EMAIL_SCHEDULE_FILE, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const visit = node => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'infoEvent'
    ) {
      const val = unwrap(node.initializer);
      if (ts.isStringLiteralLike(val)) {
        WRITE_KEYS.add(val.text);
        scheduleInfoEventCount++;
      } else {
        const mem = matchAppEventsMember(val);
        if (mem) {
          WRITE_KEYS.add(resolveMemberValue(mem));
          scheduleInfoEventCount++;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ── per-file classification (needs same-file local const resolution) ──────
const classifyValue = (rawNode, ctx) => {
  const node = unwrap(rawNode);
  const mem = matchAppEventsMember(node);
  if (mem) return { kind: 'literal', values: [resolveMemberValue(mem)] };
  if (ts.isStringLiteralLike(node)) return { kind: 'literal', values: [node.text] };
  if (ts.isObjectLiteralExpression(node)) {
    const inProp = findProperty(node, 'in');
    if (inProp && ts.isPropertyAssignment(inProp)) {
      return resolveArray(inProp.initializer, ctx);
    }
    const eqProp = findProperty(node, 'equals');
    if (eqProp && ts.isPropertyAssignment(eqProp)) {
      return classifyValue(eqProp.initializer, ctx);
    }
    // notIn / contains / startsWith / ... — no single key named, out of scope.
    return { kind: 'out-of-scope' };
  }
  if (ts.isIdentifier(node)) {
    const resolved = ctx.resolveIdentifierInit(node.text);
    if (resolved) return classifyValue(resolved, ctx);
    return { kind: 'dynamic' };
  }
  return { kind: 'dynamic' };
};

const resolveArray = (rawNode, ctx) => {
  const node = unwrap(rawNode);
  if (ts.isArrayLiteralExpression(node)) {
    const values = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) {
        const inner = resolveArray(el.expression, ctx);
        if (inner.kind !== 'literal') return { kind: 'dynamic' };
        values.push(...inner.values);
      } else {
        const r = classifyValue(el, ctx);
        if (r.kind !== 'literal') return { kind: 'dynamic' };
        values.push(...r.values);
      }
    }
    return { kind: 'literal', values };
  }
  if (ts.isIdentifier(node)) {
    const resolved = ctx.resolveIdentifierInit(node.text);
    if (resolved) return resolveArray(resolved, ctx);
    return { kind: 'dynamic' };
  }
  return { kind: 'dynamic' };
};

// ── extract `event` property value node(s) from a `where`-shaped object ───
// Recurses one level into `...(cond ? { event: X } : {})` and `...localObj`
// spreads (the two shapes actually used in this repo — event-log.client.ts's
// conditional userFacingOnly spread, and nothing else needs more).
const extractEventValueNodes = (objNode, ctx, depth = 0) => {
  if (depth > 4) return [];
  const out = [];
  for (const prop of objNode.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'event'
    ) {
      out.push(prop.initializer);
    } else if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === 'event') {
      out.push(prop.name);
    } else if (ts.isSpreadAssignment(prop)) {
      const expr = unwrap(prop.expression);
      if (ts.isConditionalExpression(expr)) {
        for (const branch of [expr.whenTrue, expr.whenFalse]) {
          const b = unwrap(branch);
          if (ts.isObjectLiteralExpression(b)) {
            out.push(...extractEventValueNodes(b, ctx, depth + 1));
          }
        }
      } else if (ts.isIdentifier(expr)) {
        const resolved = ctx.resolveIdentifierInit(expr.text);
        const r = resolved && unwrap(resolved);
        if (r && ts.isObjectLiteralExpression(r)) {
          out.push(...extractEventValueNodes(r, ctx, depth + 1));
        }
      }
    }
  }
  return out;
};

const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

// ── main per-file scan ─────────────────────────────────────────────────
const READ_SITES = [];
const READ_CALL_SITES_TOTAL = { count: 0 };
const BAD_ESCAPES = [];

const scanFile = filePath => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const rawLines = raw.split('\n');
  let sf;
  try {
    sf = ts.createSourceFile(filePath, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  } catch {
    return; // unparsable file: skip rather than crash the whole scan
  }

  // Escape markers, scanned from the ORIGINAL text (comments) file-wide —
  // same approach as prisma-nested-sql-allow: a bare marker is always a
  // finding, independent of whether a call site actually needed it.
  const escapeLines = new Set();
  rawLines.forEach((line, idx) => {
    const m = line.match(/event-reader-writer-allow:\s*(\S.*)?$/);
    if (!m) return;
    if (m[1] && m[1].trim().length > 0) {
      escapeLines.add(idx + 1);
    } else {
      BAD_ESCAPES.push(`${filePath}:${idx + 1}: event-reader-writer-allow: bez powodu`);
    }
  });
  const hasEscape = hostNode => {
    const startLine = lineOf(sf, hostNode.getStart(sf));
    const endLine = lineOf(sf, hostNode.getEnd());
    for (let l = Math.max(1, startLine - 1); l <= endLine; l++) {
      if (escapeLines.has(l)) return true;
    }
    return false;
  };

  // Local top-level `const X = <expr>` map, for same-file array/where resolution.
  const localConsts = new Map();
  const collectDecls = node => {
    if (
      (ts.isVariableDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      localConsts.set(node.name.text, unwrap(node.initializer));
    }
    ts.forEachChild(node, collectDecls);
  };
  collectDecls(sf);
  const ctx = {
    resolveIdentifierInit: name => (localConsts.has(name) ? localConsts.get(name) : null),
  };

  const registerRead = (valueNode, hostNode) => {
    const classification = classifyValue(valueNode, ctx);
    READ_SITES.push({
      file: filePath,
      line: lineOf(sf, valueNode.getStart(sf)),
      classification,
      escaped: hasEscape(hostNode),
    });
  };

  const registerWrite = valueNode => {
    const classification = classifyValue(valueNode, ctx);
    if (classification.kind === 'literal') {
      for (const v of classification.values) WRITE_KEYS.add(v);
    }
  };

  const handleEventLogReadCall = (callNode, argsObj) => {
    const whereProp = findProperty(argsObj, 'where');
    if (!whereProp) return;
    let whereObj = null;
    if (ts.isPropertyAssignment(whereProp)) {
      const val = unwrap(whereProp.initializer);
      if (ts.isObjectLiteralExpression(val)) {
        whereObj = val;
      } else if (ts.isIdentifier(val)) {
        const resolved = ctx.resolveIdentifierInit(val.text);
        const r = resolved && unwrap(resolved);
        if (r && ts.isObjectLiteralExpression(r)) whereObj = r;
      }
    } else if (ts.isShorthandPropertyAssignment(whereProp)) {
      const resolved = ctx.resolveIdentifierInit(whereProp.name.text);
      const r = resolved && unwrap(resolved);
      if (r && ts.isObjectLiteralExpression(r)) whereObj = r;
    }
    if (!whereObj) return;
    for (const valueNode of extractEventValueNodes(whereObj, ctx)) {
      registerRead(valueNode, callNode);
    }
  };

  const handleWriteCall = (callNode, callee) => {
    if (
      ts.isIdentifier(callee) &&
      (callee.text === 'recordAuditEvent_IO' || callee.text === 'writeRawEventLog_IO')
    ) {
      const argsObj = callNode.arguments[0] && unwrap(callNode.arguments[0]);
      if (argsObj && ts.isObjectLiteralExpression(argsObj)) {
        const prop = findProperty(argsObj, 'eventName');
        if (prop) {
          const valueNode = ts.isPropertyAssignment(prop) ? prop.initializer : prop.name;
          registerWrite(valueNode);
        }
      }
      return;
    }
    if (ts.isIdentifier(callee) && callee.text === 'sendTransactionalEmail') {
      const arg = callNode.arguments[2];
      if (arg) registerWrite(arg);
      return;
    }
    if (
      ts.isPropertyAccessExpression(callee) &&
      WRITE_CREATE_METHODS.has(callee.name.text) &&
      ts.isPropertyAccessExpression(callee.expression) &&
      callee.expression.name.text === 'eventLog'
    ) {
      const argsObj = callNode.arguments[0] && unwrap(callNode.arguments[0]);
      if (!argsObj || !ts.isObjectLiteralExpression(argsObj)) return;
      const dataProp = findProperty(argsObj, 'data');
      if (!dataProp || !ts.isPropertyAssignment(dataProp)) return;
      const dataVal = unwrap(dataProp.initializer);
      const dataObjs = ts.isArrayLiteralExpression(dataVal)
        ? dataVal.elements.map(unwrap).filter(ts.isObjectLiteralExpression)
        : ts.isObjectLiteralExpression(dataVal)
          ? [dataVal]
          : [];
      for (const d of dataObjs) {
        const evProp = findProperty(d, 'event');
        if (evProp && ts.isPropertyAssignment(evProp)) registerWrite(evProp.initializer);
      }
    }
  };

  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        READ_METHODS.has(callee.name.text) &&
        ts.isPropertyAccessExpression(callee.expression) &&
        callee.expression.name.text === 'eventLog'
      ) {
        READ_CALL_SITES_TOTAL.count++;
        const argsObj = node.arguments[0] && unwrap(node.arguments[0]);
        if (argsObj && ts.isObjectLiteralExpression(argsObj)) {
          handleEventLogReadCall(node, argsObj);
        }
      }
      handleWriteCall(node, callee);
    }
    // `<ident>.event = <value>` assignment — the admin-audit-trail shape
    // (`where` built as a local var, mutated after declaration).
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'event'
    ) {
      registerRead(node.right, node.parent && ts.isExpressionStatement(node.parent) ? node.parent : node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
};

const files = [...walk(WEB1_SRC, []), ...walk(KERNEL, [])];
for (const f of files) scanFile(f);

// ── verdict ────────────────────────────────────────────────────────────
const violations = [];
let resolvedCount = 0;
let dynamicCount = 0;
let outOfScopeCount = 0;
let allowedCount = 0;

for (const site of READ_SITES) {
  if (site.classification.kind === 'dynamic') {
    dynamicCount++;
    continue;
  }
  if (site.classification.kind === 'out-of-scope') {
    outOfScopeCount++;
    continue;
  }
  resolvedCount++;
  const missing = site.classification.values.filter(v => !WRITE_KEYS.has(v));
  if (missing.length === 0) continue;
  if (site.escaped) {
    allowedCount++;
    continue;
  }
  violations.push({
    file: site.file,
    line: site.line,
    keys: missing,
  });
}

const result = {
  root: ROOT,
  filesScanned: files.length,
  readCallSitesTotal: READ_CALL_SITES_TOTAL.count,
  readSitesWithEventFilter: READ_SITES.length,
  resolvedCount,
  dynamicCount,
  outOfScopeCount,
  allowedCount,
  writeKeysCount: WRITE_KEYS.size,
  appEventsMapLoaded,
  scheduleFileExists,
  scheduleInfoEventCount,
  violations,
  badEscapes: BAD_ESCAPES,
};

process.stdout.write(JSON.stringify(result));
process.exit(violations.length > 0 || BAD_ESCAPES.length > 0 ? 1 : 0);
