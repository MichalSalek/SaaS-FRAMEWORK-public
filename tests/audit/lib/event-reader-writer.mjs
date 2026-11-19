#!/usr/bin/env node
// event-reader-writer.mjs — AST helper for tools/d5-cross.ts (event-reader-writer).
//
// Finds every backend READ of EventLog filtered by one APP_EVENTS.INFO.<Group>.<Key>,
// and every mechanism that WRITES that value, then reports a read key nothing writes.
// A digest that queried ACCOUNT_CREATED while signup wrote USER_REGISTERED is the shape.
//
// WHY AST: prettier splits a where object across lines, and a where is often a local
// const mutated later (where.event = ...). A same-line grep sees neither. The TypeScript
// compiler API parses each file once.

// READ SITE: a call `<expr>.eventLog.<findMany|findFirst|findUnique|count|groupBy|aggregate>
// ({ where: <W>, ... })` (also `tx.eventLog...`, and a `where` built as a local
// `const where = {...}` and later mutated via `where.event = ...`, both resolved by name
// within the file) whose `where` carries an `event` property that is:
//   - a direct `APP_EVENTS.INFO.<G>.<K>` member access, OR
//   - a bare string literal, OR
//   - `{ in: [...] }` (or `{ equals: <X> }`) where every element resolves to one of the above,
//     including a local `const ARR = [APP_EVENTS..., ...]` spread in the SAME file (one level;
//     an imported array or one built via `.map()`/`.filter()` is NOT resolved: a documented
//     false negative).
// `{ notIn: ... }`, `{ contains: ... }` and similar operators name no single key, so they are
// out of scope. A `respondSuccess(res, data, APP_EVENTS.INFO...)` / `{ event: APP_EVENTS... }`
// response envelope is not a Prisma call, so it is never mistaken for a read.

// WRITE: <X> uses the same resolver as reads. A bare parameter stays dynamic, never a false write.
//   (A) recordAuditEvent_IO({ eventName: <X> })
//   (B) writeRawEventLog_IO({ eventName: <X> })
//   (C) sendTransactionalEmail(templateId, user, <X>, ...) — the 3rd arg is forwarded into (A)
//   (D) <expr>.eventLog.create / createMany data.event
//   (E) infoEvent in .shared-kernel/domain/email/email-schedule.config.ts
//       (the sweep passes eventName: rule.infoEvent, so the literal is read only there)
//   (F) audit(<X>) on an EndpointScope from defineEndpoint, bindEndpoint or defineEndpointSwitch.
//       The factory is an import that resolves to web-1/src/application/http/define-endpoint.ts
//       (alias, relative, namespace, or a same-file alias). A lookalike path does not count.
//       Forms: { audit }, { audit: alias }, scope.audit, and a const
//       alias of that binding. A type annotation on that parameter does not block it.
//       A contract auditEvents or successEvents list, an ok/created argument, a comment,
//       a string, a type-only factory import, a declared EndpointScope, or any other
//       function named audit is not a write. A broad event type is not expanded.

// VALUE RESOLUTION: an `APP_EVENTS.INFO.<G>.<K>` reference is compared by its runtime STRING
// VALUE, resolved from `.shared-kernel/domain/events/app-events.const.ts` when present and
// parsable; otherwise it falls back to the property name <K> (true for every INFO event except
// CANNOT_DELETE_MAIN_POLICY -> 'ADMIN_CANNOT_DELETE_MAIN_POLICY', which no read/write site uses).
// So app-events.const.ts is a best-effort input, not a hard anchor, and no fixture must stub it.
// A conditional (cond ? A : B) is a literal only when BOTH branches resolve; otherwise dynamic.

// ESCAPE: `event-reader-writer-allow: <reason>` as a comment on the line of the offending
// `event:`/`where.event =` or on the line directly above it (mirrors prisma-nested-sql-allow).
// A bare marker with no reason is itself reported, scanned file-wide.
//
// HONEST SCOPE: per file, one hop. An imported array, a .map()/.filter() projection, a cross-file
// constant, a factory not imported from define-endpoint, scope['audit'], and an audit call that
// lives in another function (the binding was only passed across) stay dynamic. Same-file const
// lookup keeps one initializer per name (the last declaration). A mixed conditional is dynamic.
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
const APP_EVENTS_FILE = path.join(KERNEL, 'domain/events/app-events.const.ts');
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
  if (
    !ts.isPropertyAccessExpression(infoNode) ||
    infoNode.name.text !== 'INFO'
  ) {
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
    if (
      !ts.isPropertyAssignment(groupProp) ||
      !ts.isIdentifier(groupProp.name)
    ) {
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
        PATH_TO_VALUE.set(
          `APP_EVENTS.INFO.${group}.${keyProp.name.text}`,
          valNode.text
        );
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
  if (ts.isStringLiteralLike(node))
    return { kind: 'literal', values: [node.text] };
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
  if (ts.isConditionalExpression(node)) {
    const left = classifyValue(node.whenTrue, ctx);
    const right = classifyValue(node.whenFalse, ctx);
    if (left.kind === 'literal' && right.kind === 'literal') {
      return { kind: 'literal', values: [...left.values, ...right.values] };
    }
    return { kind: 'dynamic' };
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
    } else if (
      ts.isShorthandPropertyAssignment(prop) &&
      prop.name.text === 'event'
    ) {
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

// Mechanism F. A call counts only when its callee is the EndpointScope `audit`
// of a defineEndpoint / bindEndpoint / defineEndpointSwitch handler. The factory
// must resolve to the canonical factory file. Same prefixes as WEB1_ALIASES in tools/stripe.ts.
const CANONICAL_DEFINE_ENDPOINT =
  'web-1/src/application/http/define-endpoint.ts';
const FACTORY_ALIASES = [
  ['@app/', 'web-1/src/application/'],
  ['@domain/', 'web-1/src/domain/'],
];
const FACTORY_EXPORTS = new Set([
  'defineEndpoint',
  'bindEndpoint',
  'defineEndpointSwitch',
]);

const moduleCandidates = (fromRel, specifier) => {
  const from = fromRel.split(path.sep).join('/');
  let base;
  if (specifier.startsWith('.')) {
    base = path.posix.normalize(
      path.posix.join(path.posix.dirname(from), specifier)
    );
  } else {
    for (const [prefix, dir] of FACTORY_ALIASES) {
      if (specifier.startsWith(prefix)) {
        base = path.posix.normalize(
          path.posix.join(dir, specifier.slice(prefix.length))
        );
        break;
      }
    }
  }
  if (!base || base.startsWith('..') || base.startsWith('/')) return [];
  if (/\.tsx?$/.test(base)) return [base];
  if (/\.[cm]?js$/.test(base)) {
    const stripped = base.replace(/\.[cm]?js$/, '');
    return [`${stripped}.ts`, `${stripped}.tsx`];
  }
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
};

const isCanonicalFactory = (fromRel, specifier) => {
  const selected = moduleCandidates(fromRel, specifier).find(candidate => {
    const abs = path.join(ROOT, candidate);
    return fs.existsSync(abs) && fs.statSync(abs).isFile();
  });
  return selected === CANONICAL_DEFINE_ENDPOINT;
};

const bindingNames = name => {
  const out = [];
  const walkName = node => {
    if (ts.isIdentifier(node)) {
      out.push(node.text);
      return;
    }
    if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
      for (const el of node.elements) {
        if (ts.isBindingElement(el)) walkName(el.name);
      }
    }
  };
  walkName(name);
  return out;
};

const propertyNameText = name => {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
};

const absorbAudit = (pattern, auditSet) => {
  for (const el of pattern.elements) {
    if (!ts.isBindingElement(el)) continue;
    const key = el.propertyName
      ? propertyNameText(el.propertyName)
      : ts.isIdentifier(el.name)
        ? el.name.text
        : null;
    if (key === 'audit' && ts.isIdentifier(el.name)) auditSet.add(el.name.text);
  }
};

const isScopeAuditAccess = (node, env) => {
  const value = unwrap(node);
  if (!value || !env.scope || !ts.isPropertyAccessExpression(value))
    return false;
  if (value.name.text !== 'audit') return false;
  const obj = unwrap(value.expression);
  return Boolean(obj && ts.isIdentifier(obj) && obj.text === env.scope);
};

const isHandlerNode = node =>
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node);

const isNestedFunction = node =>
  isHandlerNode(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);

const functionFromHandle = (obj, resolveFunction) => {
  for (const prop of obj.properties) {
    if (propertyNameText(prop.name) !== 'handle') continue;
    if (ts.isPropertyAssignment(prop)) return resolveFunction(prop.initializer);
    if (ts.isShorthandPropertyAssignment(prop))
      return resolveFunction(prop.name);
    if (ts.isMethodDeclaration(prop)) return prop;
  }
  return null;
};

const collectFactories = (sf, topLevelInits, fromRel) => {
  const resolved = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!stmt.importClause || stmt.importClause.isTypeOnly) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!isCanonicalFactory(fromRel, stmt.moduleSpecifier.text)) continue;
    const named = stmt.importClause.namedBindings;
    if (!named) continue;
    if (ts.isNamespaceImport(named)) {
      resolved.set(named.name.text, { kind: 'ns' });
      continue;
    }
    for (const el of named.elements) {
      if (el.isTypeOnly) continue;
      const exported = (el.propertyName || el.name).text;
      if (!FACTORY_EXPORTS.has(exported)) continue;
      resolved.set(el.name.text, { kind: 'fn', exportName: exported });
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, init] of topLevelInits) {
      if (resolved.has(name)) continue;
      if (ts.isIdentifier(init) && resolved.has(init.text)) {
        resolved.set(name, resolved.get(init.text));
        grew = true;
      } else if (
        ts.isPropertyAccessExpression(init) &&
        ts.isIdentifier(init.expression) &&
        resolved.get(init.expression.text)?.kind === 'ns' &&
        FACTORY_EXPORTS.has(init.name.text)
      ) {
        resolved.set(name, { kind: 'fn', exportName: init.name.text });
        grew = true;
      }
    }
  }
  return resolved;
};

const factoryExportOf = (callNode, factories) => {
  const callee = unwrap(callNode.expression);
  if (!callee) return null;
  if (ts.isIdentifier(callee)) {
    const info = factories.get(callee.text);
    return info && info.kind === 'fn' ? info.exportName : null;
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    factories.get(callee.expression.text)?.kind === 'ns' &&
    FACTORY_EXPORTS.has(callee.name.text)
  ) {
    return callee.name.text;
  }
  return null;
};

const scanHandlerAudit = (fn, registerWrite) => {
  if (!fn || !fn.body || !fn.parameters) return;
  const root = { audit: new Set(), scope: null };
  const param0 = fn.parameters[0];
  if (param0) {
    if (ts.isIdentifier(param0.name)) root.scope = param0.name.text;
    else if (ts.isObjectBindingPattern(param0.name)) {
      absorbAudit(param0.name, root.audit);
    }
  }

  const shadow = (env, name) => {
    env.audit.delete(name);
    if (env.scope === name) env.scope = null;
  };

  const visitScope = (node, env) => {
    if (!node) return;
    if (ts.isBlock(node)) {
      const blockEnv = { audit: new Set(env.audit), scope: env.scope };
      for (const stmt of node.statements) {
        if (
          (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
          stmt.name
        ) {
          shadow(blockEnv, stmt.name.text);
        }
      }
      for (const stmt of node.statements) visitScope(stmt, blockEnv);
      return;
    }
    if (node !== fn && isNestedFunction(node)) {
      const child = { audit: new Set(env.audit), scope: env.scope };
      for (const param of node.parameters || []) {
        for (const name of bindingNames(param.name)) shadow(child, name);
      }
      if (node.body) visitScope(node.body, child);
      return;
    }
    if (
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForStatement(node)
    ) {
      if (ts.isForStatement(node)) {
        if (node.condition) visitScope(node.condition, env);
        if (node.incrementor) visitScope(node.incrementor, env);
      } else if (node.expression) {
        visitScope(node.expression, env);
      }
      const child = { audit: new Set(env.audit), scope: env.scope };
      const init = node.initializer;
      if (init && ts.isVariableDeclarationList(init)) {
        for (const decl of init.declarations) {
          if (decl.initializer) visitScope(decl.initializer, env);
          for (const name of bindingNames(decl.name)) shadow(child, name);
        }
      } else if (init) {
        visitScope(init, env);
      }
      visitScope(node.statement, child);
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      const init = node.initializer && unwrap(node.initializer);
      const aliasesAudit = Boolean(
        init &&
        ((ts.isIdentifier(init) && env.audit.has(init.text)) ||
          isScopeAuditAccess(init, env))
      );
      if (ts.isIdentifier(node.name)) {
        const name = node.name.text;
        if (init && isHandlerNode(init)) {
          const child = { audit: new Set(env.audit), scope: env.scope };
          if (!aliasesAudit) shadow(child, name);
          if (init.body) visitScope(init.body, child);
        } else if (node.initializer) {
          visitScope(node.initializer, env);
        }
        if (aliasesAudit) env.audit.add(name);
        else shadow(env, name);
        return;
      }
      if (node.initializer) visitScope(node.initializer, env);
      for (const name of bindingNames(node.name)) shadow(env, name);
      if (
        init &&
        ts.isIdentifier(init) &&
        env.scope &&
        init.text === env.scope &&
        ts.isObjectBindingPattern(node.name)
      ) {
        absorbAudit(node.name, env.audit);
      }
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      visitScope(node.right, env);
      shadow(env, node.left.text);
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (
        (callee && ts.isIdentifier(callee) && env.audit.has(callee.text)) ||
        isScopeAuditAccess(callee, env)
      ) {
        const arg = node.arguments[0];
        if (arg) registerWrite(arg);
      }
    }
    ts.forEachChild(node, child => visitScope(child, env));
  };

  visitScope(fn.body, root);
};

// ── main per-file scan ─────────────────────────────────────────────────
const READ_SITES = [];
const READ_CALL_SITES_TOTAL = { count: 0 };
const BAD_ESCAPES = [];

const scanFile = filePath => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const rawLines = raw.split('\n');
  let sf;
  try {
    sf = ts.createSourceFile(
      filePath,
      raw,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
  } catch {
    return; // unparsable file: skip rather than crash the whole scan
  }

  // Escape markers live in comments. A string that echoes the marker is not a
  // waiver and not a bare-marker finding (the read/write walk below stays on
  // the AST, so a key that appears only in a comment or a string is neither).
  const commentMask = new Uint8Array(raw.length);
  const trivia = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    raw
  );
  let triviaToken = trivia.scan();
  while (triviaToken !== ts.SyntaxKind.EndOfFileToken) {
    if (
      triviaToken === ts.SyntaxKind.SingleLineCommentTrivia ||
      triviaToken === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      commentMask.fill(1, trivia.getTokenStart(), trivia.getTokenEnd());
    }
    triviaToken = trivia.scan();
  }
  const lineStarts = [0];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\n') lineStarts.push(i + 1);
  }
  const escapeLines = new Set();
  rawLines.forEach((line, idx) => {
    const col = line.indexOf('event-reader-writer-allow:');
    if (col < 0) return;
    if (!commentMask[lineStarts[idx] + col]) return;
    const m = line.slice(col).match(/event-reader-writer-allow:\s*(\S.*)?$/);
    if (!m) return;
    if (m[1] && m[1].trim().length > 0) {
      escapeLines.add(idx + 1);
    } else {
      BAD_ESCAPES.push(
        `${filePath}:${idx + 1}: event-reader-writer-allow: bez powodu`
      );
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
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      localConsts.set(node.name.text, unwrap(node.initializer));
    }
    ts.forEachChild(node, collectDecls);
  };
  collectDecls(sf);
  const ctx = {
    resolveIdentifierInit: name =>
      localConsts.has(name) ? localConsts.get(name) : null,
  };
  const topLevelInits = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.initializer &&
        !topLevelInits.has(decl.name.text)
      ) {
        topLevelInits.set(decl.name.text, unwrap(decl.initializer));
      }
    }
  }
  const functionDecls = new Map();
  const collectFns = node => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      !functionDecls.has(node.name.text)
    ) {
      functionDecls.set(node.name.text, node);
    }
    ts.forEachChild(node, collectFns);
  };
  collectFns(sf);
  const fromRel = path.relative(ROOT, filePath).split(path.sep).join('/');
  const factories = collectFactories(sf, topLevelInits, fromRel);
  const lookupValue = name =>
    topLevelInits.has(name)
      ? topLevelInits.get(name)
      : ctx.resolveIdentifierInit(name);
  const resolveFunction = raw => {
    let node = unwrap(raw);
    const seen = new Set();
    while (node && ts.isIdentifier(node) && !seen.has(node.text)) {
      seen.add(node.text);
      const next = lookupValue(node.text);
      if (next) {
        node = unwrap(next);
        continue;
      }
      return functionDecls.get(node.text) || null;
    }
    return node && isHandlerNode(node) ? node : null;
  };
  const resolveObject = raw => {
    if (!raw) return null;
    let node = unwrap(raw);
    const seen = new Set();
    while (node && ts.isIdentifier(node) && !seen.has(node.text)) {
      seen.add(node.text);
      const next = lookupValue(node.text);
      if (!next) return null;
      node = unwrap(next);
    }
    return node && ts.isObjectLiteralExpression(node) ? node : null;
  };
  const resolveArrayExpr = raw => {
    if (!raw) return null;
    let node = unwrap(raw);
    const seen = new Set();
    while (node && ts.isIdentifier(node) && !seen.has(node.text)) {
      seen.add(node.text);
      const next = lookupValue(node.text);
      if (!next) return null;
      node = unwrap(next);
    }
    return node && ts.isArrayLiteralExpression(node) ? node : null;
  };
  const handlersOf = (callNode, exportName) => {
    if (exportName === 'defineEndpoint') {
      const config = resolveObject(callNode.arguments[1]);
      const fn = config && functionFromHandle(config, resolveFunction);
      return fn ? [fn] : [];
    }
    if (exportName === 'bindEndpoint') {
      const arg = callNode.arguments[1];
      const fn = arg ? resolveFunction(arg) : null;
      return fn ? [fn] : [];
    }
    if (exportName === 'defineEndpointSwitch') {
      const arr = resolveArrayExpr(callNode.arguments[0]);
      if (!arr) return [];
      const fns = [];
      for (const el of arr.elements) {
        if (ts.isSpreadElement(el)) continue;
        const obj = resolveObject(el);
        const fn = obj && functionFromHandle(obj, resolveFunction);
        if (fn) fns.push(fn);
      }
      return fns;
    }
    return [];
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
      (callee.text === 'recordAuditEvent_IO' ||
        callee.text === 'writeRawEventLog_IO')
    ) {
      const argsObj = callNode.arguments[0] && unwrap(callNode.arguments[0]);
      if (argsObj && ts.isObjectLiteralExpression(argsObj)) {
        const prop = findProperty(argsObj, 'eventName');
        if (prop) {
          const valueNode = ts.isPropertyAssignment(prop)
            ? prop.initializer
            : prop.name;
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
        if (evProp && ts.isPropertyAssignment(evProp))
          registerWrite(evProp.initializer);
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
      const exportName = factoryExportOf(node, factories);
      if (exportName) {
        for (const fn of handlersOf(node, exportName)) {
          scanHandlerAudit(fn, registerWrite);
        }
      }
    }
    // `<ident>.event = <value>` assignment — the admin-audit-trail shape
    // (`where` built as a local var, mutated after declaration).
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'event'
    ) {
      registerRead(
        node.right,
        node.parent && ts.isExpressionStatement(node.parent)
          ? node.parent
          : node
      );
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
