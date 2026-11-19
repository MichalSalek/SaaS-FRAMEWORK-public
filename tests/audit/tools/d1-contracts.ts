// D1 contract gates. Successor of the fourteen shell audits (ssot-routes, ssot-events,
// handler-method-consistency, registry-orphan, endpoint-completeness, dto-completeness's
// op-key half, validation-coverage, noop-validation-allowlist, response-event-validation,
// event-log-registration, permissions, respond-arg-order, rate-limit-tier, auth-route-method).
// Prisma model DTO regen lives in generated-fresh.ts. Discovery walks handlers, registries
// and raw protocols; a list of 206 contracts is not coverage.
//
// DECISION: a defineEndpoint/bindEndpoint call counts only when the callee is a value import
// that resolves to web-1/src/application/http/define-endpoint.ts (alias, namespace, relative,
// or a same-file const alias). A comment, a string, a lookalike module, or a local
// `declare function defineEndpoint` is not a binding, so it cannot hide an uncontracted route.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  boundResponderEmissions,
  callFactory,
  contractKeyFrom,
  factoryCallees,
  type FactoryKind,
} from './endpoint-bind';
import {
  assertPaths,
  newCheck,
  parseTs,
  projectRoot,
  readText,
  report,
  walk,
  type CheckResult,
  type MutableCheck,
} from './_lib';
import { WEB1_ALIASES } from './stripe';
import { forEachResponderCall } from './respond-calls';
import {
  importBindings,
  nodeLine,
  propName,
  resolveModule,
  unwrapExpr,
} from './_ts';

/**
 * Presence floors (measured 2026-10-23 on the real tree, then lowered). contracts 206 → 180;
 * API files 220 → 180; method keys 212 → 180; INFO events 370 → 100; respond calls 147 → 40;
 * asymmetric respond calls 25 → 1; audit events 176 → 20; CQRS events with a DTO 213 → 180;
 * sensitive operations 28 → 5. A scan that sees a handful of sites fails closed.
 */
export const FLOORS = {
  contracts: 180,
  apiFiles: 180,
  methodKeys: 180,
  infoEvents: 100,
  respondCalls: 40,
  asymmetricCalls: 1,
  auditEvents: 20,
  dtoEvents: 180,
  sensitive: 5,
} as const;

/** Better Auth catch-all. Not a JSON contract and not in RAW_PROTOCOLS. */
export const AUTH_CATCHALL = 'auth/[...all].ts';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const VERBS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

/**
 * Write-method no-op files. Shrinks when a handler grows a real parser. A path that is no
 * longer a write no-op fails as stale; a new write no-op that is not listed fails.
 * Raw protocols carry their own reason and are not listed here.
 */
/**
 * Write-method no-op files. Measured 2026-10-23: every shell-era entry is now a contract
 * (a real zod body) or a raw protocol, so the list is empty. A new write no-op fails until
 * it is named here with a reason. A named path that is no longer a write no-op fails stale.
 */
export const WRITE_NOOP_ALLOWLIST: Readonly<Record<string, string>> = {};

/** Sensitive-by-name handlers that stay on the default tier (RBAC or session is the control). */
export const SENSITIVE_BASELINE = new Set([
  'web-1/src/pages/api/v1/admin/announcements/delete/index.ts',
  'web-1/src/pages/api/v1/admin/delete-color/index.ts',
  'web-1/src/pages/api/v1/admin/delete-policy/index.ts',
  'web-1/src/pages/api/v1/admin/delete-trait/index.ts',
  'web-1/src/pages/api/v1/admin/deleted-user/purge/index.ts',
  'web-1/src/pages/api/v1/admin/user/delete/any/index.ts',
  'web-1/src/pages/api/v1/gallery/delete-asset-from-vendor/index.ts',
  'web-1/src/pages/api/v1/gallery/delete-record/index.ts',
  'web-1/src/pages/api/v1/pairing/get-access-status/index.ts',
  'web-1/src/pages/api/v1/pairing/get-my-pairs/index.ts',
  'web-1/src/pages/api/v1/pairing/revoke-access/index.ts',
  'web-1/src/pages/api/v1/pairing/revoke-all-sessions/index.ts',
  'web-1/src/pages/api/v1/pairing/revoke-session/index.ts',
  'web-1/src/pages/api/v1/session/delete/all/index.ts',
  'web-1/src/pages/api/v1/session/delete/exactly/index.ts',
  'web-1/src/pages/api/v1/user/delete/self/index.ts',
]);

export const SENSITIVE_KEYWORDS =
  /LOGIN|DELETE|RECOVER|PAIRING|EMAIL_CHANGE|EXPORT/;

/**
 * Admin-only CQRS events (no explicit grant; the MASTER_ADMIN wildcard covers them).
 * The baseline includes the privileged announcement broadcast command. It has no grant outside
 * the MASTER_ADMIN wildcard. A higher count still fails.
 * Test: d1-contracts.test.ts (one above the baseline fails; the baseline passes).
 */
export const ADMIN_ONLY_BASELINE = 63;

const GRANT_LAYERS: Readonly<Record<string, readonly string[]>> = {
  PUBLIC: ['PUBLIC'],
  PUBLIC_NO_GRANT: [],
  LOGGED_IN: ['LOGGED_IN'],
  STYLIST: ['STYLIST'],
  CLIENT: ['CLIENT'],
  STYLIST_AND_CLIENT: ['STYLIST', 'CLIENT'],
  ADMIN: [],
};

const LAYER_CONST: Readonly<Record<string, string>> = {
  PUBLIC: 'BASE_PERMISSIONS',
  LOGGED_IN: 'LOGGED_USER_PERMISSIONS',
  STYLIST: 'STYLIST_SPECIFIC_PERMISSIONS',
  CLIENT: 'CLIENT_SPECIFIC_PERMISSIONS',
};

const ANCHORS = [
  '.shared-kernel/domain/events/app-events.const.ts',
  '.shared-kernel/domain/routing/routing.config.ts',
  '.shared-kernel/domain/http/http-methods.config.ts',
  '.shared-kernel/domain/http/http.config.ts',
  '.shared-kernel/application/role-permissions.ts',
  '.shared-kernel/domain/commands-and-queries/cqrs.config.ts',
  '.shared-kernel/domain/event-log/event_log.config.ts',
  '.shared-kernel/domain/email/email-schedule.config.ts',
  '.shared-kernel/application/contracts/raw-protocols.ts',
  '.shared-kernel/application/contracts/api-contracts.registry.ts',
  'main/src/application/http/http.endpoints.ts',
  'web-1/src/application/http/rate-limit.middleware.ts',
  'web-1/src/application/permissions/permissions.seed.ts',
  'web-1/src/pages/api',
];

interface ContractDecl {
  readonly key: string;
  readonly exportName: string;
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly method: string;
  readonly path: string;
  readonly access: string;
  readonly authCheck: boolean | undefined;
  readonly limiterTier: string;
  readonly group: string;
  readonly successEvents: readonly string[];
  readonly auditEvents: readonly string[];
  readonly bodyNull: boolean;
  readonly queryNull: boolean;
  readonly hasBody: boolean;
  readonly hasQuerySchema: boolean;
}

interface Binding {
  readonly key: string;
  readonly kind: FactoryKind;
  readonly file: string;
  readonly line: number;
}

interface ApiFile {
  readonly rel: string;
  readonly routePath: string;
  readonly sf: ts.SourceFile;
  readonly bindings: readonly Binding[];
  readonly fakeFactory: boolean;
  readonly handlerShaped: boolean;
  readonly methods: readonly string[];
  readonly noop: boolean;
  readonly validated: boolean;
  readonly eventKey: string | undefined;
}

interface Model {
  readonly root: string;
  readonly apiVer: string;
  readonly contracts: readonly ContractDecl[];
  readonly apiFiles: readonly ApiFile[];
  readonly routes: ReadonlyMap<string, string>;
  readonly methods: ReadonlyMap<string, string>;
  readonly aliases: ReadonlyMap<string, string>;
  readonly raw: readonly { file: string; methods: readonly string[] }[];
  readonly cqrs: ReadonlyMap<string, 'COMMAND' | 'QUERY' | 'CONFIRMATION'>;
  readonly info: ReadonlyMap<string, string>;
  readonly grants: ReadonlyMap<string, ReadonlySet<string>>;
  readonly wildcard: boolean;
  readonly allowedAudit: ReadonlySet<string>;
  readonly strictPrefixes: readonly string[];
  readonly strictRegionKeys: ReadonlySet<string>;
  readonly dtoFields: ReadonlyMap<string, ReadonlySet<string>>;
  readonly registryText: string;
  readonly sources: ReadonlyMap<string, ts.SourceFile>;
}

function source(root: string, rel: string): ts.SourceFile {
  return parseTs(rel, readText(root, rel));
}

function objectOf(
  expr: ts.Expression | undefined
): ts.ObjectLiteralExpression | undefined {
  if (expr === undefined) {
    return undefined;
  }
  const node = unwrapExpr(expr);
  if (ts.isObjectLiteralExpression(node)) {
    return node;
  }
  if (!ts.isCallExpression(node) || node.arguments[0] === undefined) {
    return undefined;
  }
  const callee = unwrapExpr(node.expression);
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'freeze') {
    return objectOf(node.arguments[0]);
  }
  return undefined;
}

function exportedInit(
  sf: ts.SourceFile,
  name: string
): ts.Expression | undefined {
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) {
      continue;
    }
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name) {
        return decl.initializer;
      }
    }
  }
  return undefined;
}

function stringLit(expr: ts.Expression | undefined): string | undefined {
  if (expr === undefined) {
    return undefined;
  }
  const node = unwrapExpr(expr);
  return ts.isStringLiteralLike(node) ? node.text : undefined;
}

function boolLit(expr: ts.Expression | undefined): boolean | undefined {
  if (expr === undefined) {
    return undefined;
  }
  const node = unwrapExpr(expr);
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  return undefined;
}

function isNull(expr: ts.Expression | undefined): boolean {
  return (
    expr !== undefined && unwrapExpr(expr).kind === ts.SyntaxKind.NullKeyword
  );
}

function stringArray(expr: ts.Expression | undefined): string[] {
  if (expr === undefined) {
    return [];
  }
  const node = unwrapExpr(expr);
  if (!ts.isArrayLiteralExpression(node)) {
    return [];
  }
  return node.elements.flatMap(el => {
    const text = stringLit(el);
    return text === undefined ? [] : [text];
  });
}

function routeText(expr: ts.Expression, apiVer: string): string | undefined {
  const node = unwrapExpr(expr);
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (!ts.isTemplateExpression(node) || node.templateSpans.length !== 1) {
    return undefined;
  }
  const span = node.templateSpans[0];
  if (span === undefined || !ts.isIdentifier(span.expression)) {
    return undefined;
  }
  if (span.expression.text !== 'API_VER') {
    return undefined;
  }
  return `${apiVer}${span.literal.text}`;
}

function propInit(
  obj: ts.ObjectLiteralExpression,
  name: string
): ts.Expression | undefined {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && propName(prop.name) === name) {
      return prop.initializer;
    }
  }
  return undefined;
}

function localObjects(
  sf: ts.SourceFile
): Map<string, ts.ObjectLiteralExpression> {
  const out = new Map<string, ts.ObjectLiteralExpression>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) {
      continue;
    }
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) {
        continue;
      }
      const obj = objectOf(decl.initializer);
      if (obj !== undefined) {
        out.set(decl.name.text, obj);
      }
    }
  }
  return out;
}

interface ParseCache {
  readonly root: string;
  readonly files: Map<string, ts.SourceFile>;
  readonly locals: Map<string, Map<string, ts.ObjectLiteralExpression>>;
  readonly values: Map<
    string,
    Map<string, { specifier: string; imported: string }>
  >;
}

interface MapRef {
  readonly rel: string;
  readonly name: string;
}

interface RawOp {
  readonly key: string;
  readonly rel: string;
  readonly line: number;
  readonly body: ts.ObjectLiteralExpression;
}

interface Candidate {
  readonly rel: string;
  readonly name: string;
  readonly obj: ts.ObjectLiteralExpression;
  readonly own: boolean;
}

function cacheFor(root: string): ParseCache {
  return { root, files: new Map(), locals: new Map(), values: new Map() };
}

function sfOf(cache: ParseCache, rel: string): ts.SourceFile {
  const hit = cache.files.get(rel);
  if (hit !== undefined) {
    return hit;
  }
  const parsed = source(cache.root, rel);
  cache.files.set(rel, parsed);
  return parsed;
}

function localsOf(
  cache: ParseCache,
  rel: string
): Map<string, ts.ObjectLiteralExpression> {
  const hit = cache.locals.get(rel);
  if (hit !== undefined) {
    return hit;
  }
  const built = localObjects(sfOf(cache, rel));
  cache.locals.set(rel, built);
  return built;
}

/** Value named imports only. A type-only import is not a runtime spread. */
function valueImportsOf(
  cache: ParseCache,
  rel: string
): Map<string, { specifier: string; imported: string }> {
  const hit = cache.values.get(rel);
  if (hit !== undefined) {
    return hit;
  }
  const out = new Map<string, { specifier: string; imported: string }>();
  for (const stmt of sfOf(cache, rel).statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !ts.isStringLiteral(stmt.moduleSpecifier) ||
      stmt.importClause === undefined ||
      stmt.importClause.isTypeOnly
    ) {
      continue;
    }
    const named = stmt.importClause.namedBindings;
    if (named === undefined || !ts.isNamedImports(named)) {
      continue;
    }
    for (const el of named.elements) {
      if (el.isTypeOnly) {
        continue;
      }
      out.set(el.name.text, {
        specifier: stmt.moduleSpecifier.text,
        imported: (el.propertyName ?? el.name).text,
      });
    }
  }
  cache.values.set(rel, out);
  return out;
}

function topDecl(
  sf: ts.SourceFile,
  name: string
): ts.VariableDeclaration | undefined {
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) {
      continue;
    }
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === name &&
        decl.initializer !== undefined
      ) {
        return decl;
      }
    }
  }
  return undefined;
}

/** The object passed to `defineContracts(...)`, if this initializer is that call. */
function defineContractsObject(
  init: ts.Expression | undefined
): ts.ObjectLiteralExpression | undefined {
  if (init === undefined) {
    return undefined;
  }
  const call = unwrapExpr(init);
  if (!ts.isCallExpression(call) || call.arguments[0] === undefined) {
    return undefined;
  }
  const callee = unwrapExpr(call.expression);
  if (!ts.isIdentifier(callee) || callee.text !== 'defineContracts') {
    return undefined;
  }
  return objectOf(call.arguments[0]);
}

function mapRef(
  cache: ParseCache,
  rel: string,
  localName: string,
  stack: ReadonlySet<string>
): MapRef | undefined {
  const id = `${rel}#${localName}`;
  if (stack.has(id)) {
    return undefined;
  }
  const next = new Set(stack);
  next.add(id);
  const local = topDecl(sfOf(cache, rel), localName);
  if (local !== undefined) {
    if (defineContractsObject(local.initializer) !== undefined) {
      return { rel, name: localName };
    }
    if (spreadAggregate(cache, rel, local.initializer, next)) {
      return { rel, name: localName };
    }
    return undefined;
  }
  const binding = valueImportsOf(cache, rel).get(localName);
  if (binding === undefined) {
    return undefined;
  }
  const target = resolveModule(cache.root, rel, binding.specifier, []);
  if (target === undefined) {
    return undefined;
  }
  const decl = topDecl(sfOf(cache, target), binding.imported);
  if (decl === undefined) {
    return undefined;
  }
  if (defineContractsObject(decl.initializer) !== undefined) {
    return { rel: target, name: binding.imported };
  }
  if (spreadAggregate(cache, target, decl.initializer, next)) {
    return { rel: target, name: binding.imported };
  }
  return undefined;
}

/** True when the object spreads at least one real contract map. A plain object is not. */
function spreadAggregate(
  cache: ParseCache,
  rel: string,
  init: ts.Expression | undefined,
  stack: ReadonlySet<string>
): boolean {
  const obj = init === undefined ? undefined : objectOf(init);
  if (obj === undefined) {
    return false;
  }
  for (const prop of obj.properties) {
    if (!ts.isSpreadAssignment(prop)) {
      continue;
    }
    const expr = unwrapExpr(prop.expression);
    if (!ts.isIdentifier(expr)) {
      continue;
    }
    if (mapRef(cache, rel, expr.text, stack) !== undefined) {
      return true;
    }
  }
  return false;
}

function contractFiles(root: string): string[] {
  return walk(
    root,
    '.shared-kernel',
    rel =>
      rel.endsWith('.contracts.ts') && !rel.includes('READONLY-shared-kernel')
  );
}

function candidates(cache: ParseCache): Candidate[] {
  const out: Candidate[] = [];
  for (const rel of contractFiles(cache.root)) {
    for (const stmt of sfOf(cache, rel).statements) {
      if (!ts.isVariableStatement(stmt)) {
        continue;
      }
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) {
          continue;
        }
        const defined = defineContractsObject(decl.initializer);
        if (defined !== undefined) {
          out.push({ rel, name: decl.name.text, obj: defined, own: true });
          continue;
        }
        if (spreadAggregate(cache, rel, decl.initializer, new Set())) {
          const obj = objectOf(decl.initializer);
          if (obj !== undefined) {
            out.push({ rel, name: decl.name.text, obj, own: false });
          }
        }
      }
    }
  }
  return out;
}

function candidateBy(
  cands: readonly Candidate[],
  ref: MapRef
): Candidate | undefined {
  return cands.find(cand => cand.rel === ref.rel && cand.name === ref.name);
}

/** Operations of one map. Spread order is source order; a later key replaces an earlier one. */
function expandOps(
  cache: ParseCache,
  cands: readonly Candidate[],
  cand: Candidate,
  stack: ReadonlySet<string>
): RawOp[] {
  const ordered = new Map<string, RawOp>();
  const put = (op: RawOp): void => {
    ordered.delete(op.key);
    ordered.set(op.key, op);
  };
  const sf = sfOf(cache, cand.rel);
  for (const prop of cand.obj.properties) {
    if (ts.isSpreadAssignment(prop)) {
      const expr = unwrapExpr(prop.expression);
      if (!ts.isIdentifier(expr)) {
        continue;
      }
      const target = mapRef(cache, cand.rel, expr.text, stack);
      if (target === undefined || stack.has(`${target.rel}#${target.name}`)) {
        continue;
      }
      const child = candidateBy(cands, target);
      if (child === undefined) {
        continue;
      }
      const next = new Set(stack);
      next.add(`${target.rel}#${target.name}`);
      for (const op of expandOps(cache, cands, child, next)) {
        put(op);
      }
      continue;
    }
    if (!cand.own || !ts.isPropertyAssignment(prop)) {
      continue;
    }
    const key = propName(prop.name);
    const body = objectOf(prop.initializer);
    if (key === undefined || body === undefined) {
      continue;
    }
    put({ key, rel: cand.rel, line: nodeLine(sf, prop), body });
  }
  return [...ordered.values()];
}

function consumedIds(
  cache: ParseCache,
  cands: readonly Candidate[]
): Set<string> {
  const consumed = new Set<string>();
  for (const parent of cands) {
    const parentId = `${parent.rel}#${parent.name}`;
    for (const prop of parent.obj.properties) {
      if (!ts.isSpreadAssignment(prop)) {
        continue;
      }
      const expr = unwrapExpr(prop.expression);
      if (!ts.isIdentifier(expr)) {
        continue;
      }
      const target = mapRef(cache, parent.rel, expr.text, new Set([parentId]));
      if (target === undefined) {
        continue;
      }
      consumed.add(`${target.rel}#${target.name}`);
    }
  }
  return consumed;
}

interface MetaObj {
  readonly rel: string;
  readonly obj: ts.ObjectLiteralExpression;
}

/** Same-file object, or a value import of an object literal. Not a defineContracts() map. */
function lookupMeta(
  cache: ParseCache,
  rel: string,
  name: string
): MetaObj | undefined {
  const local = localsOf(cache, rel).get(name);
  if (local !== undefined) {
    return { rel, obj: local };
  }
  const binding = valueImportsOf(cache, rel).get(name);
  if (binding === undefined) {
    return undefined;
  }
  const target = resolveModule(cache.root, rel, binding.specifier, []);
  if (target === undefined) {
    return undefined;
  }
  const decl = topDecl(sfOf(cache, target), binding.imported);
  if (
    decl === undefined ||
    defineContractsObject(decl.initializer) !== undefined
  ) {
    return undefined;
  }
  const obj = localsOf(cache, target).get(binding.imported);
  if (obj === undefined) {
    return undefined;
  }
  return { rel: target, obj };
}

/**
 * A field written on the object, or carried by a spread of a same-file const or a
 * value-imported object literal in a local source file. Later writes win.
 */
function fieldOf(
  cache: ParseCache,
  rel: string,
  obj: ts.ObjectLiteralExpression,
  name: string,
  seen: ReadonlySet<string>
): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop)) {
      const expr = unwrapExpr(prop.expression);
      if (!ts.isIdentifier(expr)) {
        continue;
      }
      const id = `${rel}#${expr.text}`;
      if (seen.has(id)) {
        continue;
      }
      const next = new Set(seen);
      next.add(id);
      const meta = lookupMeta(cache, rel, expr.text);
      if (meta === undefined) {
        continue;
      }
      const inner = fieldOf(cache, meta.rel, meta.obj, name, next);
      if (inner !== undefined) {
        found = inner;
      }
      continue;
    }
    if (ts.isPropertyAssignment(prop) && propName(prop.name) === name) {
      found = prop.initializer;
    }
  }
  return found;
}

function toContract(
  cache: ParseCache,
  op: RawOp,
  exportName: string
): ContractDecl {
  const read = (name: string): ts.Expression | undefined =>
    fieldOf(cache, op.rel, op.body, name, new Set());
  const querySchema = read('querySchema');
  const bodyExpr = read('body');
  return {
    key: op.key,
    exportName,
    file: op.rel,
    line: op.line,
    kind: stringLit(read('kind')) ?? '',
    method: stringLit(read('method')) ?? '',
    path: stringLit(read('path')) ?? '',
    access: stringLit(read('access')) ?? '',
    authCheck: boolLit(read('authCheck')),
    limiterTier: stringLit(read('limiterTier')) ?? '',
    group: stringLit(read('group')) ?? '',
    successEvents: stringArray(read('successEvents')),
    auditEvents: stringArray(read('auditEvents')),
    bodyNull: isNull(bodyExpr),
    queryNull: isNull(read('query')),
    hasBody: bodyExpr !== undefined && !isNull(bodyExpr),
    hasQuerySchema: querySchema !== undefined && !isNull(querySchema),
  };
}

function readApiVer(sf: ts.SourceFile): string {
  return stringLit(exportedInit(sf, 'API_VER')) ?? '';
}

/**
 * DECISION: an operation is a property of defineContracts(), including one reached by
 * spreading an imported map (value import of a local source file whose export is
 * defineContracts or an aggregate of such maps). Later spreads replace earlier keys.
 * A plain object, a comment, or a string is not a map, so a `*.contracts.ts` suffix
 * cannot invent keys. Field metadata follows the same imported object literals.
 * Test: d1-contracts.test.ts (4-module aggregate, fake spread, unregistered op).
 */
function readContracts(root: string): ContractDecl[] {
  const cache = cacheFor(root);
  const cands = candidates(cache);
  const consumed = consumedIds(cache, cands);
  const out: ContractDecl[] = [];
  for (const cand of cands) {
    if (consumed.has(`${cand.rel}#${cand.name}`)) {
      continue;
    }
    const ops = expandOps(
      cache,
      cands,
      cand,
      new Set([`${cand.rel}#${cand.name}`])
    );
    for (const op of ops) {
      out.push(toContract(cache, op, cand.name));
    }
  }
  return out;
}

function readMap(
  sf: ts.SourceFile,
  name: string,
  apiVer: string,
  mode: 'route' | 'method'
): Map<string, string> {
  const out = new Map<string, string>();
  const obj = objectOf(exportedInit(sf, name));
  if (obj === undefined) {
    return out;
  }
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const key = propName(prop.name);
    if (key === undefined) {
      continue;
    }
    const value =
      mode === 'route'
        ? routeText(prop.initializer, apiVer)
        : stringLit(prop.initializer);
    if (value !== undefined) {
      out.set(key, value);
    }
  }
  return out;
}

function readAliases(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  const obj = objectOf(exportedInit(sf, 'ROUTE_ALIASES'));
  if (obj === undefined) {
    return out;
  }
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const key = propName(prop.name);
    const value = stringLit(prop.initializer);
    if (key !== undefined && value !== undefined) {
      out.set(key, value);
    }
  }
  return out;
}

function readRaw(sf: ts.SourceFile): { file: string; methods: string[] }[] {
  const init = exportedInit(sf, 'RAW_PROTOCOLS');
  const arr = init !== undefined ? unwrapExpr(init) : undefined;
  if (arr === undefined || !ts.isArrayLiteralExpression(arr)) {
    return [];
  }
  const out: { file: string; methods: string[] }[] = [];
  for (const el of arr.elements) {
    const obj = objectOf(el);
    if (obj === undefined) {
      continue;
    }
    const file = stringLit(propInit(obj, 'file'));
    if (file === undefined) {
      continue;
    }
    out.push({ file, methods: stringArray(propInit(obj, 'methods')) });
  }
  return out;
}

function readEvents(sf: ts.SourceFile): {
  cqrs: Map<string, 'COMMAND' | 'QUERY' | 'CONFIRMATION'>;
  info: Map<string, string>;
} {
  const cqrs = new Map<string, 'COMMAND' | 'QUERY' | 'CONFIRMATION'>();
  const info = new Map<string, string>();
  const root = objectOf(exportedInit(sf, 'APP_EVENTS'));
  if (root === undefined) {
    return { cqrs, info };
  }
  const takeGroup = (name: string, kind: 'COMMAND' | 'QUERY'): void => {
    const block = objectOf(propInit(root, name));
    if (block === undefined) {
      return;
    }
    for (const group of block.properties) {
      if (!ts.isPropertyAssignment(group)) {
        continue;
      }
      const events = objectOf(group.initializer);
      if (events === undefined) {
        continue;
      }
      for (const event of events.properties) {
        if (!ts.isPropertyAssignment(event)) {
          continue;
        }
        const key = propName(event.name);
        if (key !== undefined) {
          cqrs.set(key, kind);
        }
      }
    }
  };
  takeGroup('COMMANDS', 'COMMAND');
  takeGroup('QUERIES', 'QUERY');
  const confirmations = objectOf(propInit(root, 'CONFIRMATIONS'));
  if (confirmations !== undefined) {
    for (const event of confirmations.properties) {
      if (!ts.isPropertyAssignment(event)) {
        continue;
      }
      const key = propName(event.name);
      if (key !== undefined) {
        cqrs.set(key, 'CONFIRMATION');
      }
    }
  }
  const infoBlock = objectOf(propInit(root, 'INFO'));
  if (infoBlock !== undefined) {
    for (const group of infoBlock.properties) {
      if (!ts.isPropertyAssignment(group)) {
        continue;
      }
      const groupName = propName(group.name);
      const events = objectOf(group.initializer);
      if (groupName === undefined || events === undefined) {
        continue;
      }
      for (const event of events.properties) {
        if (!ts.isPropertyAssignment(event)) {
          continue;
        }
        const key = propName(event.name);
        const value = stringLit(event.initializer);
        if (key !== undefined && value !== undefined) {
          info.set(`APP_EVENTS.INFO.${groupName}.${key}`, value);
        }
      }
    }
  }
  return { cqrs, info };
}

function regionBody(text: string, id: string): string {
  const start = `// <generated:contracts:${id}>`;
  const end = `// </generated:contracts:${id}>`;
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    return '';
  }
  return text.slice(from + start.length, to);
}

function calleeName(expr: ts.Expression): string {
  const callee = unwrapExpr(expr);
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  return '';
}

/** MASTER_ADMIN's initializer calls getAllEvents(), including through .map/.filter. */
function hasAdminWildcard(sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      found ||
      !ts.isPropertyAssignment(node) ||
      !ts.isComputedPropertyName(node.name)
    ) {
      ts.forEachChild(node, visit);
      return;
    }
    if (!node.name.expression.getText(sf).includes('MASTER_ADMIN')) {
      ts.forEachChild(node, visit);
      return;
    }
    const look = (inner: ts.Node): void => {
      if (
        ts.isCallExpression(inner) &&
        ts.isIdentifier(unwrapExpr(inner.expression)) &&
        calleeName(inner.expression) === 'getAllEvents'
      ) {
        found = true;
      }
      ts.forEachChild(inner, look);
    };
    look(node.initializer);
  };
  visit(sf);
  return found;
}

function arrayConstKeys(sf: ts.SourceFile, name: string): Set<string> {
  const init = exportedInit(sf, name);
  const keys = new Set<string>();
  if (init === undefined) {
    return keys;
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.getText(sf).replace(/\s+/g, '').startsWith('APP_EVENTS.')
    ) {
      keys.add(node.name.text);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(init);
  return keys;
}

function readAllowed(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const init = exportedInit(sf, 'allowedEventLogTypes');
  if (init === undefined) {
    return out;
  }
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && /^[A-Z][A-Z0-9_]*$/.test(node.text)) {
      out.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(init);
  return out;
}

function fileRoute(relUnderApi: string): string {
  return relUnderApi.replace(/\/index\.ts$/, '').replace(/\.ts$/, '');
}

function readsReqMethod(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'method') {
    return true;
  }
  let found = false;
  ts.forEachChild(node, child => {
    if (!found && readsReqMethod(child)) {
      found = true;
    }
  });
  return found;
}

function collectMethods(sf: ts.SourceFile): string[] {
  const aliases = new Set<string>();
  const aliasVisit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      readsReqMethod(node.initializer)
    ) {
      aliases.add(node.name.text);
    }
    ts.forEachChild(node, aliasVisit);
  };
  aliasVisit(sf);
  const found = new Set<string>();
  const add = (text: string | undefined): void => {
    if (text === undefined) {
      return;
    }
    const upper = text.toUpperCase();
    if (VERBS.has(upper)) {
      found.add(upper);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (propName(node.name) === 'method' ||
        propName(node.name) === 'contestedHTTPMethod')
    ) {
      const walkExpr = (expr: ts.Expression): void => {
        const inner = unwrapExpr(expr);
        add(stringLit(inner));
        if (ts.isConditionalExpression(inner)) {
          walkExpr(inner.whenTrue);
          walkExpr(inner.whenFalse);
        }
      };
      walkExpr(node.initializer);
    }
    if (
      ts.isPropertyAssignment(node) &&
      propName(node.name) === 'allowedMethods'
    ) {
      for (const item of stringArray(node.initializer)) {
        add(item);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
    ) {
      const left = unwrapExpr(node.left);
      const isMethod =
        (ts.isPropertyAccessExpression(left) && left.name.text === 'method') ||
        (ts.isIdentifier(left) && aliases.has(left.text));
      if (isMethod) {
        add(stringLit(node.right));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found];
}

/** Shared middleware answers OPTIONS. A file that reaches it declares OPTIONS. */
function answersOptions(sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (
        name === 'HTTPRequestHandlerMiddleware' ||
        name === 'withPublicHandler' ||
        name === 'withRawSecretHandler' ||
        name === 'defineHandler'
      ) {
        found = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function absorbFactoryAliases(
  sf: ts.SourceFile,
  callees: ReturnType<typeof factoryCallees>
): void {
  let grew = true;
  while (grew) {
    grew = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined
      ) {
        const init = unwrapExpr(node.initializer);
        if (ts.isIdentifier(init)) {
          const kind = callees.byLocal.get(init.text);
          if (kind !== undefined && !callees.byLocal.has(node.name.text)) {
            callees.byLocal.set(node.name.text, kind);
            grew = true;
          }
        }
        if (
          ts.isPropertyAccessExpression(init) &&
          ts.isIdentifier(init.expression) &&
          callees.namespaces.has(init.expression.text) &&
          (init.name.text === 'defineEndpoint' ||
            init.name.text === 'bindEndpoint' ||
            init.name.text === 'defineEndpointSwitch') &&
          !callees.byLocal.has(node.name.text)
        ) {
          callees.byLocal.set(node.name.text, init.name.text as FactoryKind);
          grew = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

function validatorState(sf: ts.SourceFile): {
  noop: boolean;
  validated: boolean;
} {
  let noop = false;
  let validated = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (propName(node.name) === 'validate' ||
        propName(node.name) === 'validationFunction')
    ) {
      const init = unwrapExpr(node.initializer);
      if (ts.isIdentifier(init) && init.text === 'NO_VALIDATION') {
        noop = true;
      } else if (
        ts.isPropertyAccessExpression(init) &&
        init.getText(sf).includes('VALIDATION_POLICY.validators')
      ) {
        validated = true;
      } else if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        const text = init.getText(sf);
        if (text.includes('__isValid') && text.includes('true')) {
          noop = true;
        } else {
          validated = true;
        }
      } else if (!ts.isIdentifier(init)) {
        validated = true;
      } else {
        validated = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { noop, validated };
}

function eventKeyOf(sf: ts.SourceFile): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) {
      return;
    }
    if (
      ts.isPropertyAssignment(node) &&
      propName(node.name) === 'eventName' &&
      ts.isPropertyAccessExpression(unwrapExpr(node.initializer))
    ) {
      const text = unwrapExpr(node.initializer).getText(sf).replace(/\s+/g, '');
      const match =
        /^APP_EVENTS\.(?:COMMANDS|QUERIES)\.[A-Z0-9_]+\.([A-Z0-9_]+)$/.exec(
          text
        ) ?? /^APP_EVENTS\.CONFIRMATIONS\.([A-Z0-9_]+)$/.exec(text);
      if (match?.[1] !== undefined) {
        found = match[1];
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function readApiFiles(root: string): ApiFile[] {
  const rels = walk(root, 'web-1/src/pages/api', rel => rel.endsWith('.ts'));
  return rels.map(rel => {
    const under = rel.slice('web-1/src/pages/api/'.length);
    const sf = source(root, rel);
    const callees = factoryCallees(sf, root);
    absorbFactoryAliases(sf, callees);
    const bindings: Binding[] = [];
    let fakeFactory = false;
    let handlerShaped = false;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const kind = callFactory(node.expression, callees);
        const callee = unwrapExpr(node.expression);
        const calleeText = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : '';
        if (kind === 'defineEndpoint' || kind === 'bindEndpoint') {
          const key = contractKeyFrom(node.arguments[0]);
          if (key !== undefined) {
            bindings.push({ key, kind, file: rel, line: nodeLine(sf, node) });
          } else {
            fakeFactory = true;
          }
        } else if (
          calleeText === 'defineEndpoint' ||
          calleeText === 'bindEndpoint'
        ) {
          fakeFactory = true;
        }
        if (
          calleeText === 'defineHandler' ||
          calleeText === 'HTTPRequestHandlerMiddleware' ||
          calleeText === 'withPublicHandler' ||
          calleeText === 'withRawSecretHandler'
        ) {
          handlerShaped = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    const validation = validatorState(sf);
    const ownMethods = collectMethods(sf);
    return {
      rel: under,
      routePath: fileRoute(under.startsWith('v1/') ? under.slice(3) : under),
      sf,
      bindings,
      fakeFactory,
      handlerShaped: handlerShaped || bindings.length > 0,
      methods:
        ownMethods.length > 0 ? ownMethods : delegatedMethods(root, rel, sf),
      noop: validation.noop,
      validated: validation.validated,
      eventKey: eventKeyOf(sf),
    };
  });
}

function readStrict(
  sf: ts.SourceFile,
  routes: ReadonlyMap<string, string>
): { prefixes: string[]; regionKeys: Set<string> } {
  const prefixes: string[] = [];
  const regionKeys = new Set<string>();
  const text = sf.getFullText();
  for (const match of regionBody(text, 'strict-routes').matchAll(
    /ROUTES_API\.([A-Z0-9_]+)/g
  )) {
    if (match[1] !== undefined) {
      regionKeys.add(match[1]);
    }
  }
  const config = objectOf(exportedInit(sf, 'RATE_LIMIT_CONFIG'));
  const list =
    config === undefined ? undefined : propInit(config, 'STRICT_ENDPOINTS');
  const arr = list === undefined ? undefined : unwrapExpr(list);
  if (arr === undefined || !ts.isArrayLiteralExpression(arr)) {
    return { prefixes, regionKeys };
  }
  for (const el of arr.elements) {
    const node = unwrapExpr(el);
    if (ts.isStringLiteralLike(node)) {
      prefixes.push(node.text);
      continue;
    }
    const textOf = node.getText(sf).replace(/\s+/g, '');
    const key = /ROUTES_API\.([A-Z0-9_]+)/.exec(textOf)?.[1];
    if (key === undefined) {
      continue;
    }
    const route = routes.get(key);
    if (route === undefined) {
      continue;
    }
    prefixes.push(
      textOf.includes('.split(') ? (route.split('[')[0] ?? route) : route
    );
  }
  return { prefixes, regionKeys };
}

function dtoFieldsOf(type: ts.TypeNode): Map<string, Set<string>> | undefined {
  if (!ts.isTypeLiteralNode(type)) {
    return undefined;
  }
  const out = new Map<string, Set<string>>();
  for (const member of type.members) {
    if (
      !ts.isPropertySignature(member) ||
      member.type === undefined ||
      !ts.isTypeLiteralNode(member.type)
    ) {
      continue;
    }
    const key = propName(member.name);
    if (key === undefined) {
      continue;
    }
    const fields = new Set<string>();
    for (const field of member.type.members) {
      if (ts.isPropertySignature(field)) {
        const fieldName = propName(field.name);
        if (fieldName !== undefined) {
          fields.add(fieldName);
        }
      }
    }
    if (fields.has('REQUEST') || fields.has('RESPONSE')) {
      out.set(key, fields);
    }
  }
  return out.size > 0 ? out : undefined;
}

interface FoundType {
  readonly rel: string;
  readonly type: ts.TypeNode;
}

/**
 * DECISION: a DTO block counts only from an exported `*_DTO_API_V1` type. Intersection
 * members and imported type aliases are followed into local source files (generated
 * parts included). A part type the canonical type does not name is not a block.
 * Test: d1-contracts.test.ts (part intersection; decoy type is not a block).
 */
function collectDtoOps(
  rel: string,
  type: ts.TypeNode,
  resolve: (rel: string, name: string) => FoundType | undefined,
  into: Map<string, Set<string>>
): void {
  const direct = dtoFieldsOf(type);
  if (direct !== undefined) {
    for (const [key, fields] of direct) {
      const prev = into.get(key);
      if (prev === undefined) {
        into.set(key, new Set(fields));
      } else {
        for (const field of fields) {
          prev.add(field);
        }
      }
    }
    return;
  }
  const parts =
    ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type)
      ? type.types
      : ts.isParenthesizedTypeNode(type)
        ? [type.type]
        : undefined;
  if (parts !== undefined) {
    for (const part of parts) {
      collectDtoOps(rel, part, resolve, into);
    }
    return;
  }
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
    return;
  }
  const found = resolve(rel, type.typeName.text);
  if (found === undefined) {
    return;
  }
  collectDtoOps(found.rel, found.type, resolve, into);
}

function readDtos(root: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const files = walk(root, '.shared-kernel/models', rel =>
    rel.endsWith('.dto.ts')
  );
  const cache = new Map<string, ts.SourceFile>();
  const load = (rel: string): ts.SourceFile => {
    const hit = cache.get(rel);
    if (hit !== undefined) {
      return hit;
    }
    const parsed = source(root, rel);
    cache.set(rel, parsed);
    return parsed;
  };
  const stack = new Set<string>();
  const resolve = (rel: string, name: string): FoundType | undefined => {
    const id = `${rel}#${name}`;
    if (stack.has(id)) {
      return undefined;
    }
    stack.add(id);
    const sf = load(rel);
    for (const stmt of sf.statements) {
      if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) {
        return { rel, type: stmt.type };
      }
    }
    for (const stmt of sf.statements) {
      if (
        !ts.isImportDeclaration(stmt) ||
        !ts.isStringLiteral(stmt.moduleSpecifier) ||
        stmt.importClause === undefined
      ) {
        continue;
      }
      const named = stmt.importClause.namedBindings;
      if (named === undefined || !ts.isNamedImports(named)) {
        continue;
      }
      for (const el of named.elements) {
        if (el.name.text !== name) {
          continue;
        }
        const target = resolveModule(root, rel, stmt.moduleSpecifier.text, []);
        if (target === undefined) {
          return undefined;
        }
        return resolve(target, (el.propertyName ?? el.name).text);
      }
    }
    return undefined;
  };
  for (const rel of files) {
    const sf = load(rel);
    for (const stmt of sf.statements) {
      if (
        !ts.isTypeAliasDeclaration(stmt) ||
        !/^[A-Z0-9_]+_DTO_API_V1$/.test(stmt.name.text)
      ) {
        continue;
      }
      stack.clear();
      stack.add(`${rel}#${stmt.name.text}`);
      collectDtoOps(rel, stmt.type, resolve, out);
    }
  }
  return out;
}

/** A route file whose default export calls an imported factory inherits that factory's verbs. */
function delegatedMethods(
  root: string,
  rel: string,
  sf: ts.SourceFile
): string[] {
  let callee = '';
  for (const stmt of sf.statements) {
    if (!ts.isExportAssignment(stmt)) {
      continue;
    }
    const expr = unwrapExpr(stmt.expression);
    if (ts.isCallExpression(expr)) {
      callee = calleeName(expr.expression);
    }
  }
  if (callee === '') {
    return [];
  }
  const binding = importBindings(sf).get(callee);
  if (binding === undefined) {
    return [];
  }
  const target = resolveModule(root, rel, binding.specifier, WEB1_ALIASES);
  if (target === undefined) {
    return [];
  }
  return collectMethods(source(root, target));
}

function load(root: string): { model: Model; missing: string[] } {
  const present = (rel: string): boolean => {
    try {
      if (rel.endsWith('.ts')) {
        readText(root, rel);
        return true;
      }
      return (
        walk(root, rel, () => true).length >= 0 &&
        walk(root, rel, file => file.endsWith('.ts')).length > 0
      );
    } catch {
      return false;
    }
  };
  const absent = ANCHORS.filter(rel => !present(rel));
  const empty = new Map<string, string>();
  if (absent.length > 0) {
    return {
      missing: absent,
      model: {
        root,
        apiVer: '',
        contracts: [],
        apiFiles: [],
        routes: empty,
        methods: empty,
        aliases: empty,
        raw: [],
        cqrs: new Map(),
        info: new Map(),
        grants: new Map(),
        wildcard: false,
        allowedAudit: new Set(),
        strictPrefixes: [],
        strictRegionKeys: new Set(),
        dtoFields: new Map(),
        registryText: '',
        sources: new Map(),
      },
    };
  }
  const http = source(root, '.shared-kernel/domain/http/http.config.ts');
  const apiVer = readApiVer(http);
  const routes = readMap(
    source(root, '.shared-kernel/domain/routing/routing.config.ts'),
    'ROUTES_API',
    apiVer,
    'route'
  );
  const methods = readMap(
    source(root, '.shared-kernel/domain/http/http-methods.config.ts'),
    'API_HTTP_METHODS',
    apiVer,
    'method'
  );
  const events = readEvents(
    source(root, '.shared-kernel/domain/events/app-events.const.ts')
  );
  const grantsSf = source(
    root,
    '.shared-kernel/application/role-permissions.ts'
  );
  const explicit = new Map<string, Set<string>>();
  for (const [layer, constName] of Object.entries(LAYER_CONST)) {
    explicit.set(layer, arrayConstKeys(grantsSf, constName));
  }
  const rate = source(
    root,
    'web-1/src/application/http/rate-limit.middleware.ts'
  );
  const strict = readStrict(rate, routes);
  const seed = source(
    root,
    'web-1/src/application/permissions/permissions.seed.ts'
  );
  return {
    missing: [],
    model: {
      root,
      apiVer,
      contracts: readContracts(root),
      apiFiles: readApiFiles(root),
      routes,
      methods,
      aliases: readAliases(
        source(root, 'main/src/application/http/http.endpoints.ts')
      ),
      raw: readRaw(
        source(root, '.shared-kernel/application/contracts/raw-protocols.ts')
      ),
      cqrs: events.cqrs,
      info: events.info,
      grants: explicit,
      wildcard: hasAdminWildcard(seed),
      allowedAudit: readAllowed(
        source(root, '.shared-kernel/domain/event-log/event_log.config.ts')
      ),
      strictPrefixes: strict.prefixes,
      strictRegionKeys: strict.regionKeys,
      dtoFields: readDtos(root),
      registryText: readText(
        root,
        '.shared-kernel/application/contracts/api-contracts.registry.ts'
      ),
      sources: new Map(),
    },
  };
}

function push(
  check: MutableCheck,
  file: string,
  line: number,
  message: string
): void {
  check.findings.push({ file, line, message });
}

function illegal(c: ContractDecl): string[] {
  const problems: string[] = [];
  if (!/^[A-Z][A-Z0-9_]*$/.test(c.key)) {
    problems.push('operation key must be UPPER_SNAKE');
  }
  if (c.path.length === 0 || c.path.startsWith('/')) {
    problems.push('path must be relative under API_VER');
  }
  if (c.kind === 'COMMAND') {
    if (c.method !== 'POST' && c.method !== 'PATCH' && c.method !== 'DELETE') {
      problems.push('COMMAND requires POST, PATCH or DELETE');
    }
    if (!c.hasBody) {
      problems.push('COMMAND requires a body schema');
    }
    if (!c.queryNull) {
      problems.push('COMMAND has no query fields');
    }
    if (c.hasQuerySchema) {
      problems.push('COMMAND has no query schema');
    }
  } else if (c.kind === 'QUERY') {
    if (c.method !== 'GET') {
      problems.push('QUERY requires GET');
    }
    if (!c.bodyNull) {
      problems.push('QUERY has body: null');
    }
  } else if (c.kind === 'CONFIRMATION') {
    if (c.method !== 'GET') {
      problems.push('CONFIRMATION requires GET');
    }
    if (!c.hasBody) {
      problems.push('CONFIRMATION requires a body schema');
    }
    if (!c.queryNull) {
      problems.push('CONFIRMATION has no query fields');
    }
  } else {
    problems.push('kind must be COMMAND, QUERY or CONFIRMATION');
  }
  if (c.access === 'PUBLIC_NO_GRANT' && c.authCheck !== false) {
    problems.push('PUBLIC_NO_GRANT requires authCheck: false');
  }
  return problems;
}

function eventRef(c: ContractDecl): string {
  if (c.kind === 'CONFIRMATION') {
    return `APP_EVENTS.CONFIRMATIONS.${c.key}`;
  }
  const bucket = c.kind === 'QUERY' ? 'QUERIES' : 'COMMANDS';
  return `APP_EVENTS.${bucket}.${c.group}.${c.key}`;
}

function declaredVerb(methods: readonly string[], verb: string): boolean {
  return methods.some(method => method.toUpperCase() === verb);
}

function covered(url: string, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => prefix !== '' && url.startsWith(prefix));
}

function usageSets(root: string): { quoted: Set<string>; dotted: Set<string> } {
  const quoted = new Set<string>();
  const dotted = new Set<string>();
  const roots = ['main/src', 'web-1/src', '.shared-kernel', 'tests', 'scripts'];
  for (const dir of roots) {
    const files = walk(
      root,
      dir,
      rel =>
        /\.(ts|tsx|js|mjs|sh)$/.test(rel) &&
        !rel.includes('READONLY-shared-kernel')
    );
    for (const rel of files) {
      const base = path.posix.basename(rel);
      const text = readText(root, rel);
      if (
        base !== 'app-events.const.ts' &&
        base !== 'event-log-descriptions.config.ts'
      ) {
        for (const match of text.matchAll(/['"`]([A-Z_][A-Z0-9_]*)['"`]/g)) {
          if (match[1] !== undefined) {
            quoted.add(match[1]);
          }
        }
      }
      if (
        base !== 'app-events.const.ts' &&
        (rel.endsWith('.ts') || rel.endsWith('.tsx'))
      ) {
        for (const match of text.matchAll(/\.([A-Z_][A-Z0-9_]*)/g)) {
          if (match[1] !== undefined) {
            dotted.add(match[1]);
          }
        }
      }
    }
  }
  return { quoted, dotted };
}

function hardcodedEvents(
  root: string
): { file: string; line: number; text: string }[] {
  const rel = '.shared-kernel/domain/commands-and-queries/cqrs.config.ts';
  const sf = source(root, rel);
  const init = exportedInit(sf, 'EVENTS');
  const out: { file: string; line: number; text: string }[] = [];
  if (init === undefined) {
    return out;
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sf).includes('Object.values')
    ) {
      return;
    }
    if (ts.isStringLiteralLike(node) && /^[A-Z][A-Z0-9_]*$/.test(node.text)) {
      out.push({ file: rel, line: nodeLine(sf, node), text: node.text });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(init);
  return out;
}

function checkShape(model: Model): CheckResult {
  const check: MutableCheck = newCheck(
    'd1:contract-shape',
    FLOORS.contracts,
    'API contracts'
  );
  check.sites = model.contracts.length;
  const seen = new Set<string>();
  for (const contract of model.contracts) {
    if (seen.has(contract.key)) {
      push(
        check,
        contract.file,
        contract.line,
        `duplicate operation key ${contract.key}`
      );
    }
    seen.add(contract.key);
    if (!model.registryText.includes(contract.exportName)) {
      push(
        check,
        contract.file,
        contract.line,
        `${contract.exportName} is not referenced by api-contracts.registry.ts`
      );
    }
    for (const problem of illegal(contract)) {
      push(check, contract.file, contract.line, `${contract.key}: ${problem}`);
    }
    if (!model.cqrs.has(contract.key)) {
      push(
        check,
        contract.file,
        contract.line,
        `${contract.key} is not a COMMAND, QUERY or CONFIRMATION event`
      );
    }
  }
  return check;
}

function checkBindings(model: Model): CheckResult {
  const check: MutableCheck = newCheck(
    'd1:bindings',
    FLOORS.apiFiles,
    'API route files'
  );
  check.sites = model.apiFiles.length;
  const byKey = new Map(
    model.contracts.map(contract => [contract.key, contract])
  );
  const bound = new Map<string, Binding>();
  const rawByFile = new Map(model.raw.map(item => [item.file, item]));
  for (const file of model.apiFiles) {
    if (file.fakeFactory) {
      push(
        check,
        `web-1/src/pages/api/${file.rel}`,
        1,
        'defineEndpoint/bindEndpoint is not a value import from define-endpoint (the resolved file is not web-1/src/application/http/define-endpoint.ts)'
      );
    }
    for (const binding of file.bindings) {
      const previous = bound.get(binding.key);
      if (previous !== undefined) {
        push(
          check,
          binding.file,
          binding.line,
          `${binding.key} is bound twice (${previous.file})`
        );
      }
      bound.set(binding.key, binding);
      const contract = byKey.get(binding.key);
      if (contract === undefined) {
        push(
          check,
          binding.file,
          binding.line,
          `${binding.key} is not a defineContracts operation`
        );
        continue;
      }
      const v1 = file.rel.startsWith('v1/') ? file.routePath : '';
      if (v1 !== contract.path) {
        push(
          check,
          binding.file,
          binding.line,
          `${binding.key} is bound in ${file.rel} but the contract path is ${contract.path}`
        );
      }
    }
    if (file.bindings.length > 0) {
      continue;
    }
    if (file.rel === AUTH_CATCHALL) {
      continue;
    }
    const protocol = rawByFile.get(file.rel);
    if (protocol !== undefined) {
      for (const method of protocol.methods) {
        const verb = method.toUpperCase();
        if (!VERBS.has(verb) || declaredVerb(file.methods, verb)) {
          continue;
        }
        // OPTIONS is answered by the shared middleware once the file reaches it.
        // HEAD and the write/read verbs have to be visible in this file.
        if (verb === 'OPTIONS' && answersOptions(file.sf)) {
          continue;
        }
        push(
          check,
          `web-1/src/pages/api/${file.rel}`,
          1,
          `raw protocol ${file.rel} does not declare ${verb} (allowedMethods, method, contestedHTTPMethod, or req.method)`
        );
      }
      continue;
    }
    const legacy =
      file.handlerShaped ||
      file.rel.startsWith('auth/') ||
      file.rel.startsWith('v1/');
    if (!legacy) {
      continue;
    }
    if (!file.handlerShaped && !file.rel.startsWith('auth/')) {
      continue;
    }
    if (file.handlerShaped) {
      const comparable = file.methods.filter(
        method => method !== 'HEAD' && method !== 'OPTIONS'
      );
      if (comparable.length === 0) {
        push(
          check,
          `web-1/src/pages/api/${file.rel}`,
          1,
          'handler method is unresolved (no literal method, contestedHTTPMethod, allowedMethods, or req.method comparison)'
        );
      } else if (comparable.length === 1 && file.eventKey !== undefined) {
        const expected = model.methods.get(file.eventKey)?.toUpperCase();
        const declared = comparable[0]?.toUpperCase();
        if (
          expected !== undefined &&
          declared !== undefined &&
          expected !== declared
        ) {
          push(
            check,
            `web-1/src/pages/api/${file.rel}`,
            1,
            `${file.eventKey} declares ${declared} but API_HTTP_METHODS says ${expected}`
          );
        }
      }
    }
    if (file.handlerShaped || file.rel.startsWith('auth/')) {
      push(
        check,
        `web-1/src/pages/api/${file.rel}`,
        1,
        'handler is not a contract binding, a RAW_PROTOCOLS file, or the Better Auth catch-all'
      );
    }
  }
  for (const contract of model.contracts) {
    if (!bound.has(contract.key)) {
      push(
        check,
        contract.file,
        contract.line,
        `${contract.key} has no defineEndpoint/bindEndpoint handler`
      );
    }
  }
  if (!model.apiFiles.some(file => file.rel === AUTH_CATCHALL)) {
    push(
      check,
      `web-1/src/pages/api/${AUTH_CATCHALL}`,
      1,
      'Better Auth catch-all is missing'
    );
  }
  return check;
}

function checkRegistries(model: Model): CheckResult {
  const check: MutableCheck = newCheck(
    'd1:registries',
    FLOORS.methodKeys,
    'API_HTTP_METHODS keys'
  );
  check.sites = model.methods.size;
  const contractByKey = new Map(
    model.contracts.map(contract => [contract.key, contract])
  );
  const aliasHosts = new Set(model.aliases.values());
  for (const [key, method] of model.methods) {
    const contract = contractByKey.get(key);
    if (contract !== undefined && contract.method !== method) {
      push(
        check,
        '.shared-kernel/domain/http/http-methods.config.ts',
        1,
        `${key} method ${method} does not equal contract.method ${contract.method}`
      );
    }
    if (model.routes.has(key)) {
      continue;
    }
    const target = model.aliases.get(key);
    if (target !== undefined && model.routes.has(target)) {
      continue;
    }
    push(
      check,
      '.shared-kernel/domain/http/http-methods.config.ts',
      1,
      `${key} is in API_HTTP_METHODS but not in ROUTES_API or ROUTE_ALIASES`
    );
  }
  for (const [key, target] of model.aliases) {
    if (!model.routes.has(target)) {
      push(
        check,
        'main/src/application/http/http.endpoints.ts',
        1,
        `alias ${key} → ${target} but ROUTES_API has no ${target}`
      );
    }
  }
  for (const contract of model.contracts) {
    if (!model.methods.has(contract.key)) {
      push(
        check,
        contract.file,
        contract.line,
        `${contract.key} has no API_HTTP_METHODS entry`
      );
    }
    const route = model.routes.get(contract.key);
    const expected = `${model.apiVer}${contract.path}`;
    if (route === undefined) {
      const target = model.aliases.get(contract.key);
      if (target === undefined || !model.routes.has(target)) {
        push(
          check,
          contract.file,
          contract.line,
          `${contract.key} has no ROUTES_API entry`
        );
      }
    } else if (route !== expected) {
      push(
        check,
        '.shared-kernel/domain/routing/routing.config.ts',
        1,
        `${contract.key} route ${route} does not equal ${expected}`
      );
    }
  }
  for (const key of model.routes.keys()) {
    if (contractByKey.has(key) || aliasHosts.has(key)) {
      continue;
    }
    const rawish = [
      'DEV_LOGIN',
      'AUTH_EXCHANGE_CODE',
      'INTERNAL_TRACK_CRAWLER',
      'SALON_STAFF',
    ];
    if (rawish.includes(key)) {
      continue;
    }
    // A route key that is neither a contract nor an alias host is still legal when a raw
    // protocol owns that path. Anything else is a hand-written operation.
    const route = model.routes.get(key) ?? '';
    const ownedByRaw = model.raw.some(item =>
      route.endsWith(fileRoute(item.file).replace(/^v1\//, ''))
    );
    if (!ownedByRaw) {
      push(
        check,
        '.shared-kernel/domain/routing/routing.config.ts',
        1,
        `${key} is in ROUTES_API but is not a contract, an alias host, or a raw protocol`
      );
    }
  }
  return check;
}

function checkValidation(
  model: Model,
  allowlist: Readonly<Record<string, string>>
): CheckResult {
  const check: MutableCheck = newCheck(
    'd1:validation',
    FLOORS.apiFiles,
    'handler files'
  );
  const rawFiles = new Set(model.raw.map(item => item.file));
  let sites = 0;
  const seenNoop = new Set<string>();
  for (const file of model.apiFiles) {
    if (
      file.bindings.length > 0 ||
      rawFiles.has(file.rel) ||
      file.rel === AUTH_CATCHALL
    ) {
      sites += 1;
      continue;
    }
    if (!file.handlerShaped) {
      continue;
    }
    sites += 1;
    const write = file.methods.some(method => WRITE_METHODS.has(method));
    if (!file.validated && !file.noop) {
      push(
        check,
        `web-1/src/pages/api/${file.rel}`,
        1,
        'handler has no request validator (validate / validationFunction)'
      );
    }
    if (file.noop && write) {
      seenNoop.add(file.rel);
      if (allowlist[file.rel] === undefined) {
        push(
          check,
          `web-1/src/pages/api/${file.rel}`,
          1,
          'write-method no-op validator is not on the allowlist'
        );
      }
    }
  }
  for (const rel of Object.keys(allowlist)) {
    if (!seenNoop.has(rel)) {
      push(
        check,
        `web-1/src/pages/api/${rel}`,
        1,
        'allowlist entry is stale: the file is no longer a write-method no-op'
      );
    }
  }
  check.sites = sites;
  return check;
}

function infoTokenText(node: ts.Node, sf: ts.SourceFile): string | undefined {
  if (!ts.isPropertyAccessExpression(node)) {
    return undefined;
  }
  const text = node.getText(sf).replace(/\s+/g, '');
  return /^APP_EVENTS\./.test(text) ? text : undefined;
}

function containsAppEvents(node: ts.Node, sf: ts.SourceFile): boolean {
  if (infoTokenText(node, sf) !== undefined) {
    return true;
  }
  let found = false;
  ts.forEachChild(node, child => {
    if (!found && containsAppEvents(child, sf)) {
      found = true;
    }
  });
  return found;
}

function checkResponses(model: Model): CheckResult {
  const check: MutableCheck = newCheck(
    'd1:response-events',
    FLOORS.respondCalls,
    'respond*/ok/created calls'
  );
  let sites = 0;
  const files = walk(
    model.root,
    'web-1/src',
    rel => rel.endsWith('.ts') && !rel.includes('READONLY-shared-kernel')
  );
  for (const rel of files) {
    const text = readText(model.root, rel);
    if (
      !text.includes('respond') &&
      !text.includes('ok(') &&
      !text.includes('created(')
    ) {
      continue;
    }
    const sf = parseTs(rel, text);
    forEachResponderCall(sf, (call, ref) => {
      const eventArg =
        ref.group === 'B' ? call.arguments[1] : call.arguments[2];
      if (ref.group === 'C' && call.arguments.length < 3) {
        return;
      }
      sites += 1;
      if (
        eventArg !== undefined &&
        ts.isStringLiteralLike(unwrapExpr(eventArg))
      ) {
        push(
          check,
          rel,
          nodeLine(sf, call),
          `${ref.exportName} takes a raw string event; use APP_EVENTS.INFO`
        );
      }
    }, model.root);
    const emitted = boundResponderEmissions(sf, new Map(), model.root);
    emitted.values.forEach((value, index) => {
      sites += 1;
      push(
        check,
        rel,
        emitted.valueLines[index] ?? 1,
        `ok/created takes a raw string event '${value}'; pass APP_EVENTS.INFO (the contract success event)`
      );
    });
  }
  check.sites = sites;
  return check;
}

function checkArgOrder(model: Model): CheckResult {
  const check: MutableCheck = newCheck(
    'd1:respond-arg-order',
    FLOORS.asymmetricCalls,
    'respondForbidden/respondUnauthorized calls'
  );
  let sites = 0;
  const files = walk(
    model.root,
    'web-1/src',
    rel => rel.endsWith('.ts') && !rel.includes('READONLY-shared-kernel')
  );
  for (const rel of files) {
    const text = readText(model.root, rel);
    if (
      !text.includes('respondForbidden') &&
      !text.includes('respondUnauthorized')
    ) {
      continue;
    }
    const sf = parseTs(rel, text);
    forEachResponderCall(sf, (call, ref) => {
      if (
        ref.exportName !== 'respondForbidden' &&
        ref.exportName !== 'respondUnauthorized'
      ) {
        return;
      }
      sites += 1;
      const data = call.arguments[1];
      if (data !== undefined && containsAppEvents(data, sf)) {
        push(
          check,
          rel,
          nodeLine(sf, call),
          `${ref.exportName}(res, event, …) puts APP_EVENTS in the payload slot; the event is the third argument`
        );
      }
    }, model.root);
  }
  check.sites = sites;
  return check;
}

function checkEventLog(model: Model): CheckResult {
  const check: MutableCheck = newCheck(
    'd1:event-log',
    FLOORS.auditEvents,
    'audit event references'
  );
  let sites = 0;
  const allow = model.allowedAudit;
  const note = (file: string, line: number, value: string): void => {
    sites += 1;
    if (!allow.has(value)) {
      push(
        check,
        file,
        line,
        `${value} is not in allowedEventLogTypes (the audit write would be a silent no-op)`
      );
    }
  };
  for (const contract of model.contracts) {
    for (const event of contract.auditEvents) {
      note(contract.file, contract.line, event);
    }
  }
  const schedule = '.shared-kernel/domain/email/email-schedule.config.ts';
  const scheduleSf = source(model.root, schedule);
  const visitSchedule = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && propName(node.name) === 'infoEvent') {
      const value = stringLit(node.initializer);
      if (value !== undefined) {
        note(schedule, nodeLine(scheduleSf, node), value);
      }
    }
    ts.forEachChild(node, visitSchedule);
  };
  visitSchedule(scheduleSf);
  const files = walk(
    model.root,
    'web-1/src',
    rel => rel.endsWith('.ts') && !rel.includes('READONLY-shared-kernel')
  );
  for (const rel of files) {
    const text = readText(model.root, rel);
    if (
      !text.includes('recordAuditEvent_IO') &&
      !text.includes('sendTransactionalEmail')
    ) {
      continue;
    }
    const sf = parseTs(rel, text);
    const visit = (node: ts.Node): void => {
      if (!ts.isCallExpression(node)) {
        ts.forEachChild(node, visit);
        return;
      }
      const callee = unwrapExpr(node.expression);
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (name === 'recordAuditEvent_IO') {
        const arg = node.arguments[0];
        const obj = arg === undefined ? undefined : objectOf(arg);
        const eventName =
          obj === undefined ? undefined : propInit(obj, 'eventName');
        const literal = stringLit(eventName);
        if (literal !== undefined) {
          note(rel, nodeLine(sf, node), literal);
        } else if (
          eventName !== undefined &&
          ts.isPropertyAccessExpression(unwrapExpr(eventName))
        ) {
          const token = unwrapExpr(eventName).getText(sf).replace(/\s+/g, '');
          const value = model.info.get(token);
          if (value !== undefined) {
            note(rel, nodeLine(sf, node), value);
          }
        }
      }
      if (name === 'sendTransactionalEmail') {
        const event = node.arguments[2];
        const literal = stringLit(event);
        if (literal !== undefined) {
          note(rel, nodeLine(sf, node), literal);
        } else if (
          event !== undefined &&
          ts.isPropertyAccessExpression(unwrapExpr(event))
        ) {
          const value = model.info.get(
            unwrapExpr(event).getText(sf).replace(/\s+/g, '')
          );
          if (value !== undefined) {
            note(rel, nodeLine(sf, node), value);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  check.sites = sites;
  return check;
}

function checkInfo(model: Model): CheckResult {
  const check: MutableCheck = newCheck(
    'd1:info-orphans',
    FLOORS.infoEvents,
    'INFO events'
  );
  check.sites = model.info.size;
  const used = usageSets(model.root);
  for (const [token, value] of model.info) {
    const key = token.slice(token.lastIndexOf('.') + 1);
    if (
      !used.quoted.has(value) &&
      !used.quoted.has(key) &&
      !used.dotted.has(key)
    ) {
      push(
        check,
        '.shared-kernel/domain/events/app-events.const.ts',
        1,
        `INFO event ${value} (${token}) is defined but not referenced outside its registry`
      );
    }
  }
  for (const item of hardcodedEvents(model.root)) {
    push(
      check,
      item.file,
      item.line,
      `hardcoded event string '${item.text}' in EVENTS; use Object.values(APP_EVENTS…)`
    );
  }
  for (const file of model.apiFiles) {
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        const text = node.getText(file.sf).replace(/\s+/g, '');
        if (
          /^APP_EVENTS\.INFO\.[A-Z0-9_]+\.[A-Z0-9_]+$/.test(text) &&
          !model.info.has(text)
        ) {
          push(
            check,
            `web-1/src/pages/api/${file.rel}`,
            nodeLine(file.sf, node),
            `${text} is not an INFO event`
          );
        }
        const command =
          /^APP_EVENTS\.(?:COMMANDS|QUERIES)\.[A-Z0-9_]+\.([A-Z0-9_]+)$/.exec(
            text
          ) ?? /^APP_EVENTS\.CONFIRMATIONS\.([A-Z0-9_]+)$/.exec(text);
        if (command?.[1] !== undefined && !model.cqrs.has(command[1])) {
          push(
            check,
            `web-1/src/pages/api/${file.rel}`,
            nodeLine(file.sf, node),
            `${command[1]} is used as a handler event but is not in COMMANDS, QUERIES or CONFIRMATIONS`
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file.sf);
  }
  return check;
}

function checkPermissions(model: Model): CheckResult {
  const check: MutableCheck = newCheck(
    'd1:permissions',
    FLOORS.contracts,
    'contract grants'
  );
  check.sites = model.contracts.length;
  if (!model.wildcard) {
    push(
      check,
      'web-1/src/application/permissions/permissions.seed.ts',
      1,
      'MASTER_ADMIN does not call getAllEvents(); events without an explicit grant have no access'
    );
  }
  const explicit = new Set<string>();
  for (const keys of model.grants.values()) {
    for (const key of keys) {
      explicit.add(key);
    }
  }
  let adminOnly = 0;
  const publicWithoutGrant = new Set(
    model.contracts
      .filter(contract => contract.access === 'PUBLIC_NO_GRANT' && contract.authCheck === false)
      .map(contract => contract.key)
  );
  for (const key of model.cqrs.keys()) {
    if (!explicit.has(key) && !publicWithoutGrant.has(key)) {
      adminOnly += 1;
    }
  }
  if (model.wildcard && adminOnly > ADMIN_ONLY_BASELINE) {
    push(
      check,
      '.shared-kernel/application/role-permissions.ts',
      1,
      `admin-only events increased: ${adminOnly} > baseline ${ADMIN_ONLY_BASELINE}`
    );
  }
  for (const contract of model.contracts) {
    const layers = GRANT_LAYERS[contract.access];
    if (layers === undefined) {
      push(
        check,
        contract.file,
        contract.line,
        `${contract.key} has unknown access ${contract.access}`
      );
      continue;
    }
    const expected = new Set(layers);
    for (const [layer, set] of model.grants) {
      const granted = set.has(contract.key);
      if (granted && !expected.has(layer)) {
        push(
          check,
          '.shared-kernel/application/role-permissions.ts',
          1,
          `${contract.key} is ${contract.access} but ${LAYER_CONST[layer] ?? layer} also grants it (${eventRef(contract)})`
        );
      }
      if (!granted && expected.has(layer)) {
        push(
          check,
          '.shared-kernel/application/role-permissions.ts',
          1,
          `${contract.key} access ${contract.access} is missing from ${LAYER_CONST[layer] ?? layer} (${eventRef(contract)})`
        );
      }
    }
  }
  return check;
}

function checkRate(model: Model): CheckResult {
  const check: MutableCheck = newCheck(
    'd1:rate-limit',
    FLOORS.sensitive,
    'sensitive operations'
  );
  let sites = 0;
  const byKey = new Map(
    model.contracts.map(contract => [contract.key, contract])
  );
  for (const contract of model.contracts) {
    if (
      contract.limiterTier === 'strict' &&
      !model.strictRegionKeys.has(contract.key)
    ) {
      push(
        check,
        'web-1/src/application/http/rate-limit.middleware.ts',
        1,
        `${contract.key} has limiterTier strict but ROUTES_API.${contract.key} is not in the strict-routes region`
      );
    }
  }
  for (const file of model.apiFiles) {
    const keys = file.bindings.map(binding => binding.key);
    const names =
      keys.length > 0
        ? keys
        : file.eventKey === undefined
          ? []
          : [file.eventKey];
    for (const name of names) {
      if (!SENSITIVE_KEYWORDS.test(name)) {
        continue;
      }
      sites += 1;
      const contract = byKey.get(name);
      const rel = `web-1/src/pages/api/${file.rel}`;
      if (SENSITIVE_BASELINE.has(rel)) {
        continue;
      }
      const url = file.rel.startsWith('v1/')
        ? `${model.apiVer}${file.routePath}`
        : `/api/${file.routePath}`;
      if (covered(url, model.strictPrefixes)) {
        continue;
      }
      if (contract?.limiterTier === 'strict') {
        continue;
      }
      push(
        check,
        rel,
        1,
        `${name} matches the sensitive keyword set but limiterTier is not strict and the route is not under STRICT_ENDPOINTS`
      );
    }
  }
  check.sites = sites;
  return check;
}

function checkDtos(model: Model): CheckResult {
  const check: MutableCheck = newCheck(
    'd1:dto-ops',
    FLOORS.dtoEvents,
    'CQRS events with a DTO block'
  );
  check.sites = model.cqrs.size;
  const needed = [
    'REQUEST',
    'RESPONSE',
    'RESPONSE_ERROR',
    'IO_CLIENT_FUNCTION',
  ];
  for (const key of model.cqrs.keys()) {
    const own = model.dtoFields.get(key);
    const alias = own === undefined ? model.aliases.get(key) : undefined;
    const fields =
      own ?? (alias === undefined ? undefined : model.dtoFields.get(alias));
    if (fields === undefined) {
      const why =
        alias === undefined
          ? `${key} has no DTO block (REQUEST/RESPONSE/RESPONSE_ERROR/IO_CLIENT_FUNCTION)`
          : `${key} aliases ${alias} but ${alias} has no DTO block (REQUEST/RESPONSE/RESPONSE_ERROR/IO_CLIENT_FUNCTION)`;
      push(check, '.shared-kernel/models', 1, why);
      continue;
    }
    for (const field of needed) {
      if (fields.has(field)) {
        continue;
      }
      const why =
        alias === undefined
          ? `${key} DTO block is missing ${field}`
          : `${key} aliases ${alias}, whose DTO block is missing ${field}`;
      push(check, '.shared-kernel/models', 1, why);
    }
  }
  return check;
}

export function run(
  root: string,
  allowlist: Readonly<Record<string, string>> = WRITE_NOOP_ALLOWLIST
): CheckResult[] {
  const anchor: MutableCheck = newCheck(
    'd1:anchors',
    ANCHORS.length,
    'named paths'
  );
  assertPaths(
    anchor,
    root,
    ANCHORS.filter(rel => rel.endsWith('.ts'))
  );
  if (
    !walk(root, 'web-1/src/pages/api', () => true).length &&
    anchor.errors.length === 0
  ) {
    anchor.errors.push(
      'path named by the check does not exist: web-1/src/pages/api'
    );
  }
  anchor.sites = ANCHORS.length - anchor.errors.length;
  if (anchor.errors.length > 0) {
    return [anchor];
  }
  const { model } = load(root);
  return [
    anchor,
    checkShape(model),
    checkBindings(model),
    checkRegistries(model),
    checkValidation(model, allowlist),
    checkResponses(model),
    checkArgOrder(model),
    checkEventLog(model),
    checkInfo(model),
    checkPermissions(model),
    checkRate(model),
    checkDtos(model),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('d1-contracts', run(projectRoot())));
}
