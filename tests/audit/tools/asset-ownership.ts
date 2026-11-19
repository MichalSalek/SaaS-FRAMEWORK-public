// asset-ownership — every web-1 domain file that PERSISTS a Cloudinary `public_id` consults the
// shared ownership gate `findForeignAssetOwner` (OWNERSHIP guard).
//
// Successor of tests/audit/asset-ownership-gate.sh. The browser uploads straight to Cloudinary, so
// the backend only receives an ADDRESS, and the irreversible delete runs on the `public_id`
// derived from it. A surface storing a client-supplied address without the gate lets a stylist
// point a row at somebody else's file.
//
// Rule: a file under web-1/src/domain (not a test, not the gate) with a write site of `public_id` /
// `avatar_public_id` / `salon_logo_public_id` must CALL `findForeignAssetOwner` in code (alias imports count) or carry
// `asset-ownership-allow: <reason>` in a comment; a bare marker is a finding. Write sites come from
// the AST: object-literal keys (incl. shorthand), property signatures, `x.public_id = ...`.
//
// SCOPE: per file and presence only. It does not prove the gate runs on the right variable before
// the write; a future column with another name is a false negative.
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
  commentsByLine,
  importBindings,
  isTestOrDecl,
  markerIn,
  nodeLine,
  propName,
  unwrapExpr,
} from './_ts';

export const DOMAIN = 'web-1/src/domain';
export const GATE_FILE = `${DOMAIN}/_shared/guards/cloudinary-asset.guard.ts`;
export const GATE_FN = 'findForeignAssetOwner';
export const MARKER = 'asset-ownership-allow';
const KEYS = new Set(['public_id', 'avatar_public_id', 'salon_logo_public_id']);

/** Floor, measured 2026-10-23 on the real tree: 8 write sites in 6 files (gate file excluded). */
export const MIN_SITES = 6;

function keyName(name: ts.PropertyName): string | undefined {
  if (ts.isComputedPropertyName(name)) {
    const expr = unwrapExpr(name.expression);
    return ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)
      ? expr.text
      : undefined;
  }
  return propName(name);
}

function accessedName(node: ts.Expression): string | undefined {
  const expr = unwrapExpr(node);
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.name.text;
  }
  if (ts.isElementAccessExpression(expr)) {
    const arg = unwrapExpr(expr.argumentExpression);
    return ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)
      ? arg.text
      : undefined;
  }
  return undefined;
}

interface FileScan {
  readonly sites: number[];
  readonly gated: boolean;
}

export function scanFile(rel: string, text: string): FileScan {
  const sf = parseTs(rel, text);
  const imports = importBindings(sf);
  const sites: number[] = [];
  let gated = false;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isPropertySignature(node) ||
        ts.isPropertyDeclaration(node)) &&
      KEYS.has(keyName(node.name) ?? '')
    ) {
      sites.push(nodeLine(sf, node));
    } else if (
      ts.isShorthandPropertyAssignment(node) &&
      KEYS.has(node.name.text)
    ) {
      sites.push(nodeLine(sf, node));
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      KEYS.has(accessedName(node.left) ?? '')
    ) {
      sites.push(nodeLine(sf, node));
    } else if (ts.isCallExpression(node)) {
      const callee = unwrapExpr(node.expression);
      const local = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (
        local !== undefined &&
        (imports.get(local)?.imported ?? local) === GATE_FN
      ) {
        gated = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sites, gated };
}

export function checkAssetOwnership(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'asset-ownership',
    MIN_SITES,
    'public_id write sites'
  );
  assertPaths(check, root, [DOMAIN, GATE_FILE]);
  if (check.errors.length > 0) {
    return check;
  }
  const files = walk(
    root,
    DOMAIN,
    rel => rel.endsWith('.ts') && !isTestOrDecl(rel)
  );
  for (const rel of files) {
    // The gate file DEFINES the rule and queries these columns; excluded by path, never by "it
    // mentions its own name".
    if (rel === GATE_FILE) {
      continue;
    }
    const text = readText(root, rel);
    if (!text.includes('public_id')) {
      continue;
    }
    const scan = scanFile(rel, text);
    if (scan.sites.length === 0) {
      continue;
    }
    check.sites += scan.sites.length;
    if (scan.gated) {
      continue;
    }
    const lines = text.split('\n').length;
    const escape = markerIn(commentsByLine(rel, text), MARKER, 1, lines);
    if (escape === 'reason') {
      continue;
    }
    check.findings.push({
      file: rel,
      line: scan.sites[0] ?? 1,
      message:
        escape === 'bare'
          ? `${MARKER} without a reason, and the file persists a Cloudinary public_id without calling ${GATE_FN}() (write lines ${scan.sites.join(', ')})`
          : `persists a Cloudinary public_id without calling ${GATE_FN}() (write lines ${scan.sites.join(', ')}); call ${GATE_FN}(<address>, <accountId>) and reject anything but 'OWN', or document // ${MARKER}: <reason>`,
    });
  }
  return check;
}

export function run(root: string): CheckResult[] {
  return [checkAssetOwnership(root)];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('asset-ownership', run(projectRoot())));
}
