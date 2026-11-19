// pagination — deterministic order for paginated and capped Prisma reads (web-1), two checks.
// Successor of tests/audit/pagination-tiebreaker.sh and tests/audit/email-sweep-orderby.sh; AST based.
//  1. tiebreaker: an object-form `orderBy: { <field>: ... }` on a non-unique field in a paginated
//     query (`skip` / `cursor` in the same arguments object, or in code within 12 lines) needs the
//     array form with a unique tiebreaker, `orderBy: [{ created_at: 'desc' }, { id: 'desc' }]`, or
//     equal sort values repeat or vanish across pages. Exempt: single-row reads (`take: 1`).
//     Escape: `tiebreaker-allow: <reason>` on the orderBy line or the line above.
//  2. sweep-orderby: in email domain and lifecycle application modules (non-test), every capped `findMany` must
//     carry `orderBy`, or Postgres returns an arbitrary subset and rows past the cap starve.
//     A length or `in:` filter is not enough: multiple rows can share a key.
//     Escape: `orderby-exempt: <reason>` inside the call; a bare marker is a finding.
//
// DECISION: `id` and any `*_id` field count as unique. A bare FK sort could drift, but telling a
// PK from an FK needs the model, which an untyped parse lacks.
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
import {
  codeOnly,
  commentsByLine,
  markerIn,
  nodeLine,
  objectProp,
  propName,
  unwrapExpr,
} from './_ts';

export const WEB1_SRC = 'web-1/src';
export const EMAIL_ROOT = 'web-1/src/domain/email';
export const EMAIL_LIFECYCLE_ROOT =
  'web-1/src/application/email-handler/lifecycle';
const EMAIL_ROOTS = [EMAIL_ROOT, EMAIL_LIFECYCLE_ROOT] as const;

/** Floors, measured 2026-10-23 on the real tree. */
export const FLOORS = {
  /** `orderBy` properties (any form) in web-1/src (measured 138). */
  tiebreaker: 100,
  /** `findMany` calls under the email root (measured 26). */
  sweepOrderBy: 20,
} as const;

const UNIQUE_SORT = /^(id|.*_id)$/;
const WINDOW = 12;
const SKIP = /(^|\/)(js-client|generated)(\/|$)/;

function forEachNode(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, child => forEachNode(child, visit));
}

function hasKey(obj: ts.ObjectLiteralExpression, name: string): boolean {
  return objectProp(obj, name) !== undefined;
}

function isTakeOne(obj: ts.ObjectLiteralExpression): boolean {
  const take = objectProp(obj, 'take');
  if (take === undefined || !ts.isPropertyAssignment(take)) {
    return false;
  }
  const value = unwrapExpr(take.initializer);
  return ts.isNumericLiteral(value) && value.text === '1';
}

export function checkTiebreaker(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'pagination:tiebreaker',
    FLOORS.tiebreaker,
    'orderBy properties'
  );
  assertPaths(check, root, [WEB1_SRC]);
  if (check.errors.length > 0) {
    return check;
  }
  const files = walk(
    root,
    WEB1_SRC,
    rel => /\.tsx?$/.test(rel) && !rel.endsWith('.d.ts') && !SKIP.test(rel)
  );
  for (const rel of files) {
    const text = readText(root, rel);
    if (!text.includes('orderBy')) {
      continue;
    }
    const sf = parseTs(rel, text);
    const codeLines = codeOnly(rel, text).split('\n');
    const comments = commentsByLine(rel, text);
    forEachNode(sf, node => {
      if (!ts.isPropertyAssignment(node) || propName(node.name) !== 'orderBy') {
        return;
      }
      check.sites++;
      const value = unwrapExpr(node.initializer);
      if (
        !ts.isObjectLiteralExpression(value) ||
        value.properties.length === 0
      ) {
        return; // array form (tiebreaker), a variable, or an empty object
      }
      const sortProp = value.properties[0];
      const field =
        sortProp !== undefined &&
        (ts.isPropertyAssignment(sortProp) ||
          ts.isShorthandPropertyAssignment(sortProp))
          ? propName(sortProp.name)
          : undefined;
      if (field === undefined || UNIQUE_SORT.test(field)) {
        return;
      }
      const args = node.parent;
      if (ts.isObjectLiteralExpression(args) && isTakeOne(args)) {
        return;
      }
      const line = nodeLine(sf, node);
      const nearby = codeLines
        .slice(Math.max(0, line - 1 - WINDOW), line + WINDOW)
        .join('\n');
      const paginated =
        (ts.isObjectLiteralExpression(args) &&
          (hasKey(args, 'skip') || hasKey(args, 'cursor'))) ||
        /\b(skip|cursor)\s*:/.test(nearby);
      if (!paginated) {
        return;
      }
      const escape = markerIn(comments, 'tiebreaker-allow', line - 1, line);
      if (escape === 'reason') {
        return;
      }
      check.findings.push({
        file: rel,
        line,
        message:
          escape === 'bare'
            ? 'tiebreaker-allow without a reason'
            : `paginated query sorts by non-unique '${field}' without a unique tiebreaker (use orderBy: [{ ${field}: … }, { id: … }])`,
      });
    });
  }
  return check;
}

/** Any take can truncate a many-to-one lookup, including lengths and Math.min. */
function isCapTake(obj: ts.ObjectLiteralExpression): boolean {
  return objectProp(obj, 'take') !== undefined;
}

export function checkSweepOrderBy(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'pagination:sweep-orderby',
    FLOORS.sweepOrderBy,
    'findMany calls in email sweeps'
  );
  assertPaths(check, root, EMAIL_ROOTS);
  if (check.errors.length > 0) {
    return check;
  }
  const files = EMAIL_ROOTS.flatMap(emailRoot =>
    walk(
      root,
      emailRoot,
      rel =>
        /\.tsx?$/.test(rel) &&
        !rel.endsWith('.d.ts') &&
        !/\.test\.tsx?$/.test(rel)
    )
  );
  for (const rel of files) {
    const text = readText(root, rel);
    if (!text.includes('findMany')) {
      continue;
    }
    const sf = parseTs(rel, text);
    const comments = commentsByLine(rel, text);
    forEachNode(sf, node => {
      if (!ts.isCallExpression(node)) {
        return;
      }
      const callee = unwrapExpr(node.expression);
      if (
        !ts.isPropertyAccessExpression(callee) ||
        callee.name.text !== 'findMany'
      ) {
        return;
      }
      check.sites++;
      const arg = node.arguments[0];
      const args = arg === undefined ? undefined : unwrapExpr(arg);
      if (args === undefined || !ts.isObjectLiteralExpression(args)) {
        return;
      }
      if (!isCapTake(args) || hasKey(args, 'orderBy')) {
        return;
      }
      const from = nodeLine(sf, node);
      const to = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const escape = markerIn(comments, 'orderby-exempt', from, to);
      if (escape === 'reason') {
        return;
      }
      const take = objectProp(args, 'take');
      check.findings.push({
        file: rel,
        line: take === undefined ? from : nodeLine(sf, take),
        message:
          escape === 'bare'
            ? 'orderby-exempt without a reason'
            : 'capped selection findMany without orderBy: the cap drops an arbitrary subset (order edge rows first)',
      });
    });
  }
  return check;
}

export function run(root: string): CheckResult[] {
  return [checkTiebreaker(root), checkSweepOrderBy(root)];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? path.sep).href) {
  process.exit(report('pagination', run(projectRoot())));
}
