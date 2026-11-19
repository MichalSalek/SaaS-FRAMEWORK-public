// d5-cross — typed checks for the shell audits whose rule is a tree, a comment
// policy, or a call graph rather than one in-file pattern. Each check keeps the
// shell's invariant, counts the sites it actually inspects, and treats a marker
// inside a string as text, never as a waiver.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  assertPaths,
  gitRepositoryEnv,
  lineAt,
  newCheck,
  projectRoot,
  readText,
  report,
  walk,
  type CheckResult,
  type MutableCheck,
} from './_lib';

const require = createRequire(import.meta.url);
const commentScan = require('../lib/comment-scan.cjs') as {
  evaluatePolicy: (
    rel: string,
    text: string,
    limit: number
  ) => {
    records: Array<{ tag: string; line: number; text: string }>;
    blocks: number;
    commentLines: number;
    ranges: Array<[number, number]>;
    error?: string;
  } | null;
};

const EVENT_HELPER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../lib/event-reader-writer.mjs'
);

const CODE_DIRS = ['.shared-kernel', 'main/src', 'web-1/src'] as const;
const BLOCK_LIMIT = 15;
const BASELINE_TODO = 7;
const BASELINE_CONSOLE = 21;
const OLD_DECISION =
  /(?:\/\/|\/\*|^(?:[ \t]*\*)|\{?\/\*|#)[ \t]*DECISION[ \t]*(?:\(|—|–)/;
const NEW_DECISION = /DECISION(?:\s*\[[a-z0-9-]+\])?:/;
const EXCLUDE =
  /(^|\/)(node_modules|\.next|out|dist|coverage|READONLY-shared-kernel|js-client|migrations|_fixtures)\/|\.(md|mdx|json|txt|snap|sql|svg|map|lock|tsbuildinfo|png|jpg|jpeg|webp|gif|ico|woff2?|ttf|pdf)$/;
const GENERATED = /(^|\/)generated\/|\.generated\./;
const STALE_BRANDS = ['NailGallery', 'Nail Gallery', 'Nail-Gallery', 'NailBook'];
const SATELLITE_DOCS = ['docs/README.md', 'docs/README.pl.md'];
const SUPPRESS_ALLOW = [
  'main/src/UI/features/auth/DeleteSelfPage.composition.tsx',
  'main/src/UI/features/admin/AdminNotesPage.composition.tsx',
  'main/src/UI/features/admin/AdminPoliciesPage.composition.tsx',
  'main/src/UI/features/admin/components/TraitsTab.organism.tsx',
  'main/src/UI/features/admin/AdminSupportThreadPage.composition.tsx',
  'main/src/UI/features/admin/AdminModerationPage.composition.tsx',
  'main/src/UI/features/shared/moderation/components/ReportModal.organism.tsx',
];
const SWEEP_ALLOW = [
  'web-1/src/application/startup/cached-counts-backfill.ts',
  'web-1/src/application/startup/cached-counts-backfill-state.ts',
];
const SWEEP_MARKER =
  /\b(?:shouldAttempt[A-Za-z]*|shouldRun[A-Za-z]*Sweep|update[A-Za-z]*Timestamp|update[A-Za-z]*Attempt|recordSweepRun|withSweepTiming|createSweepInterceptor|pg_try_advisory_lock|pg_advisory_unlock)\b/;
const JOB_NAME = /^[A-Za-z0-9_]+Job$/;
const ASSET_REGISTRY = 'main/src/UI/assets/lpAssets.ts';
const VARIANTS_JSON = 'main/src/UI/assets/responsive-asset-variants.json';
const PAGES_DIR = 'main/src/pages';
const NEXT_CONFIG = 'main/next.config.mjs';
const PAGE_SPECIAL = new Set(['_app', '_document', '_error']);

function isRepo(root: string): boolean {
  return existsSync(path.join(root, '.git'));
}

function floor(root: string, repoMin: number, sampleMin = 1): number {
  return isRepo(root) ? repoMin : sampleMin;
}

function push(
  check: MutableCheck,
  file: string,
  line: number,
  message: string
): void {
  check.findings.push({ file, line, message });
}

function visit(node: ts.Node, fn: (node: ts.Node) => void): void {
  fn(node);
  ts.forEachChild(node, child => visit(child, fn));
}

function unwrap(node: ts.Node | undefined): ts.Node | undefined {
  let current = node;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function propName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function relOf(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

function listFiles(root: string, check: MutableCheck): string[] | null {
  if (!isRepo(root)) {
    return walk(root, '.', rel => !EXCLUDE.test(rel));
  }
  const listed = spawnSync(
    'git',
    ['-C', root, 'ls-files', '-z', '--recurse-submodules'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: gitRepositoryEnv() }
  );
  if (listed.status !== 0 || !listed.stdout) {
    check.errors.push('git ls-files failed; the scan does not guess a file list');
    return null;
  }
  return listed.stdout.split('\0').filter(rel => rel !== '' && !EXCLUDE.test(rel));
}

function readIfFile(root: string, rel: string): string | null {
  const abs = path.join(root, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    return null;
  }
  return readFileSync(abs, 'utf8');
}

interface CommentHit {
  readonly line: number;
  readonly text: string;
  readonly start: number;
}

function commentHits(fileName: string, text: string): CommentHit[] {
  const variant = /\.(tsx|jsx)$/.test(fileName)
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, variant, text);
  const out: CommentHit[] = [];
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const start = scanner.getTokenStart();
      out.push({
        line: lineAt(text, start),
        text: text.slice(start, scanner.getTokenEnd()),
        start,
      });
    }
    token = scanner.scan();
  }
  return out;
}

/** `reason` waives; `bare` is itself a finding and does not waive. Strings never match. */
function markerInComments(
  hits: readonly CommentHit[],
  marker: string
): { reason: boolean; bareLines: number[] } {
  let reason = false;
  const bareLines: number[] = [];
  const needle = `${marker}:`;
  for (const hit of hits) {
    const base = hit.line;
    const parts = hit.text.split('\n');
    parts.forEach((part, index) => {
      const at = part.indexOf(needle);
      if (at < 0) {
        return;
      }
      const after = part.slice(at + needle.length);
      if (/\S/.test(after)) {
        reason = true;
      } else {
        bareLines.push(base + index);
      }
    });
  }
  return { reason, bareLines };
}

function inRanges(pos: number, ranges: ReadonlyArray<[number, number]>): boolean {
  return ranges.some(([start, end]) => pos >= start && pos < end);
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

export function checkDecisionFormat(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'decision-format',
    floor(root, 500),
    'comment blocks'
  );
  const files = listFiles(root, check);
  if (!files) {
    return check;
  }
  let markers = 0;
  for (const rel of files) {
    const text = readIfFile(root, rel);
    if (text === null) {
      continue;
    }
    const policy = GENERATED.test(rel) ? null : commentScan.evaluatePolicy(rel, text, BLOCK_LIMIT);
    if (policy?.error) {
      check.errors.push(`${rel}: comment lexer failed (${policy.error})`);
      continue;
    }
    const ranges = policy?.ranges ?? [];
    if (policy) {
      check.sites += policy.blocks;
      for (const record of policy.records) {
        const message =
          record.tag === 'BLOCK'
            ? `comment block longer than ${BLOCK_LIMIT} lines (${record.text})`
            : record.tag === 'SESSION'
              ? `session or plan identifier ${record.text}`
              : record.tag === 'BAN'
                ? `ban on reviewing a decision again (${record.text})`
                : record.tag === 'OWNERDATE'
                  ? `owner tag with a date (${record.text})`
                  : `comment line in Polish`;
        push(check, rel, record.line, message);
      }
    }
    const starts = lineStarts(text);
    const seenMarker = new Set<number>();
    starts.forEach((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1] - 1 : text.length;
      const line = text.slice(start, end);
      if (!NEW_DECISION.test(line)) {
        return;
      }
      const at = line.search(NEW_DECISION);
      if (at >= 0 && inRanges(start + at, ranges) && !seenMarker.has(index)) {
        seenMarker.add(index);
        markers += 1;
      }
    });
    const bareDecision = new Set<number>();
    starts.forEach((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1] - 1 : text.length;
      const line = text.slice(start, end);
      const allowAt = line.indexOf('decision-format-allow:');
      if (allowAt < 0 || !inRanges(start + allowAt, ranges)) {
        return;
      }
      const after = line.slice(allowAt + 'decision-format-allow:'.length);
      if (!/\S/.test(after)) {
        bareDecision.add(index + 1);
      }
    });
    for (const lineNo of bareDecision) {
      push(check, rel, lineNo, 'escape marker without a reason');
    }
    starts.forEach((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1] - 1 : text.length;
      const line = text.slice(start, end);
      const match = OLD_DECISION.exec(line);
      if (!match || match.index === undefined || !inRanges(start + match.index, ranges)) {
        return;
      }
      if (bareDecision.has(index + 1)) {
        return;
      }
      const allowAt = line.indexOf('decision-format-allow:');
      if (allowAt >= 0 && inRanges(start + allowAt, ranges)) {
        const after = line.slice(allowAt + 'decision-format-allow:'.length);
        if (/\S/.test(after)) {
          return;
        }
      }
      push(check, rel, index + 1, 'old DECISION marker');
    });
  }
  if (isRepo(root) && markers < 1000) {
    check.errors.push(
      `current-form DECISION markers in comments: ${markers} < 1000`
    );
  }
  return check;
}

const STALE_NEEDLES = [
  ['nailfolio.com', 'stale domain nailfolio.com'],
  ['@nailfolio.com', 'stale email domain @nailfolio.com'],
  ...STALE_BRANDS.map(brand => [brand, `stale brand ${brand}`] as const),
] as const;

function countStrings(fileName: string, text: string): number {
  if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(fileName)) {
    return scannerStringCount(fileName, text);
  }
  const matches = text.match(/(['"])(?:\\.|(?!\1)[\s\S])*?\1/g);
  return matches ? matches.length : 0;
}

function scannerStringCount(fileName: string, text: string): number {
  const variant = /\.(tsx|jsx)$/.test(fileName)
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, variant, text);
  let count = 0;
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.StringLiteral ||
      token === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      token === ts.SyntaxKind.TemplateHead ||
      token === ts.SyntaxKind.TemplateMiddle ||
      token === ts.SyntaxKind.TemplateTail
    ) {
      count += 1;
    }
    token = scanner.scan();
  }
  return count;
}

export function checkDocsSsot(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'docs-ssot',
    floor(root, 100),
    'string literals in production code'
  );
  if (isRepo(root)) {
    assertPaths(check, root, [...CODE_DIRS, ...SATELLITE_DOCS]);
  }
  for (const dir of CODE_DIRS) {
    const files = walk(root, dir, rel => {
      if (EXCLUDE.test(rel) || rel.includes('/READONLY-shared-kernel/')) {
        return false;
      }
      return !rel.endsWith('.map');
    });
    for (const rel of files) {
      const text = readIfFile(root, rel);
      if (text === null) {
        continue;
      }
      check.sites += countStrings(rel, text);
      const starts = lineStarts(text);
      starts.forEach((start, index) => {
        const end = index + 1 < starts.length ? starts[index + 1] : text.length;
        const line = text.slice(start, end);
        for (const [needle, message] of STALE_NEEDLES) {
          if (line.includes(needle)) {
            push(check, rel, index + 1, message);
          }
        }
      });
    }
  }
  return check;
}

function legacyFiles(root: string, includeTests: boolean): string[] {
  const out: string[] = [];
  for (const dir of CODE_DIRS) {
    out.push(
      ...walk(root, dir, rel => {
        if (!/\.(ts|tsx)$/.test(rel)) {
          return false;
        }
        if (
          rel.includes('/node_modules/') ||
          rel.includes('/.next/') ||
          rel.includes('/js-client/')
        ) {
          return false;
        }
        if (!includeTests && rel.includes('/tests/')) {
          return false;
        }
        return true;
      })
    );
  }
  return out;
}

export function checkLegacyTodo(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'legacy-todo',
    floor(root, 100),
    'comments scanned for TODO/FIXME/HACK/XXX'
  );
  const hits: Array<{ file: string; line: number }> = [];
  for (const rel of legacyFiles(root, true)) {
    const text = readIfFile(root, rel);
    if (text === null) {
      continue;
    }
    const comments = commentHits(rel, text);
    check.sites += comments.length;
    for (const comment of comments) {
      const parts = comment.text.split('\n');
      parts.forEach((part, index) => {
        if (part.includes('PLANS_TODO')) {
          return;
        }
        if (/TODO|FIXME|HACK|XXX/.test(part)) {
          hits.push({ file: rel, line: comment.line + index });
        }
      });
    }
  }
  // Ratchet, same baseline as legacy-code.sh: existing TODOs are tolerated until the count grows.
  if (hits.length > BASELINE_TODO) {
    for (const hit of hits) {
      push(
        check,
        hit.file,
        hit.line,
        `TODO/FIXME/HACK/XXX comment (${hits.length} > baseline ${BASELINE_TODO})`
      );
    }
  }
  return check;
}

function isConsoleCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const expr = unwrap(node.expression);
  if (!expr || !ts.isPropertyAccessExpression(expr)) {
    return false;
  }
  if (expr.name.text !== 'log' && expr.name.text !== 'error') {
    return false;
  }
  const object = unwrap(expr.expression);
  return Boolean(object && ts.isIdentifier(object) && object.text === 'console');
}

export function checkLegacyConsole(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'legacy-console',
    floor(root, 1),
    'console.log/error call expressions'
  );
  const hits: Array<{ file: string; line: number }> = [];
  for (const rel of legacyFiles(root, false)) {
    const text = readIfFile(root, rel);
    if (text === null) {
      continue;
    }
    const source = ts.createSourceFile(
      rel,
      text,
      ts.ScriptTarget.Latest,
      true,
      rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const lines = text.split('\n');
    visit(source, node => {
      if (!isConsoleCall(node)) {
        return;
      }
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      if ((lines[line] ?? '').includes('reportIssue')) {
        return;
      }
      hits.push({ file: rel, line: line + 1 });
    });
  }
  check.sites = hits.length;
  if (hits.length > BASELINE_CONSOLE) {
    for (const hit of hits) {
      push(
        check,
        hit.file,
        hit.line,
        `console.log/error call (${hits.length} > baseline ${BASELINE_CONSOLE})`
      );
    }
  }
  return check;
}

function scriptKind(rel: string): ts.ScriptKind {
  if (rel.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (rel.endsWith('.jsx')) {
    return ts.ScriptKind.JSX;
  }
  if (/\.(js|mjs|cjs)$/.test(rel)) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

export function checkSuppressGlobalError(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'suppress-global-error',
    floor(root, 20),
    'useMutation call expressions'
  );
  if (isRepo(root)) {
    assertPaths(check, root, SUPPRESS_ALLOW);
  }
  const allow = new Set(SUPPRESS_ALLOW);
  for (const rel of walk(root, 'main/src/UI', file => /\.(ts|tsx)$/.test(file))) {
    const text = readIfFile(root, rel);
    if (text === null) {
      continue;
    }
    const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(rel));
    let mutations = 0;
    let onError = false;
    let pushSnack = false;
    let suppressed = false;
    visit(source, node => {
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        if (callee && ts.isIdentifier(callee) && callee.text === 'useMutation') {
          mutations += 1;
        }
      }
      if (ts.isIdentifier(node) && node.text === 'onError') {
        onError = true;
      }
      if (
        (ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
        node.text === 'pushNewSnackbar' &&
        !ts.isStringLiteral(node)
      ) {
        pushSnack = true;
      }
      if (ts.isIdentifier(node) && node.text === 'pushNewSnackbar') {
        pushSnack = true;
      }
      if (
        ts.isPropertyAssignment(node) &&
        propName(node.name) === 'suppressGlobalError'
      ) {
        const value = unwrap(node.initializer);
        if (value && value.kind === ts.SyntaxKind.TrueKeyword) {
          suppressed = true;
        }
      }
    });
    check.sites += mutations;
    const marker = markerInComments(commentHits(rel, text), 'suppress-global-error-allow');
    for (const line of marker.bareLines) {
      push(check, rel, line, 'escape marker without a reason');
    }
    if (mutations === 0 || !onError || !pushSnack || suppressed || marker.reason || allow.has(rel)) {
      continue;
    }
    push(
      check,
      rel,
      1,
      'useMutation onError calls pushNewSnackbar without suppressGlobalError: true'
    );
  }
  return check;
}

interface EventReport {
  readSitesWithEventFilter: number;
  violations: Array<{ file: string; line: number; keys: string[] }>;
  badEscapes: string[];
}

export function checkEventReaderWriter(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'event-reader-writer',
    floor(root, 1),
    'EventLog reads filtered by event'
  );
  if (!existsSync(EVENT_HELPER)) {
    check.errors.push(`AST helper missing: ${EVENT_HELPER}`);
    return check;
  }
  const run = spawnSync(process.execPath, [EVENT_HELPER, root], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = run.stdout ?? '';
  let reportJson: EventReport;
  try {
    reportJson = JSON.parse(stdout) as EventReport;
  } catch {
    check.errors.push(
      `event-reader-writer helper did not return JSON (exit ${run.status ?? 'none'})`
    );
    return check;
  }
  check.sites = reportJson.readSitesWithEventFilter;
  for (const violation of reportJson.violations) {
    push(
      check,
      relOf(root, violation.file),
      violation.line,
      `klucz(e) bez pisarza: ${violation.keys.join(', ')}`
    );
  }
  for (const bad of reportJson.badEscapes) {
    const splitAt = bad.indexOf(': event-reader-writer-allow:');
    const head = splitAt >= 0 ? bad.slice(0, splitAt) : bad;
    const lineSep = head.lastIndexOf(':');
    const file = lineSep >= 0 ? head.slice(0, lineSep) : head;
    const line = lineSep >= 0 ? Number(head.slice(lineSep + 1)) : 1;
    push(
      check,
      relOf(root, file),
      Number.isFinite(line) ? line : 1,
      'event-reader-writer-allow: bez powodu'
    );
  }
  return check;
}

function isJobCall(node: ts.Node | undefined): boolean {
  const value = unwrap(node);
  if (!value || !ts.isCallExpression(value)) {
    return false;
  }
  const callee = unwrap(value.expression);
  return Boolean(callee && ts.isIdentifier(callee) && callee.text === 'defineScheduledJob');
}

function exportedJobs(
  source: ts.SourceFile
): Array<{ name: string; line: number }> {
  const found: Array<{ name: string; line: number }> = [];
  visit(source, node => {
    if (!ts.isVariableStatement(node)) {
      return;
    }
    const exported = (node.modifiers ?? []).some(
      modifier => modifier.kind === ts.SyntaxKind.ExportKeyword
    );
    if (!exported) {
      return;
    }
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !JOB_NAME.test(decl.name.text)) {
        continue;
      }
      if (!isJobCall(decl.initializer)) {
        continue;
      }
      found.push({
        name: decl.name.text,
        line: source.getLineAndCharacterOfPosition(decl.name.getStart(source)).line + 1,
      });
    }
  });
  return found;
}

function registryJobs(source: ts.SourceFile): string[] {
  const names: string[] = [];
  visit(source, node => {
    if (!ts.isPropertyAssignment(node)) {
      return;
    }
    const value = unwrap(node.initializer);
    if (value && ts.isIdentifier(value) && JOB_NAME.test(value.text)) {
      names.push(value.text);
    }
  });
  return names;
}

function sweepStringsAndNames(source: ts.SourceFile): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  const seen = new Set<string>();
  const add = (node: ts.Node, text: string): void => {
    if (!SWEEP_MARKER.test(text)) {
      return;
    }
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const key = `${line}:${text}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    hits.push({ line, text });
  };
  visit(source, node => {
    if (ts.isIdentifier(node)) {
      add(node, node.text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      add(node, node.text);
    }
  });
  return hits;
}

export function checkSweepInterceptor(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'sweep-interceptor',
    floor(root, 10),
    'defineScheduledJob definitions'
  );
  const registryRel = 'web-1/src/application/scheduler/scheduled-jobs.registry.ts';
  if (!existsSync(path.join(root, registryRel))) {
    check.errors.push(`scheduler registry missing: ${registryRel}`);
    return check;
  }
  if (isRepo(root)) {
    assertPaths(check, root, SWEEP_ALLOW);
  }
  const allow = new Set(SWEEP_ALLOW);
  const defined = new Map<string, { file: string; line: number }>();
  const files = walk(root, 'web-1/src', rel => {
    if (!rel.endsWith('.ts') || rel.endsWith('.d.ts') || rel.endsWith('.test.ts')) {
      return false;
    }
    return (
      !rel.includes('/node_modules/') &&
      !rel.includes('/.next/') &&
      !rel.includes('/js-client/') &&
      !rel.includes('/READONLY-shared-kernel/')
    );
  });
  for (const rel of files) {
    const text = readIfFile(root, rel);
    if (text === null) {
      continue;
    }
    const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (!allow.has(rel)) {
      for (const hit of sweepStringsAndNames(source)) {
        push(
          check,
          rel,
          hit.line,
          `hand-rolls scheduling (${hit.text})`
        );
      }
    }
    for (const job of exportedJobs(source)) {
      defined.set(job.name, { file: rel, line: job.line });
      check.sites += 1;
    }
  }
  const registryText = readText(root, registryRel);
  const registrySource = ts.createSourceFile(
    registryRel,
    registryText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const registered = new Set(registryJobs(registrySource));
  for (const [name, where] of defined) {
    if (!registered.has(name)) {
      push(
        check,
        where.file,
        where.line,
        `${name} is not registered in scheduled-jobs.registry.ts`
      );
    }
  }
  for (const name of registered) {
    if (!defined.has(name)) {
      push(check, registryRel, 1, `registry entry ${name} has no defineScheduledJob definition`);
    }
  }
  return check;
}

function assetPathsIn(source: ts.SourceFile): string[] {
  const paths: string[] = [];
  visit(source, node => {
    if (!ts.isStringLiteral(node) || !node.text.startsWith('/img/lp/')) {
      return;
    }
    if (/\.[a-zA-Z0-9]+$/.test(node.text)) {
      paths.push(node.text);
    }
  });
  return paths;
}

export function checkAssetPaths(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'asset-paths',
    floor(root, 20),
    'registry /img/lp/ literals'
  );
  const registryAbs = path.join(root, ASSET_REGISTRY);
  const registryPaths = new Set<string>();
  if (existsSync(registryAbs)) {
    const text = readFileSync(registryAbs, 'utf8');
    const source = ts.createSourceFile(
      ASSET_REGISTRY,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    for (const assetPath of new Set(assetPathsIn(source))) {
      registryPaths.add(assetPath);
      check.sites += 1;
      const disk = path.join(root, 'main/public', assetPath.slice(1));
      if (!existsSync(disk)) {
        push(check, ASSET_REGISTRY, 1, `missing registry asset main/public${assetPath}`);
      }
    }
  } else if (isRepo(root)) {
    check.errors.push(`asset registry missing: ${ASSET_REGISTRY}`);
  }
  for (const rel of walk(root, 'main/src', file => /\.(ts|tsx)$/.test(file))) {
    if (rel === ASSET_REGISTRY) {
      continue;
    }
    const text = readIfFile(root, rel);
    if (text === null) {
      continue;
    }
    const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(rel));
    const marker = markerInComments(commentHits(rel, text), 'asset-paths-allow');
    for (const line of marker.bareLines) {
      push(check, rel, line, 'escape marker without a reason');
    }
    if (marker.reason) {
      continue;
    }
    visit(source, node => {
      if (!ts.isStringLiteral(node) || !node.text.startsWith('/img/lp/')) {
        return;
      }
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      push(
        check,
        rel,
        line,
        `raw /img/lp/ path outside ${ASSET_REGISTRY}`
      );
    });
  }
  const variantsAbs = path.join(root, VARIANTS_JSON);
  if (!existsSync(variantsAbs)) {
    if (isRepo(root)) {
      push(check, VARIANTS_JSON, 1, 'responsive-asset-variants.json is missing');
    }
    return check;
  }
  const json = JSON.parse(readFileSync(variantsAbs, 'utf8')) as Record<
    string,
    { avif?: Array<{ src?: string }>; webp?: Array<{ src?: string }> }
  >;
  for (const [base, entry] of Object.entries(json)) {
    if (!registryPaths.has(base)) {
      push(check, VARIANTS_JSON, 1, `orphan variant set ${base} is not a registry literal`);
    }
    for (const group of [entry.avif ?? [], entry.webp ?? []]) {
      for (const item of group) {
        if (!item.src) {
          continue;
        }
        check.sites += 1;
        if (!existsSync(path.join(root, 'main/public', item.src.slice(1)))) {
          push(check, VARIANTS_JSON, 1, `missing variant ${item.src}`);
        }
      }
    }
  }
  return check;
}

function pageExtensions(text: string): string[] | 'broken' {
  const source = ts.createSourceFile(
    NEXT_CONFIG,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  let found: string[] | undefined;
  let broken = false;
  visit(source, node => {
    if (!ts.isPropertyAssignment(node) || propName(node.name) !== 'pageExtensions') {
      return;
    }
    const init = unwrap(node.initializer);
    if (!init || !ts.isArrayLiteralExpression(init)) {
      broken = true;
      return;
    }
    const exts: string[] = [];
    for (const element of init.elements) {
      const value = unwrap(element);
      if (value && ts.isStringLiteral(value)) {
        exts.push(value.text);
      }
    }
    if (exts.length === 0) {
      broken = true;
    } else if (!found) {
      found = exts;
    }
  });
  if (broken && !found) {
    return 'broken';
  }
  return found ?? ['tsx', 'ts', 'jsx', 'js'];
}

export function checkPagesRouteFiles(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'pages-route-files',
    floor(root, 30),
    'route files under main/src/pages'
  );
  if (!existsSync(path.join(root, PAGES_DIR))) {
    check.errors.push(`pages root missing: ${PAGES_DIR}`);
    return check;
  }
  const configText = readIfFile(root, NEXT_CONFIG);
  if (configText === null) {
    check.errors.push(`Next config missing: ${NEXT_CONFIG}`);
    return check;
  }
  const exts = pageExtensions(configText);
  if (exts === 'broken') {
    check.errors.push('pageExtensions found but no extension string could be parsed');
    return check;
  }
  const files = walk(root, PAGES_DIR, () => true);
  for (const rel of files) {
    const base = path.posix.basename(rel);
    const ext = exts
      .filter(candidate => base.endsWith(`.${candidate}`))
      .sort((a, b) => b.length - a.length)[0];
    if (!ext) {
      continue;
    }
    check.sites += 1;
    const stem = base.slice(0, -(ext.length + 1));
    const relPages = rel.slice(PAGES_DIR.length + 1);
    const dirPart = path.posix.dirname(relPages);
    let reason = '';
    if (/\.(test|spec|stories)\./.test(base)) {
      reason = 'test/spec/story file is served as a public route';
    } else if (dirPart !== '.') {
      for (const seg of dirPart.split('/')) {
        if (seg.startsWith('_')) {
          reason = `directory '${seg}/' is not private in the pages router, its files are public routes`;
          break;
        }
      }
    }
    if (!reason && stem.startsWith('_')) {
      const rootSpecial = dirPart === '.' && PAGE_SPECIAL.has(stem);
      if (!rootSpecial) {
        reason = `underscore file '${base}' is not a Next special file here, it is served as a public route`;
      }
    }
    const text = readIfFile(root, rel) ?? '';
    const marker = markerInComments(commentHits(rel, text), 'pages-route-allow');
    for (const line of marker.bareLines) {
      push(check, rel, line, 'escape marker without a reason');
    }
    if (!reason || marker.reason) {
      continue;
    }
    push(check, rel, 1, reason);
  }
  return check;
}

function shellParts(line: string): { code: string; comment: string } {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i] ?? '';
    if (quote) {
      if (char === '\\' && quote !== "'") {
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) {
      return { code: line.slice(0, i), comment: line.slice(i) };
    }
  }
  return { code: line, comment: '' };
}

function shellWords(segment: string): string[] {
  const words: string[] = [];
  let i = 0;
  while (i < segment.length) {
    while (i < segment.length && /\s/.test(segment[i] ?? '')) {
      i += 1;
    }
    if (i >= segment.length) {
      break;
    }
    const quote = segment[i];
    if (quote === '"' || quote === "'") {
      i += 1;
      let word = '';
      while (i < segment.length && segment[i] !== quote) {
        word += segment[i];
        i += 1;
      }
      i += 1;
      words.push(word);
      continue;
    }
    let word = '';
    while (i < segment.length && !/\s/.test(segment[i] ?? '')) {
      word += segment[i];
      i += 1;
    }
    words.push(word);
  }
  return words;
}

function commandSegments(code: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const char = code[i] ?? '';
    if (quote) {
      current += char;
      if (char === '\\' && quote !== "'") {
        current += code[i + 1] ?? '';
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    const next = code[i + 1];
    if ((char === '&' || char === '|') && next === char) {
      parts.push(current);
      current = '';
      i += 1;
      continue;
    }
    if (
      char === ';' ||
      char === '|' ||
      char === '&' ||
      char === '(' ||
      char === ')' ||
      char === '{' ||
      char === '}'
    ) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function cpSource(words: readonly string[]): string | null {
  let index = 0;
  if (words[0] === 'command' || words[0] === 'sudo') {
    index = 1;
  }
  if (words[index] !== 'cp') {
    return null;
  }
  if (words[index + 1] === '()') {
    return null;
  }
  let recursive = false;
  let source = '';
  for (let i = index + 1; i < words.length; i++) {
    const token = words[i] ?? '';
    if (token === '--') {
      source = words[i + 1] ?? '';
      break;
    }
    if (token.startsWith('-')) {
      if (/[rRa]/.test(token)) {
        recursive = true;
      }
      continue;
    }
    source = token;
    break;
  }
  if (!recursive || source === '') {
    return '';
  }
  return source;
}

export function checkCpNesting(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'cp-nesting',
    floor(root, 4),
    'cp command invocations'
  );
  const scanDir = path.join(root, 'scripts');
  if (!existsSync(scanDir)) {
    check.errors.push('scripts directory is missing');
    return check;
  }
  const files = walk(root, 'scripts', rel => !rel.includes('/node_modules/'));
  for (const rel of files) {
    const text = readIfFile(root, rel);
    if (text === null || text.includes('\0')) {
      continue;
    }
    const lines = text.split('\n');
    let heredoc: string | null = null;
    let prevReason = false;
    lines.forEach((raw, index) => {
      if (heredoc) {
        if (raw.replace(/^\t+/, '') === heredoc) {
          heredoc = null;
        }
        prevReason = false;
        return;
      }
      const opener = raw.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
      const { code, comment } = shellParts(raw);
      const marker = markerInComments(
        comment ? [{ line: 1, text: comment, start: 0 }] : [],
        'cp-nest-allow'
      );
      if (marker.bareLines.length > 0) {
        push(check, rel, index + 1, 'escape marker without a reason');
      }
      const waived = marker.reason || prevReason;
      prevReason = marker.reason;
      if (opener && !/<<</.test(raw)) {
        heredoc = opener[1] ?? null;
      }
      for (const segment of commandSegments(code)) {
        const words = shellWords(segment);
        if (words.length === 0) {
          continue;
        }
        // `cp()` is a definition. Splitting on `(` leaves a bare `cp` token.
        if (words.length === 1 && words[0] === 'cp' && /\bcp\s*\(/.test(code)) {
          continue;
        }
        const source = cpSource(words);
        if (source === null) {
          continue;
        }
        check.sites += 1;
        if (source === '' || source.endsWith('/.') || waived) {
          continue;
        }
        push(
          check,
          rel,
          index + 1,
          `recursive cp copies the directory (${source}) instead of its contents`
        );
      }
    });
  }
  return check;
}

export function run(root: string): CheckResult[] {
  return [
    checkDecisionFormat(root),
    checkDocsSsot(root),
    checkLegacyTodo(root),
    checkLegacyConsole(root),
    checkSuppressGlobalError(root),
    checkEventReaderWriter(root),
    checkSweepInterceptor(root),
    checkAssetPaths(root),
    checkPagesRouteFiles(root),
    checkCpNesting(root),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const wanted = process.argv.slice(2);
  const checks = run(projectRoot());
  const missing = wanted.filter(
    name => !checks.some(check => check.name === name)
  );
  if (missing.length > 0) {
    console.error(`unknown d5-cross check: ${missing.join(', ')}`);
    process.exit(1);
  }
  const selected =
    wanted.length === 0
      ? checks
      : checks.filter(check => wanted.includes(check.name));
  process.exit(report('d5-cross', selected));
}
