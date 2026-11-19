// brand — the non-TypeScript half of the brand-identity guard.
//
// Successor of tests/audit/brand-literals.sh together with the ESLint rule `nf/brand-literals`
// (main, web-1, root), which reads string values in .ts/.tsx. This tool keeps what ESLint cannot
// see:
//   1. json-literals: brand literals in .json files under main/src, main/public, web-1/src and
//      .shared-kernel (and any .ts/.tsx under main/public, which no ESLint config lints). A JSON
//      file has no comments, so every match is a value.
//      Allowlisted: human-facing copy (main/src/locales, kernel e-mail locales: an ICU sentence
//      cannot import BRAND_CONFIG, and that channel has its own `copy:grep` sweep), the READONLY
//      kernel copies (mirrors of the source, which is scanned), and assetlinks.json (the literal
//      is required there and covered by check 2 instead).
//   2. assetlinks-parity: the production package is required; an optional .dev flavor derives
//      from BRAND_CONFIG.androidPackage. No other package names are accepted. Drift silently kills Android App Links (native deep-link login
//      falls back to the browser) with every other gate green.
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  assertPaths,
  lineAt,
  newCheck,
  parseTs,
  projectRoot,
  readText,
  report,
  walk,
  type CheckResult,
  type MutableCheck,
} from './_lib';

const BRAND_PATTERN =
  /nailfolio\.app|nailfolio:\/\/|@nailfolio_app|com\.nailfolio/g;

export const ASSETLINKS = 'main/public/.well-known/assetlinks.json';
export const BRAND_CONFIG_FILE =
  '.shared-kernel/domain/platform/brand.config.ts';

const SCAN_ROOTS = [
  'main/src',
  'main/public',
  'web-1/src',
  '.shared-kernel',
] as const;

/** Prefixes outside check 1, each with its reason in the header comment. */
export const ALLOWLIST = [
  'main/src/locales/',
  '.shared-kernel/domain/email/locales/',
  ASSETLINKS,
] as const;

const isScanned = (rel: string): boolean => {
  if (rel.includes('READONLY-shared-kernel/')) {
    return false;
  }
  if (ALLOWLIST.some(prefix => rel === prefix || rel.startsWith(prefix))) {
    return false;
  }
  if (rel.endsWith('.json')) {
    return true;
  }
  return (
    rel.startsWith('main/public/') &&
    (rel.endsWith('.ts') || rel.endsWith('.tsx'))
  );
};

// Measured 2026-10-23: 11 files scanned.
const MIN_FILES = 8;

export function checkJsonLiterals(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'json-literals',
    MIN_FILES,
    'JSON files (and untyped-lint .ts) under main/src, main/public, web-1/src, .shared-kernel'
  );
  assertPaths(check, root, [...SCAN_ROOTS, ...ALLOWLIST]);
  if (check.errors.length > 0) {
    return check;
  }
  for (const scanRoot of SCAN_ROOTS) {
    for (const rel of walk(root, scanRoot, isScanned)) {
      check.sites++;
      const text = readText(root, rel);
      for (const match of text.matchAll(BRAND_PATTERN)) {
        check.findings.push({
          file: rel,
          line: lineAt(text, match.index),
          message: `brand literal \`${match[0]}\`: a static file that cannot import BRAND_CONFIG must not repeat it (copy belongs in locales; machine config needs a parity check like assetlinks.json)`,
        });
      }
    }
  }
  return check;
}

/** `androidPackage: '<value>'` inside the BRAND_CONFIG object, read from the AST. */
export function androidPackageOf(text: string): string | null {
  const source = parseTs(BRAND_CONFIG_FILE, text);
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'androidPackage' &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      found = node.initializer.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every `target.package_name` in an assetlinks.json document. */
export function packageNamesOf(json: unknown): string[] {
  if (!Array.isArray(json)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of json as unknown[]) {
    const target: unknown =
      entry !== null && typeof entry === 'object'
        ? (entry as Record<string, unknown>).target
        : null;
    const name: unknown =
      target !== null && typeof target === 'object'
        ? (target as Record<string, unknown>).package_name
        : undefined;
    if (typeof name === 'string') {
      names.push(name);
    }
  }
  return names;
}

export function checkAssetlinksParity(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'assetlinks-parity',
    1,
    'package_name entries in assetlinks.json'
  );
  assertPaths(check, root, [ASSETLINKS, BRAND_CONFIG_FILE]);
  if (check.errors.length > 0) {
    return check;
  }
  const expected = androidPackageOf(readText(root, BRAND_CONFIG_FILE));
  if (expected === null) {
    check.errors.push(
      `no androidPackage string in ${BRAND_CONFIG_FILE} (shape changed? update tools/brand.ts)`
    );
    return check;
  }
  let json: unknown;
  try {
    json = JSON.parse(readText(root, ASSETLINKS));
  } catch (error) {
    check.errors.push(`${ASSETLINKS} is not valid JSON: ${String(error)}`);
    return check;
  }
  const names = packageNamesOf(json);
  check.sites = names.length;
  if (!names.includes(expected)) {
    check.findings.push({
      file: ASSETLINKS,
      line: 1,
      message: `missing production package '${expected}' from assetlinks.json`,
    });
  }
  // Android flavors keep the canonical package for Prod and append exactly .dev for Dev.
  const allowed = new Set([expected, `${expected}.dev`]);
  for (const name of names) {
    if (!allowed.has(name)) {
      check.findings.push({
        file: ASSETLINKS,
        line: 1,
        message: `package_name '${name}' is neither BRAND_CONFIG.androidPackage '${expected}' nor its explicit .dev flavor: App Links would target an unrelated package`,
      });
    }
  }
  return check;
}

export function run(root: string): CheckResult[] {
  return [checkJsonLiterals(root), checkAssetlinksParity(root)];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('brand', run(projectRoot())));
}
