// better-auth-contract — the two fields Better Auth SETS AT RUNTIME on `ctx.context` but does not
// declare in its types (`returned`, `responseHeaders`), and the one accessor allowed to read them.
//
// Successor of tests/audit/better-auth-dispatch-contract.sh. The hook runner (`dist/api/dispatch.mjs`)
// writes them before `hooks.after`; the failed-login audit (CANNOT_LOGIN) and the native token
// bridge stand on them. If they disappear nothing turns red by itself, so this guard fails LOUDLY.
// Checks, each with its own floor:
//  1./2. runtime-returned / runtime-response-headers: the INSTALLED `better-auth/dist/api/
//     dispatch.mjs` still ASSIGNS `<x>.context.returned = ...` / `<x>.context.responseHeaders = ...`
//     (parsed JavaScript). Package or file missing or empty is an error ("cannot measure" is red).
//  3. accessor-only: no TS/TSX under web-1/src, main/src or .shared-kernel (tests included, READONLY
//     kernel copies skipped) reads those fields except `better-auth-dispatch-context.ts`. AST only
//     (a comment or test NAME quoting `ctx.context.returned` never counts); dotted, optional,
//     bracket and destructured reads are caught. Floor: 2 call sites of the accessors.
// No escape marker: the fields are either there or login is broken.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
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
import { importBindings, nodeLine, unwrapExpr } from './_ts';

export const ACCESSOR =
  'web-1/src/application/auth/better-auth/better-auth-dispatch-context.ts';
export const SCAN_ROOTS = ['web-1/src', 'main/src', '.shared-kernel'] as const;
const FIELDS = ['returned', 'responseHeaders'] as const;
type Field = (typeof FIELDS)[number];
const ACCESSOR_FNS = new Set([
  'getDispatchReturned',
  'getDispatchResponseHeaders',
]);

/** Floors, measured 2026-10-23 (better-auth 1.7.x): 2 assignments per field, 3 accessor calls. */
export const FLOORS = { assignment: 1, accessorCalls: 2 } as const;

/** Repo-relative path of the installed dispatch.mjs (node_modules chain from web-1/), if any. */
export function findDispatch(root: string): string | undefined {
  let dir = path.join(root, 'web-1');
  for (;;) {
    const candidate = path.join(
      dir,
      'node_modules',
      'better-auth',
      'dist',
      'api',
      'dispatch.mjs'
    );
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function installedVersion(dispatchAbs: string): string {
  const pkg = path.join(path.dirname(dispatchAbs), '..', '..', 'package.json');
  try {
    const data: unknown = JSON.parse(readFileSync(pkg, 'utf8'));
    if (
      typeof data === 'object' &&
      data !== null &&
      'version' in data &&
      typeof data.version === 'string'
    ) {
      return data.version;
    }
  } catch {
    // Version is informational only.
  }
  return '?';
}

/** `<x>.context` (optional chain included), the object the runtime fields hang on. */
function isContextAccess(node: ts.Expression): boolean {
  const expr = unwrapExpr(node);
  return ts.isPropertyAccessExpression(expr) && expr.name.text === 'context';
}

/** Field name read from `<x>.context` by a property or element access, if it is one of FIELDS. */
function fieldRead(node: ts.Node): Field | undefined {
  let name: string | undefined;
  let object: ts.Expression | undefined;
  if (ts.isPropertyAccessExpression(node)) {
    name = node.name.text;
    object = node.expression;
  } else if (ts.isElementAccessExpression(node)) {
    const arg = unwrapExpr(node.argumentExpression);
    name =
      ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)
        ? arg.text
        : undefined;
    object = node.expression;
  }
  if (name === undefined || object === undefined || !isContextAccess(object)) {
    return undefined;
  }
  return (FIELDS as readonly string[]).includes(name)
    ? (name as Field)
    : undefined;
}

const RUNTIME_CONSEQUENCE: Record<Field, string> = {
  returned: 'the CANNOT_LOGIN audit stops recording failed logins, SILENTLY',
  responseHeaders:
    'the token bridge (exchange-code variant C) cannot rewrite the location header, so the native shell gets no token and login dies',
};

/** Assignment sites of `<x>.context.<field> = …` in the installed dispatch.mjs, per field. */
export function runtimeAssignments(text: string): Record<Field, number[]> {
  const sf = ts.createSourceFile(
    'dispatch.mjs',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const out: Record<Field, number[]> = { returned: [], responseHeaders: [] };
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const field = fieldRead(unwrapExpr(node.left));
      if (field !== undefined) {
        out[field].push(nodeLine(sf, node));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function checkRuntime(root: string): CheckResult[] {
  const checks: MutableCheck[] = [
    newCheck(
      'better-auth:runtime-returned',
      FLOORS.assignment,
      'context.returned assignments'
    ),
    newCheck(
      'better-auth:runtime-response-headers',
      FLOORS.assignment,
      'context.responseHeaders assignments'
    ),
  ];
  const dispatch = findDispatch(root);
  const fail = (message: string): CheckResult[] => {
    for (const check of checks) {
      check.errors.push(message);
    }
    return checks;
  };
  if (dispatch === undefined) {
    return fail(
      'better-auth/dist/api/dispatch.mjs not found in the node_modules chain from web-1/: CANNOT MEASURE the contract (missing npm install in web-1/, or the package layout changed)'
    );
  }
  const text = readFileSync(dispatch, 'utf8');
  if (text.trim() === '') {
    return fail(`${dispatch} is EMPTY, the read is not trustworthy`);
  }
  const version = installedVersion(dispatch);
  const sites = runtimeAssignments(text);
  FIELDS.forEach((field, i) => {
    const check = checks[i];
    if (check === undefined) {
      return;
    }
    check.sites = sites[field].length;
    if (sites[field].length === 0) {
      check.findings.push({
        file: path.relative(root, dispatch).split(path.sep).join('/'),
        line: 1,
        message: `ctx.context.${field}: NO assignment in dispatch.mjs (better-auth ${version}): ${RUNTIME_CONSEQUENCE[field]}. Pin better-auth to the last working version OR migrate ${ACCESSOR} to the new API and update this guard`,
      });
    }
  });
  return checks;
}

function isReadonlyCopy(rel: string): boolean {
  return rel.split('/').some(segment => segment.startsWith('READONLY-'));
}

export function checkAccessorOnly(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'better-auth:accessor-only',
    FLOORS.accessorCalls,
    'getDispatchReturned/getDispatchResponseHeaders call sites'
  );
  assertPaths(check, root, [ACCESSOR, ...SCAN_ROOTS]);
  if (check.errors.length > 0) {
    return check;
  }
  for (const scanRoot of SCAN_ROOTS) {
    const files = walk(
      root,
      scanRoot,
      rel =>
        /\.tsx?$/.test(rel) && !rel.endsWith('.d.ts') && !isReadonlyCopy(rel)
    );
    for (const rel of files) {
      const text = readText(root, rel);
      if (
        !text.includes('returned') &&
        !text.includes('responseHeaders') &&
        !text.includes('getDispatch')
      ) {
        continue;
      }
      const sf = parseTs(rel, text);
      const imports = importBindings(sf);
      const isAccessor = rel === ACCESSOR;
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const callee = unwrapExpr(node.expression);
          if (
            ts.isIdentifier(callee) &&
            ACCESSOR_FNS.has(imports.get(callee.text)?.imported ?? callee.text)
          ) {
            check.sites++;
          }
        }
        if (!isAccessor) {
          const direct = fieldRead(node);
          if (direct !== undefined) {
            check.findings.push({
              file: rel,
              line: nodeLine(sf, node),
              message: `direct read of ctx.context.${direct} bypassing the accessor; use getDispatchReturned()/getDispatchResponseHeaders() from ${ACCESSOR} (the fields are not in the library types, so every read is a cast nobody finds at the next bump)`,
            });
          }
          if (
            ts.isVariableDeclaration(node) &&
            ts.isObjectBindingPattern(node.name) &&
            node.initializer !== undefined
          ) {
            if (isContextAccess(node.initializer)) {
              for (const element of node.name.elements) {
                const key = element.propertyName ?? element.name;
                const name =
                  ts.isIdentifier(key) || ts.isStringLiteral(key)
                    ? key.text
                    : undefined;
                if (
                  name !== undefined &&
                  (FIELDS as readonly string[]).includes(name)
                ) {
                  check.findings.push({
                    file: rel,
                    line: nodeLine(sf, element),
                    message: `destructured read of ctx.context.${name} bypassing the accessor ${ACCESSOR}`,
                  });
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return check;
}

export function run(root: string): CheckResult[] {
  return [...checkRuntime(root), checkAccessorOnly(root)];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('better-auth-contract', run(projectRoot())));
}
