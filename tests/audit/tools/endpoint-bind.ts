// Bindings of defineEndpoint / bindEndpoint. A local function with the same name, a type-only
// import, a comment or a string is not a binding. The factory has to be a value import that
// resolves to web-1/src/application/http/define-endpoint.ts (named, aliased, namespace, relative,
// or a same-file const alias). A lookalike filename or a define-endpoint directory is not that file.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { walk } from './_lib';
import { WEB1_ALIASES } from './stripe';
import { nodeLine, propName, resolvesToModule, unwrapExpr } from './_ts';

export const CANONICAL_DEFINE_ENDPOINT = 'web-1/src/application/http/define-endpoint.ts';

export type FactoryKind =
  | 'defineEndpoint'
  | 'bindEndpoint'
  | 'defineEndpointSwitch';

const FACTORY_KINDS = new Set<string>([
  'defineEndpoint',
  'bindEndpoint',
  'defineEndpointSwitch',
]);

export interface FactoryCallees {
  /** Local name of a value-imported factory (after `as`). Mutable so a same-file alias joins it. */
  readonly byLocal: Map<string, FactoryKind>;
  /** Namespace import (`import * as ep from '…define-endpoint'`). */
  readonly namespaces: ReadonlySet<string>;
}

function isFactoryKind(name: string): name is FactoryKind {
  return FACTORY_KINDS.has(name);
}

function fileRel(sf: ts.SourceFile): string {
  return sf.fileName.replace(/\\/g, '/');
}

/** Value imports of the canonical endpoint factory. Type-only imports are ignored. */
export function factoryCallees(sf: ts.SourceFile, scanRoot: string): FactoryCallees {
  const byLocal = new Map<string, FactoryKind>();
  const namespaces = new Set<string>();
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
        CANONICAL_DEFINE_ENDPOINT,
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
      namespaces.add(named.name.text);
      continue;
    }
    for (const el of named.elements) {
      if (el.isTypeOnly) {
        continue;
      }
      const imported = (el.propertyName ?? el.name).text;
      if (isFactoryKind(imported)) {
        byLocal.set(el.name.text, imported);
      }
    }
  }
  return { byLocal, namespaces };
}

export function callFactory(
  expr: ts.Expression,
  callees: FactoryCallees
): FactoryKind | undefined {
  const callee = unwrapExpr(expr);
  if (ts.isIdentifier(callee)) {
    return callees.byLocal.get(callee.text);
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callees.namespaces.has(callee.expression.text) &&
    isFactoryKind(callee.name.text)
  ) {
    return callee.name.text;
  }
  return undefined;
}

/** `DOMAIN_CONTRACTS.KEY` → `KEY`. Anything else is unresolved. */
export function contractKeyFrom(arg: ts.Expression | undefined): string | undefined {
  if (arg === undefined) {
    return undefined;
  }
  const expr = unwrapExpr(arg);
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    /_CONTRACTS$/.test(expr.expression.text)
  ) {
    return expr.name.text;
  }
  return undefined;
}

export type SuccessEventRef =
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'token'; readonly token: string };

const INFO_TOKEN = /^APP_EVENTS\.INFO\.[A-Z0-9_]+\.[A-Z0-9_]+$/;

function successRefs(node: ts.Expression, sf: ts.SourceFile): SuccessEventRef[] {
  const expr = unwrapExpr(node);
  if (!ts.isArrayLiteralExpression(expr)) {
    return [];
  }
  const out: SuccessEventRef[] = [];
  for (const el of expr.elements) {
    const item = unwrapExpr(el);
    if (ts.isStringLiteralLike(item)) {
      out.push({ kind: 'value', value: item.text });
      continue;
    }
    if (ts.isPropertyAccessExpression(item)) {
      const token = item.getText(sf).replace(/\s+/g, '');
      if (INFO_TOKEN.test(token)) {
        out.push({ kind: 'token', token });
      }
    }
  }
  return out;
}

/**
 * Operation key → successEvents, from every `defineContracts({...})` under `.shared-kernel`.
 * The call is an identifier named `defineContracts`; a comment or a string is not a call.
 */
export function successEventsByKey(
  root: string
): Map<string, readonly SuccessEventRef[]> {
  const out = new Map<string, readonly SuccessEventRef[]>();
  const files = walk(
    root,
    '.shared-kernel',
    rel => rel.endsWith('.ts') && !rel.includes('READONLY-shared-kernel')
  );
  for (const rel of files) {
    const text = readFileSync(path.join(root, rel), 'utf8');
    if (!text.includes('defineContracts')) {
      continue;
    }
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'defineContracts' &&
        node.arguments[0] !== undefined &&
        ts.isObjectLiteralExpression(unwrapExpr(node.arguments[0]))
      ) {
        const obj = unwrapExpr(node.arguments[0]);
        if (!ts.isObjectLiteralExpression(obj)) {
          return;
        }
        for (const prop of obj.properties) {
          if (!ts.isPropertyAssignment(prop)) {
            continue;
          }
          const key = propName(prop.name);
          const body = unwrapExpr(prop.initializer);
          if (key === undefined || !ts.isObjectLiteralExpression(body)) {
            continue;
          }
          for (const field of body.properties) {
            if (
              !ts.isPropertyAssignment(field) ||
              propName(field.name) !== 'successEvents'
            ) {
              continue;
            }
            out.set(key, successRefs(field.initializer, sf));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

const RESPONDERS = new Set(['ok', 'created']);

function absorbResponders(binding: ts.ObjectBindingPattern, into: Set<string>): void {
  for (const el of binding.elements) {
    if (!ts.isBindingElement(el)) {
      continue;
    }
    const key =
      el.propertyName !== undefined && ts.isIdentifier(el.propertyName)
        ? el.propertyName.text
        : ts.isIdentifier(el.name)
          ? el.name.text
          : undefined;
    if (key !== undefined && RESPONDERS.has(key) && ts.isIdentifier(el.name)) {
      into.add(el.name.text);
    }
  }
}

interface ResponderEnv {
  responders: Set<string>;
  scope: string | undefined;
}

function isResponderCall(expr: ts.Expression, env: ResponderEnv): boolean {
  const callee = unwrapExpr(expr);
  if (ts.isIdentifier(callee)) {
    return env.responders.has(callee.text);
  }
  return (
    ts.isPropertyAccessExpression(callee) &&
    env.scope !== undefined &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === env.scope &&
    RESPONDERS.has(callee.name.text)
  );
}

/**
 * INFO tokens and raw success-event values passed to a bound `ok` / `created`.
 * When the event argument is not a literal, every `successEvents` entry of that contract counts:
 * the parameter type is that union, and `ok` forwards it to `respondSuccess`.
 */
export function boundResponderEmissions(
  sf: ts.SourceFile,
  success: ReadonlyMap<string, readonly SuccessEventRef[]>,
  scanRoot: string
): { readonly tokens: string[]; readonly values: string[]; readonly valueLines: number[] } {
  const callees = factoryCallees(sf, scanRoot);
  const tokens: string[] = [];
  const values: string[] = [];
  const valueLines: number[] = [];
  if (callees.byLocal.size === 0 && callees.namespaces.size === 0) {
    return { tokens, values, valueLines };
  }

  const infoToken = (node: ts.Node): string | undefined => {
    if (!ts.isPropertyAccessExpression(node)) {
      return undefined;
    }
    const text = node.getText(sf).replace(/\s+/g, '');
    return INFO_TOKEN.test(text) ? text : undefined;
  };
  const tokensIn = (node: ts.Node, into: string[]): void => {
    const token = infoToken(node);
    if (token !== undefined) {
      into.push(token);
      return;
    }
    ts.forEachChild(node, child => tokensIn(child, into));
  };

  const emitArg = (
    arg: ts.Expression | undefined,
    key: string | undefined,
    at: ts.Node
  ): void => {
    if (arg === undefined) {
      return;
    }
    const found: string[] = [];
    tokensIn(arg, found);
    if (found.length > 0) {
      tokens.push(...found);
      return;
    }
    const literal = unwrapExpr(arg);
    if (ts.isStringLiteralLike(literal)) {
      values.push(literal.text);
      valueLines.push(nodeLine(sf, at));
      return;
    }
    if (key === undefined) {
      return;
    }
    for (const ref of success.get(key) ?? []) {
      if (ref.kind === 'token') {
        tokens.push(ref.token);
      } else {
        values.push(ref.value);
      }
    }
  };

  const rememberAlias = (name: ts.BindingName, init: ts.Expression, env: ResponderEnv): void => {
    const expr = unwrapExpr(init);
    if (ts.isIdentifier(name)) {
      const aliases =
        (ts.isIdentifier(expr) && env.responders.has(expr.text)) ||
        (ts.isPropertyAccessExpression(expr) &&
          env.scope !== undefined &&
          ts.isIdentifier(expr.expression) &&
          expr.expression.text === env.scope &&
          RESPONDERS.has(expr.name.text));
      if (aliases) {
        env.responders.add(name.text);
        return;
      }
      env.responders.delete(name.text);
      if (env.scope === name.text) {
        env.scope = undefined;
      }
      return;
    }
    if (
      ts.isObjectBindingPattern(name) &&
      ts.isIdentifier(expr) &&
      env.scope === expr.text
    ) {
      absorbResponders(name, env.responders);
    }
  };

  const scanFn = (fn: ts.ArrowFunction | ts.FunctionExpression, key: string | undefined): void => {
    const env: ResponderEnv = { responders: new Set(), scope: undefined };
    const param = fn.parameters[0];
    if (param !== undefined) {
      if (ts.isIdentifier(param.name)) {
        env.scope = param.name.text;
      } else if (ts.isObjectBindingPattern(param.name)) {
        absorbResponders(param.name, env.responders);
      }
    }
    const visit = (node: ts.Node, current: ResponderEnv): void => {
      if (
        node !== fn &&
        (ts.isArrowFunction(node) ||
          ts.isFunctionExpression(node) ||
          ts.isFunctionDeclaration(node))
      ) {
        const child: ResponderEnv = {
          responders: new Set(current.responders),
          scope: current.scope,
        };
        for (const param of node.parameters) {
          if (ts.isIdentifier(param.name)) {
            child.responders.delete(param.name.text);
            if (child.scope === param.name.text) {
              child.scope = undefined;
            }
          }
        }
        if (node.body !== undefined) {
          visit(node.body, child);
        }
        return;
      }
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        visit(node.initializer, current);
        rememberAlias(node.name, node.initializer, current);
        return;
      }
      if (ts.isCallExpression(node) && isResponderCall(node.expression, current)) {
        emitArg(node.arguments[1], key, node);
      }
      ts.forEachChild(node, child => visit(child, current));
    };
    if (fn.body !== undefined) {
      visit(fn.body, env);
    }
  };

  const handleOf = (
    arg: ts.Expression | undefined
  ): ts.ArrowFunction | ts.FunctionExpression | undefined => {
    if (arg === undefined) {
      return undefined;
    }
    const expr = unwrapExpr(arg);
    if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
      return expr;
    }
    if (!ts.isObjectLiteralExpression(expr)) {
      return undefined;
    }
    for (const prop of expr.properties) {
      if (!ts.isPropertyAssignment(prop) || propName(prop.name) !== 'handle') {
        continue;
      }
      const fn = unwrapExpr(prop.initializer);
      if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
        return fn;
      }
    }
    return undefined;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const init = unwrapExpr(node.initializer);
      if (ts.isIdentifier(init) && ts.isIdentifier(node.name)) {
        const kind = callees.byLocal.get(init.text);
        if (kind !== undefined) {
          callees.byLocal.set(node.name.text, kind);
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const kind = callFactory(node.expression, callees);
      if (kind === 'defineEndpoint' || kind === 'bindEndpoint') {
        const key = contractKeyFrom(node.arguments[0]);
        const handle =
          kind === 'defineEndpoint'
            ? handleOf(node.arguments[1])
            : handleOf(node.arguments[1]);
        if (handle !== undefined) {
          scanFn(handle, key);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { tokens, values, valueLines };
}
