

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  assertPaths,
  lineAt,
  newCheck,
  parseTs,
  projectRoot,
  readText,
  report,
  walk,
  type CheckResult,
  type MutableCheck,
} from './_lib';
import {
  commentsByLine,
  importBindings,
  isTestOrDecl,
  markerIn,
  nodeLine,
  propName,
  resolveModule,
  unwrapExpr,
  type AliasMap,
} from './_ts';

export const WEB1_SRC = 'web-1/src';
export const WEBHOOKS = 'web-1/src/application/stripe/webhooks';
export const ROUTER = `${WEBHOOKS}/stripe-event-router.ts`;
export const HANDLERS = `${WEBHOOKS}/handlers`;
export const UI_MODE_ROOTS = [
  'web-1/src',
  'main/src',
  '.shared-kernel',
] as const;
/** web-1 tsconfig `paths` (the READONLY kernel copy is not followed: it holds no Stripe calls). */
export const WEB1_ALIASES: AliasMap = [
  ['@app/', 'web-1/src/application/'],
  ['@domain/', 'web-1/src/domain/'],
];

/** Floors, measured 2026-10-23 on the real tree. */
export const FLOORS = {
  /** routeStripeEvent call sites (measured 2: webhook + janitor). */
  claimFirst: 2,
  /** Stripe-reaching call sites on the in-tx path, escaped included (measured 6). */
  noApiInTx: 4,
  /** Stripe list/search call sites (measured 4). */
  scope: 3,
  /** `ui_mode` occurrences, code and comments (measured 10). */
  uiMode: 5,
} as const;

interface Parsed {
  readonly rel: string;
  readonly text: string;
  readonly sf: ts.SourceFile;
}

const SKIP = /(^|\/)(READONLY-shared-kernel|js-client|generated)(\/|$)/;

function sourceFiles(
  root: string,
  relDir: string,
  withTests: boolean
): string[] {
  return walk(
    root,
    relDir,
    rel =>
      /\.tsx?$/.test(rel) &&
      !SKIP.test(rel) &&
      (withTests || !isTestOrDecl(rel)) &&
      !rel.endsWith('.d.ts')
  );
}

function parse(root: string, rel: string): Parsed {
  const text = readText(root, rel);
  return { rel, text, sf: parseTs(rel, text) };
}

function forEachNode(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, child => forEachNode(child, visit));
}

/**
 * Name of a call's callee: `f(...)` → `f`, and a property call `x.f(...)` / `x?.f(...)` → `f`
 * (equivalence review: `adapter.getStripe()` and `router.routeStripeEvent()` were invisible).
 * A property call resolves to a helper only through a namespace import (`calleeObject`).
 */
function calleeName(call: ts.CallExpression): string | undefined {
  const callee = unwrapExpr(call.expression);
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  return undefined;
}

/** `ns` of a property call `ns.f(...)` when `ns` is a plain identifier, else undefined. */
function calleeObject(call: ts.CallExpression): string | undefined {
  const callee = unwrapExpr(call.expression);
  if (ts.isPropertyAccessExpression(callee)) {
    const object = unwrapExpr(callee.expression);
    return ts.isIdentifier(object) ? object.text : undefined;
  }
  return undefined;
}

/** Original exported name a local identifier refers to (alias imports resolved by name only). */
function originalName(
  local: string,
  imports: Map<string, { imported: string }>
): string {
  return imports.get(local)?.imported ?? local;
}

function isTransactionCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = unwrapExpr(node.expression);
  return (
    ts.isPropertyAccessExpression(callee) && callee.name.text === '$transaction'
  );
}

function txCallback(
  call: ts.CallExpression
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  const arg = call.arguments[0];
  if (arg === undefined) {
    return undefined;
  }
  const fn = unwrapExpr(arg);
  return ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) ? fn : undefined;
}

// ── 1. claim-first ─────────────────────────────────────────────────────────────────────────

function isClaimStatement(
  stmt: ts.Statement | undefined,
  imports: Map<string, { imported: string }>
): boolean {
  if (stmt === undefined || !ts.isExpressionStatement(stmt)) {
    return false;
  }
  let expr = unwrapExpr(stmt.expression);
  if (ts.isAwaitExpression(expr)) {
    expr = unwrapExpr(expr.expression);
  }
  if (!ts.isCallExpression(expr)) {
    return false;
  }
  const name = calleeName(expr);
  return (
    name !== undefined &&
    originalName(name, imports) === 'claimEventForProcessingTx'
  );
}

export function checkClaimFirst(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'stripe:claim-first',
    FLOORS.claimFirst,
    'routeStripeEvent call sites'
  );
  assertPaths(check, root, [WEB1_SRC, ROUTER]);
  if (check.errors.length > 0) {
    return check;
  }
  for (const rel of sourceFiles(root, WEB1_SRC, false)) {
    if (rel === ROUTER) {
      continue; // DEFINES routeStripeEvent and opens no transaction of its own.
    }
    const file = parse(root, rel);
    if (!file.text.includes('routeStripeEvent')) {
      continue;
    }
    const imports = importBindings(file.sf);
    const comments = commentsByLine(rel, file.text);
    forEachNode(file.sf, node => {
      if (!ts.isCallExpression(node)) {
        return;
      }
      const name = calleeName(node);
      if (
        name === undefined ||
        originalName(name, imports) !== 'routeStripeEvent'
      ) {
        return;
      }
      check.sites++;
      const line = nodeLine(file.sf, node);
      const escape = markerIn(comments, 'claim-first-allow', line, line);
      if (escape === 'reason') {
        return;
      }
      if (escape === 'bare') {
        check.findings.push({
          file: rel,
          line,
          message: 'claim-first-allow without a reason',
        });
        return;
      }
      let fn: ts.Node | undefined = node.parent;
      while (fn !== undefined && !ts.isFunctionLike(fn)) {
        fn = fn.parent;
      }
      const tx = fn?.parent;
      const callback =
        tx !== undefined && isTransactionCall(tx) ? txCallback(tx) : undefined;
      if (callback === undefined || callback !== fn) {
        check.findings.push({
          file: rel,
          line,
          message:
            'routeStripeEvent outside a $transaction callback (no row-claim can precede it)',
        });
        return;
      }
      const first = ts.isBlock(callback.body)
        ? callback.body.statements[0]
        : undefined;
      if (!isClaimStatement(first, imports)) {
        check.findings.push({
          file: rel,
          line,
          message:
            'the $transaction callback does not start with claimEventForProcessingTx(...): claim the StripeEvent row FIRST',
        });
      }
    });
  }
  return check;
}

// ── 2. no-api-in-tx ────────────────────────────────────────────────────────────────────────

interface Unit {
  readonly key: string;
  readonly file: Parsed;
  readonly body: ts.Node;
}

const ESCAPE_D2F1 = 'd2f1-allow';
const D2F1_WINDOW = 3;

/** Top-level functions of a file: `function f`, `const f = () =>` / `function () {}`. */
function topLevelUnits(file: Parsed): Map<string, Unit> {
  const out = new Map<string, Unit>();
  for (const stmt of file.sf.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name !== undefined &&
      stmt.body !== undefined
    ) {
      out.set(stmt.name.text, {
        key: `${file.rel}#${stmt.name.text}`,
        file,
        body: stmt.body,
      });
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) {
          continue;
        }
        const init = unwrapExpr(decl.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          out.set(decl.name.text, {
            key: `${file.rel}#${decl.name.text}`,
            file,
            body: init.body,
          });
        }
      }
    }
  }
  return out;
}

/** Local export name → local binding name (`export { a as b }` maps b → a). */
function exportNames(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const stmt of sf.statements) {
    const exported = ts.canHaveModifiers(stmt)
      ? (ts.getModifiers(stmt) ?? []).some(
          m => m.kind === ts.SyntaxKind.ExportKeyword
        )
      : false;
    if (exported && ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) {
      out.set(stmt.name.text, stmt.name.text);
    }
    if (exported && ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          out.set(decl.name.text, decl.name.text);
        }
      }
    }
    if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier === undefined &&
      stmt.exportClause !== undefined &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) {
        out.set(el.name.text, (el.propertyName ?? el.name).text);
      }
    }
  }
  return out;
}

interface Graph {
  readonly files: Map<string, Parsed>;
  readonly units: Map<string, Map<string, Unit>>;
  readonly exports: Map<string, Map<string, string>>;
  readonly imports: Map<
    string,
    Map<string, { specifier: string; imported: string; target?: string }>
  >;
  readonly comments: Map<string, Map<number, string>>;
  /** `import * as ns from '…'`: local namespace → resolved file. */
  readonly namespaces: Map<string, Map<string, string>>;
  /** `export { a as b } from '…'` / `export * from '…'`: re-exports per file. */
  readonly reExports: Map<string, ReExport[]>;
}

interface ReExport {
  readonly target: string;
  /** exported name → name in the target; undefined = `export *`. */
  readonly names: Map<string, string> | undefined;
}

export function buildGraph(root: string): Graph {
  const graph: Graph = {
    files: new Map(),
    units: new Map(),
    exports: new Map(),
    imports: new Map(),
    comments: new Map(),
    namespaces: new Map(),
    reExports: new Map(),
  };
  for (const rel of sourceFiles(root, WEB1_SRC, false)) {
    const file = parse(root, rel);
    graph.files.set(rel, file);
    graph.units.set(rel, topLevelUnits(file));
    graph.exports.set(rel, exportNames(file.sf));
    const imports = new Map<
      string,
      { specifier: string; imported: string; target?: string }
    >();
    for (const [local, binding] of importBindings(file.sf)) {
      const target = resolveModule(root, rel, binding.specifier, WEB1_ALIASES);
      imports.set(
        local,
        target === undefined ? binding : { ...binding, target }
      );
    }
    graph.imports.set(rel, imports);
    graph.comments.set(rel, commentsByLine(rel, file.text));
    const namespaces = new Map<string, string>();
    const reExports: ReExport[] = [];
    for (const stmt of file.sf.statements) {
      if (
        ts.isImportDeclaration(stmt) &&
        ts.isStringLiteral(stmt.moduleSpecifier) &&
        stmt.importClause?.namedBindings !== undefined &&
        ts.isNamespaceImport(stmt.importClause.namedBindings)
      ) {
        const target = resolveModule(
          root,
          rel,
          stmt.moduleSpecifier.text,
          WEB1_ALIASES
        );
        if (target !== undefined) {
          namespaces.set(stmt.importClause.namedBindings.name.text, target);
        }
      }
      if (
        ts.isExportDeclaration(stmt) &&
        stmt.moduleSpecifier !== undefined &&
        ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        const target = resolveModule(
          root,
          rel,
          stmt.moduleSpecifier.text,
          WEB1_ALIASES
        );
        if (target === undefined) {
          continue;
        }
        if (stmt.exportClause === undefined) {
          reExports.push({ target, names: undefined });
        } else if (ts.isNamedExports(stmt.exportClause)) {
          reExports.push({
            target,
            names: new Map(
              stmt.exportClause.elements.map(el => [
                el.name.text,
                (el.propertyName ?? el.name).text,
              ])
            ),
          });
        }
      }
    }
    graph.namespaces.set(rel, namespaces);
    graph.reExports.set(rel, reExports);
  }
  return graph;
}

/** Unit key of export `name` of `rel`, following re-exports (`export … from`, `export *`). */
function resolveExport(
  graph: Graph,
  rel: string,
  name: string,
  seen: Set<string> = new Set()
): string | undefined {
  const visit = `${rel}#${name}`;
  if (seen.has(visit)) {
    return undefined;
  }
  seen.add(visit);
  const binding = graph.exports.get(rel)?.get(name);
  if (binding !== undefined) {
    return graph.units.get(rel)?.get(binding)?.key;
  }
  for (const reExport of graph.reExports.get(rel) ?? []) {
    if (reExport.names === undefined) {
      const found = resolveExport(graph, reExport.target, name, seen);
      if (found !== undefined) {
        return found;
      }
    } else {
      const inner = reExport.names.get(name);
      if (inner !== undefined) {
        return resolveExport(graph, reExport.target, inner, seen);
      }
    }
  }
  return undefined;
}

/**
 * Unit key a call resolves to: a same-file top-level function, an imported web-1 helper (named
 * import or through a namespace `ns.f()`), with re-exports followed. A property call on anything
 * other than a namespace import resolves to nothing (it is a method, not a helper).
 */
function resolveCall(
  graph: Graph,
  rel: string,
  call: ts.CallExpression
): string | undefined {
  const name = calleeName(call);
  if (name === undefined) {
    return undefined;
  }
  const object = calleeObject(call);
  if (object !== undefined) {
    const target = graph.namespaces.get(rel)?.get(object);
    return target === undefined
      ? undefined
      : resolveExport(graph, target, name);
  }
  if (!ts.isIdentifier(unwrapExpr(call.expression))) {
    return undefined;
  }
  const local = graph.units.get(rel)?.get(name);
  const imported = graph.imports.get(rel)?.get(name);
  if (imported === undefined) {
    return local?.key;
  }
  if (imported.target === undefined) {
    return undefined;
  }
  return resolveExport(graph, imported.target, imported.imported);
}

function isGetStripe(graph: Graph, rel: string, name: string): boolean {
  return (
    originalName(name, graph.imports.get(rel) ?? new Map()) === 'getStripe'
  );
}

function escapeAt(
  graph: Graph,
  file: Parsed,
  call: ts.CallExpression
): ReturnType<typeof markerIn> {
  const line = nodeLine(file.sf, call);
  return markerIn(
    graph.comments.get(file.rel) ?? new Map(),
    ESCAPE_D2F1,
    line - D2F1_WINDOW,
    line
  );
}

const inScope = (rel: string): boolean =>
  rel === ROUTER || rel.startsWith(`${HANDLERS}/`);

/**
 * Fixed point: helpers OUTSIDE the in-transaction scope (router + handlers/) that call getStripe()
 * or a tainted helper. Units inside the scope are never taint sources: every call in those files
 * is inspected on its own line, so a documented in-scope call (`d2f1-allow`) is judged once, where
 * it is, exactly as the retired script judged handler files.
 */
export function taintedUnits(graph: Graph): Set<string> {
  const tainted = new Set<string>();
  const allUnits = [...graph.units.values()]
    .flatMap(m => [...m.values()])
    .filter(unit => !inScope(unit.file.rel));
  for (let grew = true; grew;) {
    grew = false;
    for (const unit of allUnits) {
      if (tainted.has(unit.key)) {
        continue;
      }
      let hit = false;
      forEachNode(unit.body, node => {
        if (hit || !ts.isCallExpression(node)) {
          return;
        }
        const name = calleeName(node);
        if (name === undefined) {
          return;
        }
        const target = resolveCall(graph, unit.file.rel, node);
        const reaches =
          isGetStripe(graph, unit.file.rel, name) ||
          (target !== undefined && tainted.has(target));
        // DECISION: an escape silences only ITS line. A helper outside the
        // scope that reaches Stripe stays tainted even when that call is escaped, so each caller on
        // the in-transaction path is judged (and escaped) on its own, as the retired script did;
        // one marker deep in a helper must not hide every future caller.
        if (reaches) {
          hit = true;
        }
      });
      if (hit) {
        tainted.add(unit.key);
        grew = true;
      }
    }
  }
  return tainted;
}

export function checkNoApiInTx(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'stripe:no-api-in-tx',
    FLOORS.noApiInTx,
    'Stripe-reaching call sites on the in-tx path'
  );
  assertPaths(check, root, [WEB1_SRC, ROUTER, HANDLERS]);
  if (check.errors.length > 0) {
    return check;
  }
  const graph = buildGraph(root);
  const tainted = taintedUnits(graph);
  const seen = new Set<ts.CallExpression>();

  /** Inspects the calls under `scope`; same-file helper calls only when `sameFile` is set. */
  const inspect = (file: Parsed, scope: ts.Node, sameFile: boolean): void => {
    forEachNode(scope, node => {
      if (!ts.isCallExpression(node) || seen.has(node)) {
        return;
      }
      const name = calleeName(node);
      if (name === undefined) {
        return;
      }
      const direct = isGetStripe(graph, file.rel, name);
      const target = resolveCall(graph, file.rel, node);
      const viaHelper =
        target !== undefined &&
        tainted.has(target) &&
        (sameFile || !target.startsWith(`${file.rel}#`));
      if (!direct && !viaHelper) {
        return;
      }
      seen.add(node);
      check.sites++;
      const escape = escapeAt(graph, file, node);
      if (escape === 'reason') {
        return;
      }
      const line = nodeLine(file.sf, node);
      check.findings.push({
        file: file.rel,
        line,
        message:
          escape === 'bare'
            ? `${ESCAPE_D2F1} without a reason`
            : direct
              ? 'getStripe() on the in-transaction webhook path: resolve it in prefetchStripeEventContext'
              : `${name}() reaches the Stripe API (${target ?? '?'}) on the in-transaction webhook path`,
      });
    });
  };

  const scopeFiles = [...graph.files.keys()].filter(inScope);
  for (const rel of scopeFiles) {
    const file = graph.files.get(rel);
    if (file !== undefined) {
      // A same-file helper's own getStripe() is the reported site; its callers are not re-reported.
      inspect(file, file.sf, false);
    }
  }
  // Every $transaction callback that routes a Stripe event, wherever it lives.
  for (const file of graph.files.values()) {
    if (!file.text.includes('routeStripeEvent')) {
      continue;
    }
    const imports = graph.imports.get(file.rel) ?? new Map();
    forEachNode(file.sf, node => {
      if (!isTransactionCall(node)) {
        return;
      }
      const callback = txCallback(node);
      if (callback === undefined) {
        return;
      }
      let routes = false;
      forEachNode(callback, inner => {
        if (ts.isCallExpression(inner)) {
          const name = calleeName(inner);
          routes ||=
            name !== undefined &&
            originalName(name, imports) === 'routeStripeEvent';
        }
      });
      if (routes) {
        inspect(file, callback, true);
      }
    });
  }
  if (tainted.size === 0) {
    check.errors.push(
      'no helper in web-1/src reaches getStripe(): the call graph is not being read'
    );
  }
  return check;
}

// ── 3. scope ───────────────────────────────────────────────────────────────────────────────

const LIST_CALLS: Record<string, readonly string[]> = {
  prices: ['list'],
  products: ['list'],
  subscriptions: ['list', 'search'],
};

function isStripeListCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = unwrapExpr(node.expression);
  if (!ts.isPropertyAccessExpression(callee)) {
    return false;
  }
  const owner = unwrapExpr(callee.expression);
  const resource = ts.isPropertyAccessExpression(owner)
    ? owner.name.text
    : undefined;
  return (
    resource !== undefined &&
    (LIST_CALLS[resource] ?? []).includes(callee.name.text)
  );
}

/** `isScopedToNailfolio` referenced in code outside an import declaration. */
function usesScopeHelper(sf: ts.SourceFile): boolean {
  let used = false;
  forEachNode(sf, node => {
    if (used || !ts.isIdentifier(node) || node.text !== 'isScopedToNailfolio') {
      return;
    }
    let p: ts.Node | undefined = node.parent;
    while (
      p !== undefined &&
      !ts.isImportDeclaration(p) &&
      !ts.isSourceFile(p)
    ) {
      p = p.parent;
    }
    if (p === undefined || !ts.isImportDeclaration(p)) {
      used = true;
    }
  });
  return used;
}

export function checkScope(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'stripe:scope',
    FLOORS.scope,
    'Stripe list/search call sites'
  );
  assertPaths(check, root, [WEB1_SRC]);
  if (check.errors.length > 0) {
    return check;
  }
  for (const rel of sourceFiles(root, WEB1_SRC, false)) {
    const file = parse(root, rel);
    if (!/\.(prices|products|subscriptions)\b/.test(file.text)) {
      continue;
    }
    const calls: ts.Node[] = [];
    forEachNode(file.sf, node => {
      if (isStripeListCall(node)) {
        calls.push(node);
      }
    });
    if (calls.length === 0) {
      continue;
    }
    check.sites += calls.length;
    const comments = commentsByLine(rel, file.text);
    const escape = markerIn(
      comments,
      'stripe-scope-allow',
      1,
      lineAt(file.text, file.text.length)
    );
    const line = nodeLine(file.sf, calls[0] as ts.Node);
    if (escape === 'bare') {
      check.findings.push({
        file: rel,
        line,
        message:
          'stripe-scope-allow without a reason: say why the list is scoped by construction',
      });
    } else if (escape !== 'reason' && !usesScopeHelper(file.sf)) {
      check.findings.push({
        file: rel,
        line,
        message:
          'UNSCOPED Stripe list-query: filter with isScopedToNailfolio',
      });
    }
  }
  return check;
}

// ── 4. ui-mode ─────────────────────────────────────────────────────────────────────────────

const UI_MODE_TEXT = /ui_mode['"]?\s*[:=]\s*['"]([^'"]*)['"]/g;

export function checkUiMode(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'stripe:ui-mode',
    FLOORS.uiMode,
    'ui_mode occurrences'
  );
  assertPaths(check, root, [...UI_MODE_ROOTS]);
  if (check.errors.length > 0) {
    return check;
  }
  for (const dir of UI_MODE_ROOTS) {
    for (const rel of sourceFiles(root, dir, true)) {
      const file = parse(root, rel);
      if (!file.text.includes('ui_mode')) {
        continue;
      }
      check.sites += file.text.split('ui_mode').length - 1;
      const reported = new Set<number>();
      // Text pass (code AND comments): `ui_mode: '<x>'` / `ui_mode='<x>'` with x != custom.
      for (const m of file.text.matchAll(UI_MODE_TEXT)) {
        if (m[1] !== 'custom') {
          const line = lineAt(file.text, m.index);
          reported.add(line);
          check.findings.push({
            file: rel,
            line,
            message: `ui_mode '${m[1] ?? ''}' (use 'custom')`,
          });
        }
      }
      // AST pass: a `ui_mode` property whose value is not the literal 'custom' (variables included).
      forEachNode(file.sf, node => {
        if (
          !ts.isPropertyAssignment(node) ||
          propName(node.name) !== 'ui_mode'
        ) {
          return;
        }
        const value = unwrapExpr(node.initializer);
        const ok =
          (ts.isStringLiteral(value) ||
            ts.isNoSubstitutionTemplateLiteral(value)) &&
          value.text === 'custom';
        const line = nodeLine(file.sf, node);
        if (!ok && !reported.has(line)) {
          check.findings.push({
            file: rel,
            line,
            message: "ui_mode must be the literal 'custom'",
          });
        }
      });
    }
  }
  return check;
}

export function run(root: string): CheckResult[] {
  return [
    checkClaimFirst(root),
    checkNoApiInTx(root),
    checkScope(root),
    checkUiMode(root),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? path.sep).href) {
  process.exit(report('stripe', run(projectRoot())));
}
