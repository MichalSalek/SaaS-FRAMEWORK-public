// d5-surface — AST and file checks that replace the D5 shell scans which were not a code pattern
// inside one workspace. Each check keeps the old invariant and counts the sites it inspects.
// A comment or a string that only names a gate is not a call and not a waiver.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  assertPaths,
  gitRepositoryEnv,
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
import { commentsByLine, isTestOrDecl, markerIn } from './_ts';
import {
  commandInvokes,
  comparesLiveBuildId,
  shellMarkerAnywhere,
  shellModel,
} from './shell-scan';

/** Root page frames. Discovery is wider; these four must keep existing. */
const LAYOUT_ANCHORS = [
  'main/src/UI/layouts/AppLayout.composition.tsx',
  'main/src/UI/layouts/PublicLayout.composition.tsx',
  'main/src/UI/layouts/AdminLayout.composition.tsx',
  'main/src/UI/layouts/AccountWebLayout.composition.tsx',
] as const;

const LAYOUT_FILE = /^main\/src\/UI\/layouts\/[^/]+Layout\.composition\.tsx$/;

const PROFILE = 'main/src/pages/stylist/[identifier].tsx';
const NEXT_CONFIG = 'main/next.config.mjs';
const LLMS_DE = 'main/public/llms-de.txt';
const ROBOTS = 'main/public/robots.txt';
const CRAWLER = '.shared-kernel/domain/seo/ai-crawler-detection.ts';
const COPY_GREP = 'scripts/copy-grep.mjs';
const TEST_USERS = '.shared-kernel/config/test-users.config.ts';
const COMPOSE_SSOT = 'scripts/containers/_compose.sh';

const BARRELS = [
  '@phosphor-icons/react',
  '@tanstack/react-query',
  'next-intl',
] as const;

const ADDR = /[A-Za-z0-9](?:[A-Za-z0-9._+-]*[A-Za-z0-9])?@example\.com/g;

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
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return null;
}

function jsxTag(node: ts.Node): string | null {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
    return null;
  }
  return ts.isIdentifier(node.tagName) ? node.tagName.text : null;
}

function stringAttr(attr: ts.JsxAttribute): string | null {
  const init = attr.initializer;
  if (!init) {
    return null;
  }
  if (ts.isStringLiteral(init)) {
    return init.text;
  }
  if (
    ts.isJsxExpression(init) &&
    init.expression &&
    ts.isStringLiteral(init.expression)
  ) {
    return init.expression.text;
  }
  return null;
}

function comments(source: ts.SourceFile): string[] {
  const text = source.getFullText();
  const out: string[] = [];
  const take = (node: ts.Node): void => {
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
    ]) {
      out.push(text.slice(range.pos, range.end));
    }
    ts.forEachChild(node, take);
  };
  take(source);
  return out;
}

function hasReason(source: ts.SourceFile, marker: string): boolean {
  const re = new RegExp(`${marker}:\\s*\\S`);
  return comments(source).some(text => re.test(text));
}

function stripHashComments(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/^[ \t]*#.*$/, '').replace(/[ \t]#.*$/, ''))
    .join('\n');
}

function push(
  check: MutableCheck,
  file: string,
  line: number,
  message: string
): void {
  check.findings.push({ file, line, message });
}

export function checkLlmsDe(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'llms-de',
    4,
    'wiring points for /llms-de.txt'
  );
  assertPaths(check, root, [LLMS_DE, ROBOTS, CRAWLER, COPY_GREP]);
  if (check.errors.length > 0) {
    return check;
  }
  check.sites += 1;
  // robots.txt lists the indexes in its header comment. That comment is the wiring.
  const robotsHit = readText(root, ROBOTS).includes('llms-de.txt');
  check.sites += 1;
  if (!robotsHit) {
    push(check, ROBOTS, 1, 'robots.txt does not list llms-de.txt');
  }
  const crawler = parseTs(CRAWLER, readText(root, CRAWLER));
  let inArray = false;
  visit(crawler, node => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      node.name.text !== 'TRACKED_PATHS'
    ) {
      return;
    }
    const init = unwrap(node.initializer);
    if (!init || !ts.isArrayLiteralExpression(init)) {
      return;
    }
    inArray = init.elements.some(
      element => ts.isStringLiteral(element) && element.text === '/llms-de.txt'
    );
  });
  check.sites += 1;
  if (!inArray) {
    push(
      check,
      CRAWLER,
      1,
      "TRACKED_PATHS has no string literal '/llms-de.txt'"
    );
  }
  const grepSource = parseTs(COPY_GREP, readText(root, COPY_GREP));
  let inGrep = false;
  visit(grepSource, node => {
    if (ts.isStringLiteral(node) && node.text.includes('llms-de.txt')) {
      inGrep = true;
    }
  });
  check.sites += 1;
  if (!inGrep) {
    push(check, COPY_GREP, 1, 'copy-grep has no string literal llms-de.txt');
  }
  return check;
}

export function checkBundleImports(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'bundle-imports',
    5,
    'packages listed in optimizePackageImports'
  );
  assertPaths(check, root, [NEXT_CONFIG]);
  if (check.errors.length > 0) {
    return check;
  }
  const source = parseTs(NEXT_CONFIG, readText(root, NEXT_CONFIG));
  const listed = new Set<string>();
  visit(source, node => {
    if (
      !ts.isPropertyAssignment(node) ||
      propName(node.name) !== 'optimizePackageImports'
    ) {
      return;
    }
    const init = unwrap(node.initializer);
    if (!init || !ts.isArrayLiteralExpression(init)) {
      push(
        check,
        NEXT_CONFIG,
        lineAt(source.getFullText(), node.getStart(source)),
        'optimizePackageImports is not a literal array'
      );
      return;
    }
    for (const element of init.elements) {
      const value = unwrap(element);
      if (value && ts.isStringLiteral(value)) {
        listed.add(value.text);
        check.sites += 1;
      }
    }
  });
  for (const name of BARRELS) {
    if (!listed.has(name)) {
      push(
        check,
        NEXT_CONFIG,
        1,
        `optimizePackageImports does not list ${name}`
      );
    }
  }
  return check;
}

function scriptSource(rel: string, text: string): ts.SourceFile {
  const body = text.replace(/^#![^\n]*\n/, '\n');
  const name = rel.endsWith('.tsx') ? rel : `${rel}.ts`;
  return parseTs(name, body);
}

function emailBinding(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      /email/i.test(current.name.text)
    ) {
      return true;
    }
    if (ts.isPropertyAssignment(current)) {
      const name = propName(current.name);
      if (name && /email/i.test(name)) {
        return true;
      }
    }
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = current.left;
      if (ts.isIdentifier(left) && /email/i.test(left.text)) {
        return true;
      }
      if (
        ts.isPropertyAccessExpression(left) &&
        /email/i.test(left.name.text)
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

interface AddressHit {
  readonly addr: string;
  readonly line: number;
  readonly prose: boolean;
}

function jsAddressHits(rel: string, text: string): AddressHit[] {
  const body = text.replace(/^#![^\n]*\n/, '\n');
  const source = scriptSource(rel, text);
  const hits: AddressHit[] = [];
  visit(source, node => {
    const value = ts.isStringLiteral(node)
      ? node.text
      : ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : null;
    if (value === null) {
      return;
    }
    const binding = emailBinding(node);
    const tokens = value.trim().split(/\s+/);
    for (const addr of value.match(ADDR) ?? []) {
      const exact = value.trim() === addr;
      hits.push({
        addr,
        line: lineAt(body, node.getStart(source)),
        prose: !binding && !exact && tokens.length > 2,
      });
    }
  });
  return hits;
}

export function checkTestUsers(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'test-users',
    15,
    'account-like @example.com literals in scripts/'
  );
  assertPaths(check, root, [TEST_USERS]);
  if (check.errors.length > 0) {
    return check;
  }
  const known = new Set<string>();
  visit(scriptSource(TEST_USERS, readText(root, TEST_USERS)), node => {
    if (
      !ts.isStringLiteral(node) &&
      !ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      return;
    }
    for (const addr of node.text.match(ADDR) ?? []) {
      known.add(addr);
    }
  });
  if (known.size === 0) {
    check.errors.push('TEST_USERS_CONFIG has no @example.com address');
    return check;
  }
  const files = walk(root, 'scripts', rel => /\.(sh|cjs|mjs|js)$/.test(rel));
  for (const rel of files) {
    const text = readText(root, rel);
    const shell = rel.endsWith('.sh');
    const model = shell ? shellModel(text) : null;
    const comments = model ? model.comments : commentsByLine(rel, text);
    const hits = model
      ? model.emails.map(hit => ({
          addr: hit.addr,
          line: hit.line,
          prose: hit.prose,
        }))
      : jsAddressHits(rel, text);
    const bareLines = new Set<number>();
    for (const line of comments.keys()) {
      if (markerIn(comments, 'test-user-allow', line, line) === 'bare') {
        bareLines.add(line);
      }
    }
    for (const line of bareLines) {
      push(check, rel, line, 'test-user-allow without a reason');
    }
    for (const hit of hits) {
      if (hit.prose) {
        continue;
      }
      check.sites += 1;
      if (
        markerIn(comments, 'test-user-allow', hit.line, hit.line) === 'reason'
      ) {
        continue;
      }
      if (!known.has(hit.addr)) {
        push(check, rel, hit.line, `${hit.addr} is not in TEST_USERS_CONFIG`);
      }
    }
  }
  return check;
}

/** A nested page shell renders another layout and does not own the landmark. */
function delegatesToLayout(source: ts.SourceFile): boolean {
  let found = false;
  visit(source, node => {
    const tag = jsxTag(node);
    if (tag && tag.endsWith('LayoutComposition')) {
      found = true;
    }
  });
  return found;
}

function boundNames(
  source: ts.SourceFile,
  moduleIncludes: string,
  exported: string
): Set<string> {
  const names = new Set<string>([exported]);
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) {
      continue;
    }
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(spec) || !spec.text.includes(moduleIncludes)) {
      continue;
    }
    const named = stmt.importClause.namedBindings;
    if (!named || !ts.isNamedImports(named)) {
      continue;
    }
    for (const element of named.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === exported) {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

function hasOwnLandmark(source: ts.SourceFile): boolean {
  let found = false;
  visit(source, node => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
      return;
    }
    for (const attr of node.attributes.properties) {
      if (
        ts.isJsxAttribute(attr) &&
        attr.name.getText(source) === 'id' &&
        stringAttr(attr) === 'main-content'
      ) {
        found = true;
      }
    }
  });
  return found;
}

function contentLayouts(root: string): string[] {
  // A root frame is a *Layout.composition.tsx in the layouts directory.
  // AdminPageLayout only renders AdminLayout, so it is a nested shell.
  // AppLayout renders AccountWebLayout on desktop AND its own landmark, so it
  // stays a root frame. Molecules do not match the file name.
  return walk(root, 'main/src/UI/layouts', rel => LAYOUT_FILE.test(rel)).filter(
    rel => {
      const source = parseTs(rel, readText(root, rel));
      return !delegatesToLayout(source) || hasOwnLandmark(source);
    }
  );
}

export function checkMainContent(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'main-content',
    20,
    'JSX elements in discovered root content layouts'
  );
  assertPaths(check, root, [...LAYOUT_ANCHORS]);
  if (check.errors.length > 0) {
    return check;
  }
  const layouts = contentLayouts(root);
  const layoutSet = new Set(layouts);
  for (const anchor of LAYOUT_ANCHORS) {
    if (!layoutSet.has(anchor)) {
      push(
        check,
        anchor,
        1,
        'content layout anchor is not a root layout declaration'
      );
    }
  }
  for (const rel of layouts) {
    const text = readText(root, rel);
    const source = parseTs(rel, text);
    const shells = boundNames(
      source,
      'NavigationContentShell',
      'NavigationContentShellComposition'
    );
    let hasId = false;
    let hasShell = false;
    visit(source, node => {
      if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
        return;
      }
      check.sites += 1;
      const tag = jsxTag(node);
      if (tag && shells.has(tag)) {
        hasShell = true;
      }
      for (const attr of node.attributes.properties) {
        if (
          ts.isJsxAttribute(attr) &&
          attr.name.getText(source) === 'id' &&
          stringAttr(attr) === 'main-content'
        ) {
          hasId = true;
        }
      }
    });
    if (!hasId) {
      push(check, rel, 1, "layout does not render id='main-content'");
    }
    if (!hasShell) {
      push(
        check,
        rel,
        1,
        'layout does not render NavigationContentShellComposition'
      );
    }
  }
  const tsx = walk(
    root,
    'main/src',
    rel => rel.endsWith('.tsx') && !isTestOrDecl(rel)
  );
  for (const rel of tsx) {
    if (layoutSet.has(rel)) {
      continue;
    }
    const source = parseTs(rel, readText(root, rel));
    visit(source, node => {
      if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
        return;
      }
      for (const attr of node.attributes.properties) {
        if (
          !ts.isJsxAttribute(attr) ||
          attr.name.getText(source) !== 'id' ||
          stringAttr(attr) !== 'main-content'
        ) {
          continue;
        }
        check.sites += 1;
        push(
          check,
          rel,
          lineAt(source.getFullText(), attr.getStart(source)),
          "id='main-content' outside the content layouts"
        );
      }
    });
  }
  return check;
}

export function checkProfileSeo(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'profile-seo',
    10,
    'calls and JSX elements in the stylist profile page'
  );
  assertPaths(check, root, [PROFILE]);
  if (check.errors.length > 0) {
    return check;
  }
  const text = readText(root, PROFILE);
  const source = parseTs(PROFILE, text);
  let called = false;
  let assigned = false;
  let rendered = false;
  visit(source, node => {
    if (
      ts.isCallExpression(node) ||
      ts.isJsxOpeningElement(node) ||
      ts.isJsxSelfClosingElement(node)
    ) {
      check.sites += 1;
    }
    if (
      ts.isPropertyAssignment(node) &&
      propName(node.name) === 'method' &&
      ts.isStringLiteral(unwrap(node.initializer) ?? node.initializer) &&
      (unwrap(node.initializer) as ts.StringLiteral).text === 'POST'
    ) {
      push(
        check,
        PROFILE,
        lineAt(text, node.getStart(source)),
        "profile page sets method: 'POST'; the public profile query is GET"
      );
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'buildStylistProfileJsonLdItems'
    ) {
      called = true;
      const parent = node.parent;
      const left =
        parent &&
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
          ? parent.left
          : parent && ts.isVariableDeclaration(parent)
            ? parent.name
            : undefined;
      if (left && ts.isIdentifier(left) && left.text === 'jsonLdItems') {
        assigned = true;
      }
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      jsxTag(node) === 'JsonLdComposition'
    ) {
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || attr.name.getText(source) !== 'data') {
          continue;
        }
        const init = attr.initializer;
        if (
          init &&
          ts.isJsxExpression(init) &&
          init.expression &&
          ts.isIdentifier(init.expression) &&
          init.expression.text === 'jsonLdItems'
        ) {
          rendered = true;
        }
      }
    }
  });
  if (!called) {
    push(check, PROFILE, 1, 'buildStylistProfileJsonLdItems is never called');
  }
  if (!assigned) {
    push(check, PROFILE, 1, 'the JSON-LD call is not assigned to jsonLdItems');
  }
  if (!rendered) {
    push(
      check,
      PROFILE,
      1,
      'JsonLdComposition does not receive data={jsonLdItems}'
    );
  }
  return check;
}

const LIFECYCLE =
  /(?:^|[\s"'`;&|(])(up|down|build|create|start|restart|rm|pull|stop|kill)(?:[\s"'`]|$)/;

function composeLines(
  check: MutableCheck,
  rel: string,
  text: string,
  mode: 'scripts' | 'manifest'
): void {
  const lines = text.split('\n');
  const comments =
    mode === 'scripts' && rel.endsWith('.sh')
      ? shellModel(text).comments
      : mode === 'scripts'
        ? commentsByLine(rel, text)
        : new Map<number, string>();
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const here = markerIn(comments, 'compose-pair-allow', i + 1, i + 1);
    const prev = markerIn(comments, 'compose-pair-allow', i, i);
    if (here === 'bare') {
      push(check, rel, i + 1, 'compose-pair-allow without a reason');
    }
    const line = mode === 'scripts' ? stripHashComments(raw) : raw;
    if (!/docker[ \t]+compose/.test(line)) {
      continue;
    }
    if (!/(^|[\s"'`;&|(])-f[ \t]/.test(line)) {
      continue;
    }
    if (!LIFECYCLE.test(line)) {
      continue;
    }
    check.sites += 1;
    if (here === 'reason' || prev === 'reason') {
      continue;
    }
    if (mode === 'scripts') {
      push(
        check,
        rel,
        i + 1,
        'docker compose -f outside _compose.sh; use dev_compose or staging_compose'
      );
      continue;
    }
    const dev =
      line.includes('docker-compose.dev.yml') &&
      line.includes('docker-compose.dev-ssl.yml');
    const staging =
      line.includes('docker-compose.prod.yml') &&
      line.includes('docker-compose.staging.yml');
    if (!dev && !staging) {
      push(
        check,
        rel,
        i + 1,
        'docker compose lifecycle is missing a file pair'
      );
    }
  }
}

export function checkComposePairs(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'compose-pairs',
    1,
    'docker compose lifecycle lines'
  );
  assertPaths(check, root, [COMPOSE_SSOT]);
  if (check.errors.length > 0) {
    return check;
  }
  const scripts = walk(root, 'scripts', () => true);
  for (const rel of scripts) {
    if (rel === COMPOSE_SSOT) {
      continue;
    }
    composeLines(check, rel, readText(root, rel), 'scripts');
  }
  const manifests = ['package.json'];
  if (existsSync(path.join(root))) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') {
        continue;
      }
      const rel = `${entry.name}/package.json`;
      if (existsSync(path.join(root, rel))) {
        manifests.push(rel);
      }
    }
  }
  for (const rel of manifests) {
    if (existsSync(path.join(root, rel))) {
      composeLines(check, rel, readText(root, rel), 'manifest');
    }
  }
  if (check.sites === 0) {
    check.errors.push('no docker compose lifecycle line was inspected');
  }
  return check;
}

function deployFiles(root: string): string[] {
  const dir = path.join(root, 'scripts/deploy');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [];
  }
  return readdirSync(dir)
    .filter(
      name => name.startsWith('deploy-') && !/\.test\.[cm]?[jt]s$/.test(name)
    )
    .map(name => `scripts/deploy/${name}`)
    .sort();
}

function deployGate(
  check: MutableCheck,
  rel: string,
  text: string,
  marker: string,
  satisfied: boolean,
  missing: string
): void {
  const model = shellModel(text);
  const allow = shellMarkerAnywhere(model, marker);
  if (allow.bareLine !== 0) {
    push(check, rel, allow.bareLine, `${marker} without a reason`);
  }
  if (allow.state === 'reason' || satisfied) {
    return;
  }
  push(check, rel, 1, missing);
}

export function checkDeployArtifact(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'deploy-artifact',
    3,
    'deploy-* scripts checked for a real artifact-identity call'
  );
  const files = deployFiles(root);
  if (files.length === 0) {
    check.errors.push('no scripts/deploy/deploy-* files');
    return check;
  }
  for (const rel of files) {
    const text = readText(root, rel);
    if (!text.trim()) {
      continue;
    }
    check.sites += 1;
    const model = shellModel(text);
    deployGate(
      check,
      rel,
      text,
      'artifact-identity-allow',
      commandInvokes(model, 'assert_artifact_served') ||
        comparesLiveBuildId(model),
      'deploy script does not confirm the live BUILD_ID'
    );
  }
  return check;
}

export function checkDeployOrigin(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'deploy-origin',
    3,
    'deploy-* scripts checked for a real origin-parity call'
  );
  const files = deployFiles(root);
  if (files.length === 0) {
    check.errors.push('no scripts/deploy/deploy-* files');
    return check;
  }
  for (const rel of files) {
    const text = readText(root, rel);
    if (!text.trim()) {
      continue;
    }
    check.sites += 1;
    const model = shellModel(text);
    deployGate(
      check,
      rel,
      text,
      'origin-parity-allow',
      commandInvokes(model, 'git_parity_counts'),
      'deploy script does not call git_parity_counts'
    );
  }
  return check;
}

const STEP_SETTERS = new Set(['setStep', 'setCurrentStep', 'setWizardStep']);

export function checkScrollReset(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'scroll-reset',
    4,
    'AppLayout and step-scroll calls in feature compositions'
  );
  const files = walk(
    root,
    'main/src/UI/features',
    rel => rel.endsWith('.composition.tsx') && !rel.includes('/playground/')
  );
  if (files.length === 0) {
    check.errors.push('no feature composition files');
    return check;
  }
  for (const rel of files) {
    const text = readText(root, rel);
    const source = parseTs(rel, text);
    const appLayouts = boundNames(
      source,
      'AppLayout.composition',
      'AppLayoutComposition'
    );
    let inApp = false;
    let steps = false;
    let scrolls = false;
    let targetsMain = false;
    visit(source, node => {
      const tag = jsxTag(node);
      if (tag && appLayouts.has(tag)) {
        inApp = true;
        check.sites += 1;
      }
      if (!ts.isCallExpression(node)) {
        return;
      }
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : null;
      if (name && STEP_SETTERS.has(name)) {
        steps = true;
        check.sites += 1;
      }
      if (name === 'scrollTo') {
        scrolls = true;
        check.sites += 1;
      }
      if (name === 'getElementById') {
        const arg = unwrap(node.arguments[0]);
        if (arg && ts.isStringLiteral(arg) && arg.text === 'main-content') {
          targetsMain = true;
          check.sites += 1;
        }
      }
    });
    if (!inApp || !steps) {
      continue;
    }
    if (hasReason(source, 'scroll-reset-allow')) {
      continue;
    }
    if (scrolls && targetsMain) {
      continue;
    }
    push(
      check,
      rel,
      1,
      'multi-step app wizard does not reset #main-content on step change'
    );
  }
  return check;
}

function trackedComponents(root: string): Set<string> | 'disk' {
  const git = path.join(root, 'main/.git');
  if (!existsSync(git)) {
    return 'disk';
  }
  try {
    const out = execFileSync(
      'git',
      ['-C', path.join(root, 'main'), 'ls-files', 'src/UI/components/'],
      { encoding: 'utf8', env: gitRepositoryEnv() }
    );
    const set = new Set(
      out
        .split('\n')
        .filter(line => line.endsWith('.tsx'))
        .map(line => `main/${line}`)
    );
    return set.size === 0 ? 'disk' : set;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'git failed';
    throw new Error(message);
  }
}

export function checkUiLibrary(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'ui-library',
    50,
    'shared component main files checked against the registry'
  );
  const registryDir = path.join(root, 'main/src/UI/features/ui-library');
  if (!existsSync(registryDir)) {
    check.errors.push('ui-library directory is missing');
    return check;
  }
  const referenced = new Set<string>();
  for (const name of readdirSync(registryDir)) {
    if (!name.startsWith('uiLibrary.registry') || !name.endsWith('.ts')) {
      continue;
    }
    const rel = `main/src/UI/features/ui-library/${name}`;
    const source = parseTs(rel, readText(root, rel));
    visit(source, node => {
      if (
        ts.isPropertyAssignment(node) &&
        propName(node.name) === 'importPath'
      ) {
        const value = unwrap(node.initializer);
        if (value && ts.isStringLiteral(value)) {
          referenced.add(value.text);
        }
      }
    });
  }
  if (referenced.size === 0) {
    check.errors.push('registry has no importPath string literals');
    return check;
  }
  let tracked: Set<string> | 'disk';
  try {
    tracked = trackedComponents(root);
  } catch {
    check.errors.push('git ls-files failed for main/src/UI/components');
    return check;
  }
  const components = path.join(root, 'main/src/UI/components');
  const layer = /\.(atom|molecule|organism|composition)\.tsx$/;
  const consider = (relFromMain: string): void => {
    const full = `main/${relFromMain}`;
    if (tracked !== 'disk' && !tracked.has(full)) {
      return;
    }
    const importPath = relFromMain.replace(/\.tsx$/, '');
    check.sites += 1;
    if (!referenced.has(importPath)) {
      push(check, full, 1, `${importPath} is not in the UI library registry`);
    }
  };
  for (const entry of readdirSync(components, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const dir = path.join(components, entry.name);
      for (const file of readdirSync(dir)) {
        if (file.startsWith(`${entry.name}.`) && layer.test(file)) {
          consider(`src/UI/components/${entry.name}/${file}`);
          break;
        }
      }
    } else if (layer.test(entry.name)) {
      consider(`src/UI/components/${entry.name}`);
    }
  }
  return check;
}

export function run(root: string): CheckResult[] {
  // Deployment, seed-script and editorial-pipeline checks use the full product checkout.
  return [
    checkBundleImports(root),
    checkMainContent(root),
    checkProfileSeo(root),
    checkScrollReset(root),
    checkUiLibrary(root),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('d5-surface', run(projectRoot())));
}
