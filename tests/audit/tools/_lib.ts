// Shared helpers for the TypeScript audit tools.
//
// DECISION: the tools are TypeScript run through tsx, not awk/grep. The shell guards depended on
// GNU awk (`BEGINFILE`) and on a UTF-8 locale; on a clean ubuntu with mawk and LC_ALL=C they failed
// or, worse, went green. Node reads files as UTF-8 regardless of the locale and parses TypeScript
// with the compiler's own scanner, so a comment or a string literal never counts as code.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { codeOnly } from './_ts';

/**
 * Repository root: `AUDIT_ROOT_OVERRIDE` (tests point a tool at a mini tree) or the location of
 * this file, never git (an inherited GIT_DIR from a submodule push points elsewhere).
 */
export function projectRoot(): string {
  const override = process.env.AUDIT_ROOT_OVERRIDE;
  if (override !== undefined && override !== '') {
    return path.resolve(override);
  }
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..'
  );
}

/** Read a target repository without inheriting the caller hook's repository or index. */
export function gitRepositoryEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Git's `rev-parse --local-env-vars`; transport settings remain available.
  for (const key of [
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CONFIG',
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT',
    'GIT_OBJECT_DIRECTORY',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_IMPLICIT_WORK_TREE',
    'GIT_GRAFT_FILE',
    'GIT_INDEX_FILE',
    'GIT_NO_REPLACE_OBJECTS',
    'GIT_REPLACE_REF_BASE',
    'GIT_PREFIX',
    'GIT_SHALLOW_FILE',
    'GIT_COMMON_DIR',
  ]) {
    delete env[key];
  }
  return env;
}

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** Result of one check inside a tool: findings plus the number of sites it inspected. */
export interface CheckResult {
  readonly name: string;
  readonly findings: Finding[];
  /** Sites inspected (call sites, models, keys …), compared with the floor. */
  readonly sites: number;
  /** Minimum sites for a meaningful run; below it the check fails (anchor moved, root wrong). */
  readonly minSites: number;
  readonly what: string;
  /** Problems with the check's own inputs (missing root, dead allowlist path). */
  readonly errors: string[];
}

export function newCheck(
  name: string,
  minSites: number,
  what: string
): CheckResult {
  return { name, findings: [], sites: 0, minSites, what, errors: [] };
}

/** Mutable view used while a check runs. */
export type MutableCheck = {
  -readonly [K in keyof CheckResult]: CheckResult[K];
};

export function readText(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), 'utf8');
}

/** Asserts that every path literal a check names exists; a dead anchor is an error, not a skip. */
export function assertPaths(
  check: MutableCheck,
  root: string,
  rels: readonly string[]
): void {
  for (const rel of rels) {
    if (!existsSync(path.join(root, rel))) {
      check.errors.push(`path named by the check does not exist: ${rel}`);
    }
  }
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'out',
  'dist',
  'build',
  '.git',
  'coverage',
]);

/** Recursive file walk under a root directory (relative paths, sorted), skipping build output. */
export function walk(
  root: string,
  relDir: string,
  accept: (rel: string) => boolean
): string[] {
  const out: string[] = [];
  const start = path.join(root, relDir);
  if (!existsSync(start) || !statSync(start).isDirectory()) {
    return out;
  }
  const visit = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          visit(path.join(abs, entry.name));
        }
        continue;
      }
      const rel = path
        .relative(root, path.join(abs, entry.name))
        .split(path.sep)
        .join('/');
      if (accept(rel)) {
        out.push(rel);
      }
    }
  };
  visit(start);
  return out.sort();
}

/** 1-based line of a character offset. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

/** Parses a TypeScript/TSX file with the compiler (no type checker). */
export function parseTs(fileName: string, text: string): ts.SourceFile {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind
  );
}

/**
 * Same text with comments AND the content of string/template literals replaced by spaces (quotes,
 * newlines and offsets kept), so a regex over the result sees only code. Prose in a comment or a
 * test name inside a string can neither trip nor satisfy a check. Implemented by `codeOnly` in
 * `_ts.ts` (scanner plus a brace stack, so an ordinary `}` is never mistaken for the end of a
 * template expression).
 */
export function blankProse(fileName: string, text: string): string {
  return codeOnly(fileName, text);
}

/** Prints the results of a tool's checks and returns the process exit code. */
export function report(tool: string, checks: readonly CheckResult[]): number {
  let failed = 0;
  console.log(`== ${tool} ==`);
  for (const check of checks) {
    const floorBroken = check.sites < check.minSites;
    const bad =
      check.findings.length > 0 || check.errors.length > 0 || floorBroken;
    const mark = bad ? '✗' : '✓';
    console.log(
      `${mark} ${check.name}: ${check.sites} ${check.what} inspected, ${check.findings.length} finding(s)`
    );
    for (const error of check.errors) {
      console.log(`  ✗ ERROR ${error}`);
    }
    if (floorBroken) {
      console.log(
        `  ✗ ERROR presence floor: ${check.sites} < ${check.minSites} ${check.what} (anchor moved or root wrong)`
      );
    }
    for (const finding of check.findings) {
      console.log(`  ✗ ${finding.file}:${finding.line}  ${finding.message}`);
    }
    if (bad) {
      failed++;
    }
  }
  if (failed > 0) {
    console.log(`✗ ${tool} FAILED: ${failed} of ${checks.length} check(s)`);
    return 1;
  }
  console.log(`✓ ${tool} passed (${checks.length} checks)`);
  return 0;
}
