// Calls of the response helpers. A local name counts only when it is a value import from
// web-1/src/application/http/http.responses.utils.ts, a namespace access on that import, or a
// same-file const / destructure alias of one of those. A lookalike module, a comment, a string,
// and a local function that happens to share the name are not responders.
import ts from 'typescript';
import { WEB1_ALIASES } from './stripe';
import { resolvesToModule, unwrapExpr } from './_ts';

export const CANONICAL_RESPONSES = 'web-1/src/application/http/http.responses.utils.ts';

export type ResponderGroup = 'B' | 'C';

export interface ResponderRef {
  readonly exportName: string;
  readonly group: ResponderGroup;
}

/** Group B: the event is argument 2. Group C: the event is argument 3 (it has a default). */
const RESPONDER_GROUP = new Map<string, ResponderGroup>([
  ['respondBadRequest', 'B'],
  ['respondNotFound', 'B'],
  ['respondTooManyRequests', 'B'],
  ['respondNotAcceptable', 'B'],
  ['respondSuccess', 'C'],
  ['respondCreated', 'C'],
  ['respondForbidden', 'C'],
  ['respondUnauthorized', 'C'],
]);

interface Scope {
  readonly parent: Scope | undefined;
  readonly names: Map<string, ResponderRef | null>;
  readonly namespaces: Map<string, boolean>;
}

function blankScope(parent: Scope | undefined): Scope {
  return { parent, names: new Map(), namespaces: new Map() };
}

function fileRel(sf: ts.SourceFile): string {
  return sf.fileName.replace(/\\/g, '/');
}

function lookupName(scope: Scope, name: string): ResponderRef | null | undefined {
  for (let current: Scope | undefined = scope; current !== undefined; current = current.parent) {
    if (current.names.has(name)) {
      return current.names.get(name) ?? null;
    }
  }
  return undefined;
}

function lookupNs(scope: Scope, name: string): boolean {
  for (let current: Scope | undefined = scope; current !== undefined; current = current.parent) {
    const flag = current.namespaces.get(name);
    if (flag !== undefined) {
      return flag;
    }
  }
  return false;
}

function classify(expr: ts.Expression, scope: Scope): ResponderRef | null {
  const node = unwrapExpr(expr);
  if (ts.isIdentifier(node)) {
    return lookupName(scope, node.text) ?? null;
  }
  if (!ts.isPropertyAccessExpression(node)) {
    return null;
  }
  const obj = unwrapExpr(node.expression);
  if (!ts.isIdentifier(obj) || !lookupNs(scope, obj.text)) {
    return null;
  }
  const group = RESPONDER_GROUP.get(node.name.text);
  return group === undefined ? null : { exportName: node.name.text, group };
}

function bindAlias(
  scope: Scope,
  name: ts.BindingName,
  init: ts.Expression | undefined,
  lookupScope: Scope
): void {
  if (ts.isIdentifier(name)) {
    scope.names.set(name.text, init === undefined ? null : classify(init, lookupScope));
    scope.namespaces.set(name.text, false);
    return;
  }
  if (ts.isObjectBindingPattern(name)) {
    const expr = init === undefined ? undefined : unwrapExpr(init);
    const fromNs =
      expr !== undefined && ts.isIdentifier(expr) && lookupNs(lookupScope, expr.text);
    for (const el of name.elements) {
      if (!ts.isBindingElement(el)) {
        continue;
      }
      if (fromNs && ts.isIdentifier(el.name) && el.dotDotDotToken === undefined) {
        const key =
          el.propertyName !== undefined && ts.isIdentifier(el.propertyName)
            ? el.propertyName.text
            : el.name.text;
        const group = RESPONDER_GROUP.get(key);
        scope.names.set(
          el.name.text,
          group === undefined ? null : { exportName: key, group }
        );
        scope.namespaces.set(el.name.text, false);
        continue;
      }
      bindAlias(scope, el.name, undefined, lookupScope);
    }
    return;
  }
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) {
      bindAlias(scope, el.name, undefined, lookupScope);
    }
  }
}

function responderOf(expr: ts.Expression, scope: Scope): ResponderRef | undefined {
  const callee = unwrapExpr(expr);
  if (ts.isIdentifier(callee)) {
    return lookupName(scope, callee.text) ?? undefined;
  }
  if (!ts.isPropertyAccessExpression(callee)) {
    return undefined;
  }
  const obj = unwrapExpr(callee.expression);
  if (!ts.isIdentifier(obj) || !lookupNs(scope, obj.text)) {
    return undefined;
  }
  const group = RESPONDER_GROUP.get(callee.name.text);
  return group === undefined ? undefined : { exportName: callee.name.text, group };
}

function seedImports(sf: ts.SourceFile, scope: Scope, scanRoot: string): void {
  const from = fileRel(sf);
  for (const stmt of sf.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      stmt.importClause?.isTypeOnly === true ||
      !ts.isStringLiteral(stmt.moduleSpecifier) ||
      !resolvesToModule(
        from,
        stmt.moduleSpecifier.text,
        WEB1_ALIASES,
        CANONICAL_RESPONSES,
        scanRoot
      )
    ) {
      continue;
    }
    const named = stmt.importClause?.namedBindings;
    if (named === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(named)) {
      scope.namespaces.set(named.name.text, true);
      continue;
    }
    for (const el of named.elements) {
      if (el.isTypeOnly) {
        continue;
      }
      const exported = (el.propertyName ?? el.name).text;
      const group = RESPONDER_GROUP.get(exported);
      if (group !== undefined) {
        scope.names.set(el.name.text, { exportName: exported, group });
      }
    }
  }
}

function visitFunction(fn: ts.FunctionLikeDeclaration, scope: Scope, visit: (node: ts.Node, scope: Scope) => void): void {
  const child = blankScope(scope);
  if (
    fn.name !== undefined &&
    ts.isIdentifier(fn.name) &&
    !ts.isFunctionDeclaration(fn) &&
    !ts.isMethodDeclaration(fn)
  ) {
    child.names.set(fn.name.text, null);
    child.namespaces.set(fn.name.text, false);
  }
  for (const param of fn.parameters) {
    bindAlias(child, param.name, undefined, child);
  }
  if (fn.body !== undefined) {
    visit(fn.body, child);
  }
}

function hoistLocals(statements: readonly ts.Statement[], scope: Scope): void {
  for (const stmt of statements) {
    if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
      stmt.name !== undefined
    ) {
      scope.names.set(stmt.name.text, null);
      scope.namespaces.set(stmt.name.text, false);
    }
  }
}

/** Every call whose callee resolves to an imported response helper. */
export function forEachResponderCall(
  sf: ts.SourceFile,
  onCall: (call: ts.CallExpression, ref: ResponderRef) => void,
  scanRoot: string
): void {
  const visit = (node: ts.Node, scope: Scope): void => {
    if (ts.isBlock(node) || ts.isModuleBlock(node)) {
      const child = blankScope(scope);
      hoistLocals(node.statements, child);
      for (const stmt of node.statements) {
        visit(stmt, child);
      }
      return;
    }
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      visitFunction(node, scope, visit);
      return;
    }
    if (ts.isImportDeclaration(node)) {
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      if (node.initializer !== undefined) {
        visit(node.initializer, scope);
      }
      bindAlias(scope, node.name, node.initializer, scope);
      return;
    }
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      visit(node.expression, scope);
      const child = blankScope(scope);
      if (ts.isVariableDeclarationList(node.initializer)) {
        for (const decl of node.initializer.declarations) {
          bindAlias(child, decl.name, undefined, child);
        }
      } else {
        visit(node.initializer, child);
      }
      visit(node.statement, child);
      return;
    }
    if (ts.isForStatement(node)) {
      const child = blankScope(scope);
      if (node.initializer !== undefined) {
        if (ts.isVariableDeclarationList(node.initializer)) {
          for (const decl of node.initializer.declarations) {
            if (decl.initializer !== undefined) {
              visit(decl.initializer, scope);
            }
            bindAlias(child, decl.name, decl.initializer, scope);
          }
        } else {
          visit(node.initializer, scope);
        }
      }
      if (node.condition !== undefined) {
        visit(node.condition, child);
      }
      if (node.incrementor !== undefined) {
        visit(node.incrementor, child);
      }
      visit(node.statement, child);
      return;
    }
    if (ts.isCatchClause(node)) {
      const child = blankScope(scope);
      if (node.variableDeclaration !== undefined) {
        bindAlias(child, node.variableDeclaration.name, undefined, child);
      }
      visit(node.block, child);
      return;
    }
    if (ts.isCallExpression(node)) {
      const ref = responderOf(node.expression, scope);
      if (ref !== undefined) {
        onCall(node, ref);
      }
    }
    ts.forEachChild(node, child => visit(child, scope));
  };

  const root = blankScope(undefined);
  seedImports(sf, root, scanRoot);
  hoistLocals(sf.statements, root);
  for (const stmt of sf.statements) {
    visit(stmt, root);
  }
}
