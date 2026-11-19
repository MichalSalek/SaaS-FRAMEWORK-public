// AST helpers shared by the TypeScript audit tools: comment markers and import resolution.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

interface Lexed {
  readonly kind: 'comment' | 'string';
  readonly start: number;
  readonly end: number;
}

/**
 * Comment and string/template-literal-content ranges of a file, from the compiler's scanner with
 * a brace stack, so a `}` closing a template expression continues the template while an ordinary
 * `}` stays code.
 */
function lex(fileName: string, text: string): Lexed[] {
  const out: Lexed[] = [];
  const variant = fileName.endsWith('.tsx')
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    variant,
    text
  );
  const stack: ('brace' | 'template')[] = [];
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    let start = scanner.getTokenStart();
    let end = scanner.getTokenEnd();
    if (
      token === ts.SyntaxKind.CloseBraceToken &&
      stack.at(-1) === 'template'
    ) {
      stack.pop();
      token = scanner.reScanTemplateToken(false);
      start = scanner.getTokenStart();
      end = scanner.getTokenEnd();
    } else if (token === ts.SyntaxKind.CloseBraceToken) {
      stack.pop();
    } else if (token === ts.SyntaxKind.OpenBraceToken) {
      stack.push('brace');
    }
    switch (token) {
      case ts.SyntaxKind.SingleLineCommentTrivia:
      case ts.SyntaxKind.MultiLineCommentTrivia:
        out.push({ kind: 'comment', start, end });
        break;
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        out.push({ kind: 'string', start: start + 1, end: end - 1 });
        break;
      case ts.SyntaxKind.TemplateHead:
        out.push({ kind: 'string', start: start + 1, end: end - 2 });
        stack.push('template');
        break;
      case ts.SyntaxKind.TemplateMiddle:
        out.push({ kind: 'string', start: start + 1, end: end - 2 });
        stack.push('template');
        break;
      case ts.SyntaxKind.TemplateTail:
        out.push({ kind: 'string', start: start + 1, end: end - 1 });
        break;
      default:
        break;
    }
    token = scanner.scan();
  }
  return out;
}

/**
 * Same text with comments AND string/template literal content blanked (newlines and offsets
 * kept), so a regex over it sees only code.
 *
 * DECISION: the brace stack is load-bearing. A first version re-scanned EVERY `}` as a template
 * continuation, so after an ordinary closing brace it blanked real code up to the next backtick
 * (measured: `function a() { return 1; }\nconst x = getStripe();` lost the second line).
 * `_lib.ts` `blankProse` delegates here.
 */
export function codeOnly(fileName: string, text: string): string {
  const chars = text.split('');
  for (const range of lex(fileName, text)) {
    for (let i = range.start; i < range.end; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') {
        chars[i] = ' ';
      }
    }
  }
  return chars.join('');
}

/** Comment text per 1-based line (a block comment is attributed to every line it spans). */
export function commentsByLine(
  fileName: string,
  text: string
): Map<number, string> {
  const out = new Map<number, string>();
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lineStarts.push(i + 1);
    }
  }
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo + 1;
  };
  for (const range of lex(fileName, text)) {
    if (range.kind !== 'comment') {
      continue;
    }
    const first = lineOf(range.start);
    text
      .slice(range.start, range.end)
      .split('\n')
      .forEach((part, i) => {
        const line = first + i;
        out.set(line, `${out.get(line) ?? ''} ${part}`);
      });
  }
  return out;
}

export type MarkerState = 'reason' | 'bare' | 'none';

/**
 * State of an escape marker (`<marker>: <reason>`) in the COMMENTS of lines [from, to]. A marker
 * followed only by spaces or the end of a block comment is `bare`; a marker inside a string
 * literal is not a comment and does not count.
 */
export function markerIn(
  comments: ReadonlyMap<number, string>,
  marker: string,
  from: number,
  to: number
): MarkerState {
  let state: MarkerState = 'none';
  for (let line = Math.max(1, from); line <= to; line++) {
    const text = comments.get(line);
    if (text === undefined) {
      continue;
    }
    let at = text.indexOf(`${marker}:`);
    while (at !== -1) {
      const rest = text
        .slice(at + marker.length + 1)
        .replace(/\*\/.*$/, '')
        .trim();
      if (rest !== '') {
        return 'reason';
      }
      state = 'bare';
      at = text.indexOf(`${marker}:`, at + 1);
    }
  }
  return state;
}

/** 1-based line of a node's first token. */
export function nodeLine(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** Strips parentheses, `as`, `satisfies`, `!` and `<T>` wrappers. */
export function unwrapExpr(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

/** Static name of a property (identifier, string literal or no-substitution template key). */
export function propName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** Named property of an object literal (property assignment or shorthand), last one wins. */
export function objectProp(
  obj: ts.ObjectLiteralExpression,
  name: string
): ts.ObjectLiteralElementLike | undefined {
  let found: ts.ObjectLiteralElementLike | undefined;
  for (const prop of obj.properties) {
    if (
      (ts.isPropertyAssignment(prop) ||
        ts.isShorthandPropertyAssignment(prop)) &&
      propName(prop.name) === name
    ) {
      found = prop;
    }
  }
  return found;
}

/** Import binding: local name → module specifier and the name exported there. */
export interface ImportBinding {
  readonly specifier: string;
  readonly imported: string;
}

export function importBindings(sf: ts.SourceFile): Map<string, ImportBinding> {
  const out = new Map<string, ImportBinding>();
  for (const stmt of sf.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      continue;
    }
    const specifier = stmt.moduleSpecifier.text;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        out.set(el.name.text, {
          specifier,
          imported: (el.propertyName ?? el.name).text,
        });
      }
    }
  }
  return out;
}

/** Workspace-relative alias prefixes → directories (from the workspace tsconfig `paths`). */
export type AliasMap = readonly (readonly [string, string])[];

const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

/** Resolves a module specifier from a repo-relative file to a repo-relative source file. */
export function resolveModule(
  root: string,
  fromRel: string,
  specifier: string,
  aliases: AliasMap
): string | undefined {
  let base: string | undefined;
  if (specifier.startsWith('.')) {
    base = path.posix.join(path.posix.dirname(fromRel), specifier);
  } else {
    for (const [prefix, dir] of aliases) {
      if (specifier.startsWith(prefix)) {
        base = path.posix.join(dir, specifier.slice(prefix.length));
        break;
      }
    }
  }
  if (base === undefined) {
    return undefined;
  }
  for (const ext of ['', ...EXTENSIONS]) {
    const candidate = `${base}${ext}`;
    const abs = path.join(root, candidate);
    if (
      existsSync(abs) &&
      statSync(abs).isFile() &&
      /\.tsx?$/.test(candidate)
    ) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Paths a specifier can name, in resolution order, without reading the disk. A `.js` specifier
 * maps to the TypeScript source next to it. Existence is `resolvesToModule`'s job.
 */
export function moduleCandidates(
  fromRel: string,
  specifier: string,
  aliases: AliasMap
): readonly string[] {
  const from = fromRel.replace(/\\/g, '/');
  let base: string | undefined;
  if (specifier.startsWith('.')) {
    base = path.posix.normalize(
      path.posix.join(path.posix.dirname(from), specifier)
    );
  } else {
    for (const [prefix, dir] of aliases) {
      if (specifier.startsWith(prefix)) {
        base = path.posix.normalize(
          path.posix.join(
            dir.replace(/\\/g, '/'),
            specifier.slice(prefix.length)
          )
        );
        break;
      }
    }
  }
  if (
    base === undefined ||
    base.startsWith('..') ||
    path.posix.isAbsolute(base)
  ) {
    return [];
  }
  if (/\.tsx?$/.test(base)) {
    return [base];
  }
  if (/\.[cm]?js$/.test(base)) {
    const stripped = base.replace(/\.[cm]?js$/, '');
    return [`${stripped}.ts`, `${stripped}.tsx`];
  }
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
}

/**
 * First candidate that is a file under `scanRoot`. Order is `.ts`, `.tsx`, `/index.ts`,
 * `/index.tsx` (same as `moduleCandidates`). A directory does not count.
 */
function firstExistingFile(
  scanRoot: string,
  candidates: readonly string[]
): string | undefined {
  for (const candidate of candidates) {
    const abs = path.join(scanRoot, candidate);
    if (existsSync(abs) && statSync(abs).isFile()) {
      return candidate.replace(/\\/g, '/');
    }
  }
  return undefined;
}

/**
 * True when the specifier resolves to `canonicalRel` inside `scanRoot`.
 * The resolved file is the first candidate that exists there. That file has to be the
 * canonical path, so `define-endpoint/index.ts` is not `define-endpoint.ts`.
 * A missing module is rejected; fixtures must provide their own module stub.
 * Test: tests/audit/tools/_ts.test.ts (index lookalike, canonical file, .ts over directory,
 * missing file; not package exports or `.d.ts`).
 */
export function resolvesToModule(
  fromRel: string,
  specifier: string,
  aliases: AliasMap,
  canonicalRel: string,
  scanRoot: string
): boolean {
  const target = canonicalRel.replace(/\\/g, '/');
  const candidates = moduleCandidates(fromRel, specifier, aliases);
  const selected = firstExistingFile(scanRoot, candidates);
  return selected === target;
}

/** True for test files and declaration files. */
export function isTestOrDecl(rel: string): boolean {
  return (
    rel.endsWith('.d.ts') ||
    /\.test\.tsx?$/.test(rel) ||
    /\.spec\.tsx?$/.test(rel)
  );
}
