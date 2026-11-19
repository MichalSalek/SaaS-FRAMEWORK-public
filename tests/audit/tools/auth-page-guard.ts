// auth-page-guard — every page under main/src/pages/app/** mounts through a client guard shell
// (AUTHORIZATION guard).
//
// Successor of tests/audit/auth-page-guard.sh. The Next proxy checks no session; /app/** is
// protected CLIENT-side by the guard shells (AppLayout, AdminLayout / AdminPageLayout) while the
// backend stays the real boundary.
//
// Rule: every page file (.ts/.tsx, tests excluded) under main/src/pages/app reaches a guard in its
// own code or in a module it imports DIRECTLY from main/src/UI/features or main/src/UI/layouts
// (static import, re-export or `dynamic(() => import(...))`). A guard is reached when the file USES
// in code (JSX tag, call or reference) a binding whose name and module both match GUARDS below;
// each guard module is asserted to exist and export that name.
// Allowlist: pure redirect stubs with a reason; an entry that reaches a guard is a finding.
// DECISION: a TS tool and not an ESLint rule: the verdict depends on OTHER files, and an ESLint
// rule reading other files breaks the per-file cache (stale cached verdicts).

// DECISION: a TS tool and not an ESLint rule: the verdict depends on OTHER files (the imported
// feature composition), and an ESLint rule reading other files breaks the per-file cache (an edit
// in the composition would leave the page's cached verdict stale).
import { existsSync, readdirSync, statSync } from 'node:fs';
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
import { isTestOrDecl } from './_ts';

export const PAGES_ROOT = 'main/src/pages/app';
export const UI_ROOTS = [
  'main/src/UI/features/',
  'main/src/UI/layouts/',
] as const;

/** Guard module file → exported binding whose use mounts the view through a guard. */
export const GUARDS: Readonly<Record<string, string>> = {
  'main/src/UI/layouts/AppLayout.composition.tsx': 'AppLayoutComposition',
  'main/src/UI/layouts/AdminPageLayout.composition.tsx':
    'AdminPageLayoutComposition',
  'main/src/UI/layouts/AdminLayout.composition.tsx': 'AdminLayoutComposition',
  'main/src/UI/layouts/useAppRole.ts': 'useAppRole',
  'main/src/UI/layouts/guards/useRecoveryGuard.ts': 'useRecoveryGuard',
};

/** Pages intentionally NOT behind a guard shell, path → reason. */
export const ALLOWLIST: Readonly<Record<string, string>> = {
  // Pure client redirect stub: renders null and router.replace()s into the discovery feed (or
  // /app when EXPLORE_ENABLED is off); the destination is guarded, a shell would only flash chrome.
  'main/src/pages/app/stylists/index.tsx': 'redirect stub to a guarded route',
  // Permanent redirect stub: the activity timeline moved into the account page; renders null and
  // router.replace()s there to keep old links alive. The destination is guarded.
  'main/src/pages/app/user/activity.tsx': 'redirect stub to a guarded route',
};

/** Floor, measured 2026-10-23: 58 pages (56 in scope + 2 allowlisted). */
export const MIN_SITES = 45;

const SOURCE = /\.tsx?$/;

/** Module specifiers a file imports or re-exports, static and dynamic `import('…')`. */
function specifiers(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Files a relative specifier stands for: the file itself, or every top-level source of a directory module. */
function resolveFiles(
  root: string,
  fromRel: string,
  specifier: string
): string[] {
  if (!specifier.startsWith('.')) {
    return [];
  }
  const base = path.posix.join(path.posix.dirname(fromRel), specifier);
  const out: string[] = [];
  for (const candidate of [`${base}.tsx`, `${base}.ts`, base]) {
    const abs = path.join(root, candidate);
    if (existsSync(abs) && statSync(abs).isFile() && SOURCE.test(candidate)) {
      out.push(candidate);
    }
  }
  const absDir = path.join(root, base);
  if (existsSync(absDir) && statSync(absDir).isDirectory()) {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = `${base}/${entry.name}`;
      if (entry.isFile() && SOURCE.test(entry.name) && !isTestOrDecl(rel)) {
        out.push(rel);
      }
    }
  }
  return out;
}

/** Module file a relative import specifier resolves to (file or directory index). */
function resolveModuleFile(
  root: string,
  fromRel: string,
  specifier: string
): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const base = path.posix.join(path.posix.dirname(fromRel), specifier);
  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
  ]) {
    const abs = path.join(root, candidate);
    if (existsSync(abs) && statSync(abs).isFile() && SOURCE.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isInImportOrExport(node: ts.Node): boolean {
  for (
    let current: ts.Node | undefined = node.parent;
    current !== undefined;
    current = current.parent
  ) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) {
      return true;
    }
  }
  return false;
}

/** Guard bindings a file USES in code: local names imported from a guard module, referenced outside the import. */
export function usedGuards(
  root: string,
  rel: string,
  sf: ts.SourceFile
): string[] {
  const locals = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      continue;
    }
    const bindings = stmt.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) {
      continue;
    }
    const target = resolveModuleFile(root, rel, stmt.moduleSpecifier.text);
    const guardName = target === undefined ? undefined : GUARDS[target];
    if (guardName === undefined) {
      continue;
    }
    for (const el of bindings.elements) {
      if (
        (el.propertyName ?? el.name).text === guardName &&
        !el.isTypeOnly &&
        !stmt.importClause?.isTypeOnly
      ) {
        locals.set(el.name.text, guardName);
      }
    }
  }
  const used = new Set<string>();
  if (locals.size === 0) {
    return [];
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      locals.has(node.text) &&
      !isInImportOrExport(node)
    ) {
      used.add(locals.get(node.text) ?? node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...used];
}

/** True when the module exports a declaration (or a local re-export) with the given name. */
function exportsName(sf: ts.SourceFile, name: string): boolean {
  for (const stmt of sf.statements) {
    const exported = ts.canHaveModifiers(stmt)
      ? (ts.getModifiers(stmt) ?? []).some(
          m => m.kind === ts.SyntaxKind.ExportKeyword
        )
      : false;
    if (
      exported &&
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
      stmt.name?.text === name
    ) {
      return true;
    }
    if (exported && ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          return true;
        }
      }
    }
    if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause !== undefined &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      if (stmt.exportClause.elements.some(el => el.name.text === name)) {
        return true;
      }
    }
  }
  return false;
}

/** Where a page reaches a guard: `<file>:<binding>` entries (empty = unprotected). */
export function guardEvidence(root: string, page: string): string[] {
  const pageSf = parseTs(page, readText(root, page));
  const evidence = usedGuards(root, page, pageSf).map(
    name => `${page}:${name}`
  );
  const seen = new Set<string>();
  for (const specifier of specifiers(pageSf)) {
    for (const rel of resolveFiles(root, page, specifier)) {
      if (seen.has(rel) || !UI_ROOTS.some(prefix => rel.startsWith(prefix))) {
        continue;
      }
      seen.add(rel);
      const sf = parseTs(rel, readText(root, rel));
      evidence.push(...usedGuards(root, rel, sf).map(name => `${rel}:${name}`));
    }
  }
  return evidence;
}

export function checkAuthPageGuard(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'auth-page-guard',
    MIN_SITES,
    'pages under /app/**'
  );
  assertPaths(check, root, [
    PAGES_ROOT,
    ...Object.keys(GUARDS),
    ...Object.keys(ALLOWLIST),
  ]);
  if (check.errors.length > 0) {
    return check;
  }
  for (const [rel, name] of Object.entries(GUARDS)) {
    if (!exportsName(parseTs(rel, readText(root, rel)), name)) {
      check.errors.push(
        `guard module ${rel} no longer exports ${name}: update GUARDS before trusting this check`
      );
    }
  }
  const pages = walk(
    root,
    PAGES_ROOT,
    rel => SOURCE.test(rel) && !isTestOrDecl(rel)
  );
  for (const page of pages) {
    check.sites++;
    const evidence = guardEvidence(root, page);
    if (ALLOWLIST[page] !== undefined) {
      if (evidence.length > 0) {
        check.findings.push({
          file: page,
          line: 1,
          message: `allowlisted as unguarded but reaches a guard (${evidence.join(', ')}): remove the ALLOWLIST entry`,
        });
      }
      continue;
    }
    if (evidence.length === 0) {
      check.findings.push({
        file: page,
        line: 1,
        message:
          'NO GUARD REACHABLE: mount the view through <AppLayoutComposition> / <AdminPageLayoutComposition> (in the page or the feature module it imports), or allowlist it with a reason if it is a conscious public/redirect route',
      });
    }
  }
  return check;
}

export function run(root: string): CheckResult[] {
  return [checkAuthPageGuard(root)];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('auth-page-guard', run(projectRoot())));
}
