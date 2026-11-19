// Static guard for "one owner per success outcome" (TypeScript compiler API, syntax only), used by
// application/outcome-feedback/success-feedback-owner.test.ts on main/src and on fixtures.
// RULE: a success confirmation pushed inside a mutation's `onSuccess` (a `pushNewSnackbar` whose
// colour is 'success', omitted or not a literal; or a `set…Flash(…)` setter) must belong to a
// mutation whose IO call declares `successFeedback: 'screen' | 'silent'`, because the event
// pipeline toasts every successful response event by default. Escape: a comment
// `success-feedback-allow: <reason>` right above the statement.
//
// Linkage (syntactic): onSuccess in `useMutation({...})`, `<x>.mutate(v, {...})`, `mutateAsync` or
// a hook-destructured `<fn>(v, {...})` -> its `mutationFn` (through `useHook()`, same file or a
// relative import). It declares when it holds `successFeedback: 'screen' | 'silent'` or calls an
// IO function defined with it. Unlinkable = a finding. NOT caught: toasts outside onSuccess,
// other on-screen confirmations, events hidden through eventsDisallowedForUI (the dev-only runtime
// net in appSnackbar.possibilities.api.ts reports those).

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type SuccessFeedbackFinding = {
  file: string;
  line: number;
  reason: string;
};

export type SuccessFeedbackScan = {
  /** Success confirmations found inside an onSuccess callback. */
  sites: number;
  /** Of those, linked to a declared owner. */
  declared: number;
  /** Of those, escaped with a reasoned comment. */
  escaped: number;
  findings: SuccessFeedbackFinding[];
};

/** Reads a module's text; returns undefined when it does not exist. */
export type SourceReader = (absPath: string) => string | undefined;

const ESCAPE_WITH_REASON = /success-feedback-allow:[ \t]*[^\s*/]/;
const ESCAPE_MARKER = /success-feedback-allow:/;
const FLASH_SETTER = /^set[A-Z]\w*Flash$/;
const NON_SUCCESS_COLORS = new Set(['error', 'warning', 'info']);
const DECLARED_OWNERS = new Set(['screen', 'silent']);

const parse = (file: string, text: string): ts.SourceFile =>
  ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX
  );

const propName = (node: ts.Node): string | undefined => {
  if (
    (ts.isPropertyAssignment(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isShorthandPropertyAssignment(node)) &&
    (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
  ) {
    return node.name.text;
  }
  return undefined;
};

const calleeName = (call: ts.CallExpression): string | undefined => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  return undefined;
};

const isSuccessSite = (call: ts.CallExpression): boolean => {
  const name = calleeName(call);
  if (name === 'pushNewSnackbar' && ts.isIdentifier(call.expression)) {
    const color = call.arguments[1];
    if (color === undefined) {
      return true;
    }
    return !(
      ts.isStringLiteralLike(color) && NON_SUCCESS_COLORS.has(color.text)
    );
  }
  if (
    name !== undefined &&
    ts.isIdentifier(call.expression) &&
    FLASH_SETTER.test(name)
  ) {
    const arg = call.arguments[0];
    return arg === undefined || arg.kind !== ts.SyntaxKind.FalseKeyword;
  }
  return false;
};

/** Object literal declares a screen/silent owner anywhere inside `node`. */
const containsDeclaration = (node: ts.Node): boolean => {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) {
      return;
    }
    if (
      ts.isPropertyAssignment(n) &&
      propName(n) === 'successFeedback' &&
      ts.isStringLiteralLike(n.initializer) &&
      DECLARED_OWNERS.has(n.initializer.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
};

const findEnclosingOnSuccess = (
  node: ts.Node
): ts.ObjectLiteralExpression | undefined => {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (
      propName(current) === 'onSuccess' &&
      ts.isObjectLiteralExpression(current.parent)
    ) {
      return current.parent;
    }
    current = current.parent;
  }
  return undefined;
};

const enclosingStatement = (node: ts.Node): ts.Node => {
  let current: ts.Node = node;
  while (
    current.parent !== undefined &&
    !ts.isBlock(current.parent) &&
    !ts.isSourceFile(current.parent)
  ) {
    if (ts.isExpressionStatement(current)) {
      return current;
    }
    current = current.parent;
  }
  return current;
};

const escapeOf = (
  sf: ts.SourceFile,
  site: ts.Node
): 'reason' | 'bare' | 'none' => {
  const stmt = enclosingStatement(site);
  const ranges = ts.getLeadingCommentRanges(sf.text, stmt.getFullStart()) ?? [];
  let bare = false;
  for (const range of ranges) {
    const comment = sf.text.slice(range.pos, range.end);
    if (ESCAPE_WITH_REASON.test(comment)) {
      return 'reason';
    }
    if (ESCAPE_MARKER.test(comment)) {
      bare = true;
    }
  }
  return bare ? 'bare' : 'none';
};

type Module = { file: string; sf: ts.SourceFile };

type Resolved = { mod: Module; node: ts.Node };

class Linker {
  private readonly cache = new Map<string, Module | null>();

  constructor(private readonly read: SourceReader) {}

  load(file: string): Module | undefined {
    const cached = this.cache.get(file);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    const text = this.read(file);
    const mod = text === undefined ? null : { file, sf: parse(file, text) };
    this.cache.set(file, mod);
    return mod ?? undefined;
  }

  private resolveModule(from: Module, spec: string): Module | undefined {
    if (!spec.startsWith('.')) {
      return undefined;
    }
    const base = path.resolve(path.dirname(from.file), spec);
    for (const candidate of [
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
    ]) {
      const mod = this.load(candidate);
      if (mod !== undefined) {
        return mod;
      }
    }
    return undefined;
  }

  /** The declaration node a top-level or local name refers to. */
  resolveName(mod: Module, name: string, depth = 0): Resolved | undefined {
    if (depth > 4) {
      return undefined;
    }
    let result: Resolved | undefined;
    const visit = (n: ts.Node): void => {
      if (result !== undefined) {
        return;
      }
      if (ts.isFunctionDeclaration(n) && n.name?.text === name) {
        result = { mod, node: n };
        return;
      }
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === name &&
        n.initializer !== undefined
      ) {
        result = { mod, node: n.initializer };
        return;
      }
      if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name)) {
        for (const element of n.name.elements) {
          if (
            ts.isIdentifier(element.name) &&
            element.name.text === name &&
            n.initializer !== undefined
          ) {
            result = { mod, node: n.initializer };
            return;
          }
        }
      }
      if (
        ts.isImportDeclaration(n) &&
        ts.isStringLiteral(n.moduleSpecifier) &&
        n.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(n.importClause.namedBindings)
      ) {
        for (const spec of n.importClause.namedBindings.elements) {
          if (spec.name.text === name) {
            const target = this.resolveModule(mod, n.moduleSpecifier.text);
            const exported = (spec.propertyName ?? spec.name).text;
            result =
              target === undefined
                ? undefined
                : this.resolveName(target, exported, depth + 1);
            return;
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(mod.sf);
    return result;
  }

  /** `useMutation({...})` object returned or built inside a hook body. */
  mutationOptionsOf(
    resolved: Resolved
  ): { mod: Module; options: ts.ObjectLiteralExpression } | undefined {
    let options: ts.ObjectLiteralExpression | undefined;
    const visit = (n: ts.Node): void => {
      if (options !== undefined) {
        return;
      }
      if (
        ts.isCallExpression(n) &&
        calleeName(n) === 'useMutation' &&
        n.arguments[0] !== undefined &&
        ts.isObjectLiteralExpression(n.arguments[0])
      ) {
        options = n.arguments[0];
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(resolved.node);
    return options === undefined ? undefined : { mod: resolved.mod, options };
  }

  /** mutationFn declares a screen/silent owner, inline or on its IO endpoint. */
  mutationFnDeclares(
    mod: Module,
    options: ts.ObjectLiteralExpression
  ): boolean {
    const prop = options.properties.find(p => propName(p) === 'mutationFn');
    if (prop === undefined) {
      return false;
    }
    if (containsDeclaration(prop)) {
      return true;
    }
    const calls: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        calls.push(n.expression.text);
      }
      if (
        ts.isPropertyAssignment(n) &&
        n.initializer !== undefined &&
        ts.isIdentifier(n.initializer)
      ) {
        calls.push(n.initializer.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(prop);
    return calls.some(name => {
      const resolved = this.resolveName(mod, name);
      return (
        resolved !== undefined &&
        ts.isCallExpression(resolved.node) &&
        containsDeclaration(resolved.node)
      );
    });
  }

  /** The hook call a mutation receiver (`x` in `x.mutate`) was created by. */
  hookOfReceiver(mod: Module, receiver: string): Resolved | undefined {
    const init = this.resolveName(mod, receiver);
    if (init === undefined || !ts.isCallExpression(init.node)) {
      return undefined;
    }
    if (calleeName(init.node) === 'useMutation') {
      return init;
    }
    const hookName = calleeName(init.node);
    return hookName === undefined
      ? undefined
      : this.resolveName(init.mod, hookName);
  }
}

const receiverName = (call: ts.CallExpression): string | undefined => {
  const callee = call.expression;
  if (
    ts.isPropertyAccessExpression(callee) &&
    (callee.name.text === 'mutate' || callee.name.text === 'mutateAsync')
  ) {
    const target = callee.expression;
    if (ts.isIdentifier(target)) {
      return target.text;
    }
    if (ts.isPropertyAccessExpression(target)) {
      return target.name.text;
    }
    return undefined;
  }
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  return undefined;
};

const ownerDeclared = (
  linker: Linker,
  mod: Module,
  owner: ts.ObjectLiteralExpression
): boolean | 'unlinked' => {
  const parent = owner.parent;
  if (!ts.isCallExpression(parent)) {
    return 'unlinked';
  }
  if (calleeName(parent) === 'useMutation' && parent.arguments[0] === owner) {
    return linker.mutationFnDeclares(mod, owner);
  }
  if (parent.arguments[1] !== owner) {
    return 'unlinked';
  }
  const receiver = receiverName(parent);
  if (receiver === undefined) {
    return 'unlinked';
  }
  const hook = linker.hookOfReceiver(mod, receiver);
  if (hook === undefined) {
    return 'unlinked';
  }
  const options = linker.mutationOptionsOf(hook);
  if (options === undefined) {
    return 'unlinked';
  }
  return linker.mutationFnDeclares(options.mod, options.options);
};

/** Scan the given entry files; imports are read through `read`. */
export function scanSuccessFeedbackOwners(
  files: readonly string[],
  read: SourceReader,
  displayRoot = ''
): SuccessFeedbackScan {
  const linker = new Linker(read);
  const scan: SuccessFeedbackScan = {
    sites: 0,
    declared: 0,
    escaped: 0,
    findings: [],
  };
  for (const file of files) {
    const mod = linker.load(file);
    if (mod === undefined) {
      continue;
    }
    const { sf } = mod;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && isSuccessSite(n)) {
        const owner = findEnclosingOnSuccess(n);
        if (owner !== undefined) {
          scan.sites += 1;
          const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          const shown = displayRoot ? path.relative(displayRoot, file) : file;
          const escape = escapeOf(sf, n);
          if (escape === 'reason') {
            scan.escaped += 1;
          } else if (escape === 'bare') {
            scan.findings.push({
              file: shown,
              line,
              reason: 'success-feedback-allow: needs a reason after the colon',
            });
          } else {
            const declared = ownerDeclared(linker, mod, owner);
            if (declared === true) {
              scan.declared += 1;
            } else {
              scan.findings.push({
                file: shown,
                line,
                reason:
                  declared === 'unlinked'
                    ? 'success confirmation in onSuccess whose mutation cannot be linked to its IO call: declare successFeedback on the call or add `// success-feedback-allow: <reason>`'
                    : "success confirmation in onSuccess while the IO call does not declare successFeedback 'screen' | 'silent': the event toast fires too (pick ONE owner)",
              });
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return scan;
}

/** Every .ts/.tsx source under `root`, tests and the kernel copy excluded. */
export function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'READONLY-shared-kernel' ||
          entry.name.startsWith('.')
        ) {
          continue;
        }
        walk(path.join(dir, entry.name));
      } else if (
        /\.(ts|tsx)$/.test(entry.name) &&
        !/\.test\.(ts|tsx)$/.test(entry.name) &&
        !entry.name.endsWith('.d.ts')
      ) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out;
}

export const readSource: SourceReader = absPath => {
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return undefined;
  }
};
