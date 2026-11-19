// copy-policy: typed successor of the blocking copy shells.
//
// Locales are JSON values (keys are not copy). Code and CSS are parsed: a comment, an identifier,
// or a string that only names a rule is not a hit. CSS middle dots are `content` values.
// DECISION: founder-given-name is scanned in source string literals. The shell comment says that
// rule is off in code; the shell loop and the source-founder fixture both flag literals.
// DECISION: `planid-literal-allow:` and `middle-dot-allow:` waive only inside a comment, and only
// with a reason. A bare marker is a finding. The same marker inside a string does not waive.
// DECISION: blog fields come from the fenced front matter. A `description:` line in the body is
// not that field. Dashes are the characters in the MDX text.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { isObject, loadJson, type JsonValue } from './_json';
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
import { commentsByLine, markerIn, nodeLine, propName, unwrapExpr } from './_ts';

const APP_LOCALES = 'main/src/locales';
const EMAIL_LOCALES = '.shared-kernel/domain/email/locales';
const CODE_ROOT = 'main/src';
const BLOG_DIR = 'main/src/content/blog';
const BLOG_UTILS = 'main/src/application/blog/blog.utils.ts';
const EMAIL_HANDLER = 'web-1/src/application/email-handler';
const PLAN_ROOTS = ['web-1/src', 'main/src'] as const;
const PHRASE_JSON = [
  'main/src/locales/pl/common.json',
  'main/src/locales/en/common.json',
  'main/src/locales/de/common.json',
  'main/src/locales/pl/events.json',
  'main/src/locales/en/events.json',
  'main/src/locales/de/events.json',
  '.shared-kernel/domain/email/locales/email-i18n.pl.json',
  '.shared-kernel/domain/email/locales/email-i18n.en.json',
  '.shared-kernel/domain/email/locales/email-i18n.de.json',
] as const;
const PHRASE_TEXT = [
  'main/public/llms.txt',
  'main/public/llms-pl.txt',
  'main/public/llms-de.txt',
] as const;
const PHRASE_SOURCE = ['main/src', 'web-1/src', '.shared-kernel'] as const;
const DE_FILES = [
  ['common', 'main/src/locales/de/common.json'],
  ['events', 'main/src/locales/de/events.json'],
  ['email', '.shared-kernel/domain/email/locales/email-i18n.de.json'],
] as const;
const PRICE_FILES = ['pl', 'en', 'de'].map(
  lang => `main/src/locales/${lang}/common.json`
);
const BLOG_FIELDS = [
  'title',
  'description',
  'date',
  'category',
  'locale',
  'author',
  'coverImage',
] as const;

// Mini-tree floors: a legal sample inspects at least this many values. The repo is far above.
const MIN_DASHES = 3;
const MIN_PHRASES = 1;
const MIN_DE = 1;
const MIN_BLOG = BLOG_FIELDS.length;
const MIN_PLAN = 1;
const MIN_CTA = 1;
const MIN_PRICES = 3;

const JSON_DASH =
  /[\u2014\u2013]|\\u201[34]|&(?:mdash|ndash|#821[12]|#x201[34]);/i;
const JSON_DOT = /\u00B7|\\u00b7|&(?:middot|#0*183|#x0*b7);/i;
const ARROW_END =
  /(?:\u2192|\u203A|\u00BB|\u279C|\u27F6|->|\\u2192|&rarr;)$/i;
const CODE_DOT =
  /\u00B7|\\u00[bB]7|\\u\{0*[bB]7\}|\\x[bB]7|&middot;|&#0*183;|&#[xX]0*[bB]7;/;
const CSS_DOT = /\u00B7|\\0{0,4}[bB]7(?![0-9a-fA-F])|&middot;/;
const DOT_REASON = /middle-dot-allow:[ \t]*[\p{L}\p{N}][\p{L}\p{N}]+/u;
const AUTHOR_BANNED = /zesp(?:o|ó|Ó)(?:l|ł|Ł)|team/i;
const BANNED_LABEL = /^(?:zespół nailfolio|zespol nailfolio)$/i;
const APP_URL_PATH = '{{appUrl}}/';
const PRICE_RE = /[1-9][0-9]* ?(zł|PLN|EUR|€)/;
const PRICE_ALLOW = [
  /\.reviews\./,
  /^static\.pricing\.anchorBanner\.text$/,
  /^static\.compare\.faq\.a4$/,
];
const DE_PRONOUN =
  /(?<![A-Za-zÄÖÜäöüß])(du|dein|deine|deinen|deinem|deiner|deines|dich|dir)(?![A-Za-zÄÖÜäöüß])/iu;
const DE_IMPERATIVE =
  /^(Sieh|Nimm|Geh|Komm|Mach|Schau|Sag|Gib|Lass|Denk|Bleib|Warte|Hol|Probier|Melde)(?![A-Za-zÄÖÜäöüß])/;
const DE_SCHLIESS = /schließ(?:e)? dich/i;

const PHRASE_RULES: readonly { readonly name: string; readonly re: RegExp }[] =
  [
    { name: 'polish-team', re: /polski zespół|Polish team|Polnisches Team/i },
    {
      name: 'not-a-bot-quality',
      re: /nie do bota|nie jesteśmy botem|not a bot|kein Bot/i,
    },
    { name: 'pro-plus', re: /Pro Plus|Pro\+|Pro\s*\+/ },
    {
      name: 'empty-adj',
      re: /nowoczesn[yea]|intuicyjn|prosty w użyciu|easy to use|user[- ]friendly|einfach zu bedienen/i,
    },
    { name: 'bank-grade', re: /standard bankowy|bank-grade|Bankenstandard/i },
    {
      name: 'shares-per-visit',
      re: /udostępnień na wizytę|shares per visit|Freigaben pro Besuch/i,
    },
    {
      name: 'country-year-chip',
      re: /(Polska|Poland|Polen|firma|company|Unternehmen)\s*·\s*20\d{2}/i,
    },
    {
      name: 'polish-as-quality',
      re: /Polska aplikacja|To polskie narzędzie|It is a Polish tool|ein polnisches Tool/i,
    },
    { name: 'founder-it-cv', re: /korzeniami w IT|IT background|Wurzeln in der IT/i },
    {
      name: 'write-the-code-identity',
      re: /Piszę kod|I write the code|Ich schreibe den Code/i,
    },
    {
      name: 'architecture-code-bio',
      re: /architektura, kod|architecture, code|Architektur, Code/i,
    },
    { name: 'founder-given-name', re: /Michał|Michal/ },
  ];

interface CssPos {
  line?: number;
  offset?: number;
}
interface CssNode {
  prop?: string;
  value?: string;
  source?: { start?: CssPos; end?: CssPos };
}
interface CssRoot {
  walkDecls: (cb: (decl: CssNode) => void) => void;
  walkComments: (cb: (comment: CssNode) => void) => void;
}

let parseCss: ((css: string, opts?: { from?: string }) => CssRoot) | undefined;

function cssParser(): (css: string, opts?: { from?: string }) => CssRoot {
  if (parseCss !== undefined) {
    return parseCss;
  }
  const require = createRequire(import.meta.url);
  const mainDir = fileURLToPath(new URL('../../../main/', import.meta.url));
  const id = require.resolve('postcss', { paths: [mainDir] }) as string;
  const loaded = require(id) as {
    parse: (css: string, opts?: { from?: string }) => CssRoot;
  };
  parseCss = loaded.parse;
  return loaded.parse;
}

function push(
  check: MutableCheck,
  file: string,
  line: number,
  message: string
): void {
  check.findings.push({ file, line, message });
}

function skippedMirror(rel: string): boolean {
  return rel.includes('/READONLY-shared-kernel/');
}

function isDashCode(rel: string): boolean {
  if (skippedMirror(rel)) {
    return false;
  }
  if (rel.includes('/__tests__/') || rel.includes('/__mocks__/')) {
    return false;
  }
  if (/\.(test|spec)\.tsx?$/.test(rel)) {
    return false;
  }
  return rel.endsWith('.ts') || rel.endsWith('.tsx');
}

function isDashCss(rel: string): boolean {
  return !skippedMirror(rel) && rel.endsWith('.css');
}

function isPhraseSource(rel: string): boolean {
  if (skippedMirror(rel)) {
    return false;
  }
  if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) {
    return false;
  }
  return rel.endsWith('.ts') || rel.endsWith('.tsx');
}

function isPlanFile(rel: string): boolean {
  return !skippedMirror(rel) && (rel.endsWith('.ts') || rel.endsWith('.tsx'));
}

function walkStrings(
  value: JsonValue,
  segments: string[],
  fn: (segments: readonly string[], text: string) => void
): void {
  if (typeof value === 'string') {
    fn(segments, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkStrings(item, [...segments, `[${index}]`], fn);
    });
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      walkStrings(child, [...segments, key], fn);
    }
  }
}

function shellKey(segments: readonly string[]): string {
  return segments
    .map(segment => /^\[(\d+)\]$/.exec(segment)?.[1] ?? segment)
    .join('.');
}

function phraseAllowed(key: string): boolean {
  return key === 'CAPTCHA_VERIFICATION_FAILED' || key.startsWith('static.reviews.');
}

function eachCopyNode(sf: ts.SourceFile, fn: (node: ts.Node) => void): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      fn(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function cooked(node: ts.Node): string {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node) ||
    ts.isJsxText(node)
  ) {
    return node.text;
  }
  return '';
}

function dotMarker(
  comments: Map<number, string>,
  line: number
): 'reason' | 'bare' | 'none' {
  const text = comments.get(line);
  if (text === undefined || !text.includes('middle-dot-allow:')) {
    return 'none';
  }
  return DOT_REASON.test(text) ? 'reason' : 'bare';
}

function noteDot(
  check: MutableCheck,
  rel: string,
  line: number,
  where: string,
  marker: 'reason' | 'bare' | 'none'
): void {
  if (marker === 'reason') {
    return;
  }
  if (marker === 'bare') {
    push(
      check,
      rel,
      line,
      `bare middle-dot-allow marker does not waive a middle dot in ${where}`
    );
    return;
  }
  push(check, rel, line, `rendered middle dot in ${where}`);
}

function scanLocaleJson(check: MutableCheck, root: string, relDir: string): void {
  const files = walk(root, relDir, rel => rel.endsWith('.json'));
  if (files.length === 0) {
    check.errors.push(`no JSON files under ${relDir}`);
    return;
  }
  let strings = 0;
  for (const rel of files) {
    const loaded = loadJson(root, rel);
    if (!loaded.ok) {
      check.errors.push(loaded.error);
      continue;
    }
    walkStrings(loaded.doc.data, [], (segments, text) => {
      strings += 1;
      check.sites += 1;
      const line = loaded.doc.lineOf(segments);
      if (JSON_DASH.test(text)) {
        push(check, rel, line, 'em/en dash in locale copy');
      }
      if (JSON_DOT.test(text)) {
        push(check, rel, line, 'middle dot in locale copy');
      }
      if (ARROW_END.test(text.trimEnd())) {
        push(check, rel, line, 'label ends with an arrow');
      }
    });
  }
  if (strings === 0) {
    check.errors.push(`no string values under ${relDir}`);
  }
}

export function checkCopyDashes(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'copy-dashes',
    MIN_DASHES,
    'locale values, code strings and CSS content values'
  );
  assertPaths(check, root, [APP_LOCALES, EMAIL_LOCALES, CODE_ROOT]);
  if (check.errors.length > 0) {
    return check;
  }
  scanLocaleJson(check, root, APP_LOCALES);
  scanLocaleJson(check, root, EMAIL_LOCALES);
  const codeFiles = walk(root, CODE_ROOT, isDashCode);
  const cssFiles = walk(root, CODE_ROOT, isDashCss);
  if (codeFiles.length === 0) {
    check.errors.push('no ts/tsx files under main/src');
  }
  if (cssFiles.length === 0) {
    check.errors.push('no css files under main/src');
  }
  for (const rel of codeFiles) {
    const text = readText(root, rel);
    const sf = parseTs(rel, text);
    const comments = commentsByLine(rel, text);
    eachCopyNode(sf, node => {
      check.sites += 1;
      const raw = node.getText(sf);
      const at = raw.search(CODE_DOT);
      if (at < 0) {
        return;
      }
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf) + at).line + 1;
      noteDot(check, rel, line, 'code', dotMarker(comments, line));
    });
  }
  const parse = cssParser();
  for (const rel of cssFiles) {
    const text = readText(root, rel);
    let css: CssRoot;
    try {
      css = parse(text, { from: rel });
    } catch (error) {
      check.errors.push(
        `${rel} CSS parse failed (${error instanceof Error ? error.message : String(error)})`
      );
      continue;
    }
    const comments = new Map<number, string>();
    css.walkComments(comment => {
      const start = comment.source?.start?.offset ?? 0;
      const end = comment.source?.end?.offset ?? start;
      const raw = text.slice(start, end);
      const startLine = lineAt(text, start);
      raw.split('\n').forEach((part, index) => {
        const line = startLine + index;
        comments.set(line, `${comments.get(line) ?? ''} ${part}`);
      });
    });
    css.walkDecls(decl => {
      if (decl.prop?.toLowerCase() !== 'content') {
        return;
      }
      check.sites += 1;
      const start = decl.source?.start?.offset ?? 0;
      const end = decl.source?.end?.offset ?? text.length;
      const raw = text.slice(start, end);
      const at = raw.search(CSS_DOT);
      if (at < 0) {
        return;
      }
      const line = lineAt(text, start + at);
      noteDot(check, rel, line, 'CSS content', dotMarker(comments, line));
    });
  }
  return check;
}

function phraseHits(text: string, founderOnly: boolean, allow: boolean, key: string): string[] {
  const names: string[] = [];
  for (const rule of PHRASE_RULES) {
    if (founderOnly && rule.name !== 'founder-given-name') {
      continue;
    }
    if (allow && rule.name !== 'founder-given-name' && phraseAllowed(key)) {
      continue;
    }
    if (rule.re.test(text)) {
      names.push(rule.name);
    }
  }
  return names;
}

export function checkCopyPhrases(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'copy-phrases',
    MIN_PHRASES,
    'locale values, llms texts and source string literals'
  );
  assertPaths(check, root, [...PHRASE_JSON, ...PHRASE_TEXT, ...PHRASE_SOURCE]);
  if (check.errors.length > 0) {
    return check;
  }
  for (const rel of PHRASE_JSON) {
    const loaded = loadJson(root, rel);
    if (!loaded.ok) {
      check.errors.push(loaded.error);
      continue;
    }
    walkStrings(loaded.doc.data, [], (segments, text) => {
      check.sites += 1;
      const key = shellKey(segments);
      for (const name of phraseHits(text, false, true, key)) {
        push(check, rel, loaded.doc.lineOf(segments), `banned phrase ${name} (${key})`);
      }
    });
  }
  for (const rel of PHRASE_TEXT) {
    const text = readText(root, rel);
    check.sites += 1;
    for (const name of phraseHits(text, true, false, '(file)')) {
      const at = text.search(/Michał|Michal/);
      push(check, rel, at < 0 ? 1 : lineAt(text, at), `banned phrase ${name}`);
    }
  }
  for (const dir of PHRASE_SOURCE) {
    for (const rel of walk(root, dir, isPhraseSource)) {
      const text = readText(root, rel);
      const sf = parseTs(rel, text);
      eachCopyNode(sf, node => {
        const value = cooked(node);
        check.sites += 1;
        for (const name of phraseHits(value, false, false, '(literal)')) {
          push(check, rel, nodeLine(sf, node), `banned phrase ${name}`);
        }
      });
    }
  }
  return check;
}

export function checkCopyDeSie(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'copy-de-sie',
    MIN_DE,
    'German locale string values'
  );
  assertPaths(
    check,
    root,
    DE_FILES.map(([, rel]) => rel)
  );
  if (check.errors.length > 0) {
    return check;
  }
  for (const [group, rel] of DE_FILES) {
    const loaded = loadJson(root, rel);
    if (!loaded.ok) {
      check.errors.push(loaded.error);
      continue;
    }
    walkStrings(loaded.doc.data, [], (segments, text) => {
      check.sites += 1;
      const key = shellKey(segments);
      if (key.startsWith('static.reviews.')) {
        return;
      }
      const pronoun = DE_PRONOUN.exec(text);
      if (pronoun?.[1] !== undefined) {
        push(
          check,
          rel,
          loaded.doc.lineOf(segments),
          `German du-form ${pronoun[1]} (${group} ${key})`
        );
        return;
      }
      if (DE_SCHLIESS.test(text) || DE_IMPERATIVE.test(text.trim())) {
        push(
          check,
          rel,
          loaded.doc.lineOf(segments),
          `German 2sg imperative (${group} ${key})`
        );
      }
    });
  }
  return check;
}

function frontMatter(
  text: string
): Map<string, { value: string; line: number }> | undefined {
  const lines = text.split('\n');
  if ((lines[0] ?? '').replace(/\r$/, '').trim() !== '---') {
    return undefined;
  }
  const fields = new Map<string, { value: string; line: number }>();
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').replace(/\r$/, '');
    if (line.trim() === '---') {
      return fields;
    }
    const match = /^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/.exec(line);
    if (match?.[1] !== undefined) {
      fields.set(match[1], { value: match[2] ?? '', line: i + 1 });
    }
  }
  return undefined;
}

export function checkBlogCopy(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'blog-copy',
    MIN_BLOG,
    'blog front-matter fields'
  );
  assertPaths(check, root, [BLOG_DIR]);
  if (check.errors.length > 0) {
    return check;
  }
  const posts = walk(root, BLOG_DIR, rel => rel.endsWith('.mdx'));
  if (posts.length === 0) {
    check.errors.push(`no .mdx posts under ${BLOG_DIR}`);
    return check;
  }
  for (const rel of posts) {
    const text = readText(root, rel);
    const fields = frontMatter(text);
    for (const key of BLOG_FIELDS) {
      check.sites += 1;
      const field = fields?.get(key);
      if (field === undefined) {
        push(check, rel, 1, `front matter missing '${key}'`);
      }
    }
    const author = fields?.get('author');
    if (author !== undefined && AUTHOR_BANNED.test(author.value)) {
      push(check, rel, author.line, 'author is a fictional department');
    }
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (line.includes('\u2014') || line.includes('\u2013')) {
        push(check, rel, index + 1, 'em/en dash in blog copy');
      }
    });
  }
  if (existsSync(path.join(root, BLOG_UTILS))) {
    const text = readText(root, BLOG_UTILS);
    const sf = parseTs(BLOG_UTILS, text);
    eachCopyNode(sf, node => {
      if (BANNED_LABEL.test(cooked(node).trim())) {
        push(
          check,
          BLOG_UTILS,
          nodeLine(sf, node),
          'blog.utils.ts fallback writes the banned author label'
        );
      }
    });
  }
  return check;
}

function isPlanIdTarget(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) {
    return node.text === 'planId';
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === 'planId';
  }
  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression;
    return ts.isStringLiteral(arg) && arg.text === 'planId';
  }
  return false;
}

function planLiteral(
  expr: ts.Expression | undefined
): ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined {
  if (expr === undefined) {
    return undefined;
  }
  const value = unwrapExpr(expr);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value;
  }
  return undefined;
}

function notePlanLiteral(
  check: MutableCheck,
  sf: ts.SourceFile,
  comments: Map<number, string>,
  rel: string,
  expr: ts.Expression | undefined
): void {
  const literal = planLiteral(expr);
  if (literal === undefined) {
    return;
  }
  const line = nodeLine(sf, literal);
  const marker = markerIn(comments, 'planid-literal-allow', line, line);
  if (marker === 'reason') {
    return;
  }
  if (marker === 'bare') {
    push(
      check,
      rel,
      line,
      'bare planid-literal-allow marker does not waive a planId string literal'
    );
    return;
  }
  push(check, rel, line, `planId string literal ${JSON.stringify(literal.text)}`);
}

export function checkBillingPlanId(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'billing-plan-id',
    MIN_PLAN,
    'planId bindings outside the kernel'
  );
  assertPaths(check, root, [...PLAN_ROOTS]);
  if (check.errors.length > 0) {
    return check;
  }
  for (const dir of PLAN_ROOTS) {
    for (const rel of walk(root, dir, isPlanFile)) {
      const text = readText(root, rel);
      const sf = parseTs(rel, text);
      const comments = commentsByLine(rel, text);
      const visit = (node: ts.Node): void => {
        if (
          (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) &&
          node.name !== undefined &&
          propName(node.name) === 'planId'
        ) {
          check.sites += 1;
          notePlanLiteral(check, sf, comments, rel, node.initializer);
        } else if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === 'planId'
        ) {
          check.sites += 1;
          notePlanLiteral(check, sf, comments, rel, node.initializer);
        } else if (
          ts.isBindingElement(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === 'planId'
        ) {
          check.sites += 1;
          notePlanLiteral(check, sf, comments, rel, node.initializer);
        } else if (
          ts.isParameter(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === 'planId'
        ) {
          check.sites += 1;
          notePlanLiteral(check, sf, comments, rel, node.initializer);
        } else if (
          ts.isShorthandPropertyAssignment(node) &&
          node.name.text === 'planId'
        ) {
          check.sites += 1;
        } else if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          isPlanIdTarget(node.left)
        ) {
          check.sites += 1;
          notePlanLiteral(check, sf, comments, rel, node.right);
        } else if (
          ts.isJsxAttribute(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === 'planId'
        ) {
          check.sites += 1;
          const init = node.initializer;
          if (init !== undefined && ts.isStringLiteral(init)) {
            notePlanLiteral(check, sf, comments, rel, init);
          } else if (
            init !== undefined &&
            ts.isJsxExpression(init) &&
            init.expression !== undefined
          ) {
            notePlanLiteral(check, sf, comments, rel, init.expression);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return check;
}

export function checkBillingEmailCta(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'billing-email-cta',
    MIN_CTA,
    'email-handler string and template chunks'
  );
  assertPaths(check, root, [EMAIL_HANDLER]);
  if (check.errors.length > 0) {
    return check;
  }
  const files = walk(root, EMAIL_HANDLER, rel => rel.endsWith('.ts'));
  if (files.length === 0) {
    check.errors.push(`no ts files under ${EMAIL_HANDLER}`);
    return check;
  }
  for (const rel of files) {
    const text = readText(root, rel);
    const sf = parseTs(rel, text);
    eachCopyNode(sf, node => {
      if (ts.isJsxText(node)) {
        return;
      }
      const value = cooked(node);
      check.sites += 1;
      if (value.includes(APP_URL_PATH)) {
        push(check, rel, nodeLine(sf, node), 'email CTA uses {{appUrl}}/ with a raw path');
      }
    });
  }
  return check;
}

export function checkBillingPrices(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'billing-prices',
    MIN_PRICES,
    'common.json string values'
  );
  assertPaths(check, root, PRICE_FILES);
  if (check.errors.length > 0) {
    return check;
  }
  for (const rel of PRICE_FILES) {
    const loaded = loadJson(root, rel);
    if (!loaded.ok) {
      check.errors.push(loaded.error);
      continue;
    }
    let strings = 0;
    walkStrings(loaded.doc.data, [], (segments, text) => {
      strings += 1;
      check.sites += 1;
      const key = shellKey(segments);
      const line = loaded.doc.lineOf(segments);
      if (PRICE_RE.test(text) && !PRICE_ALLOW.some(allow => allow.test(key))) {
        push(check, rel, line, `plan price in copy (${key})`);
      }
      const leaf = segments.at(-1);
      if ((leaf === 'trialLede' || leaf === 'freeLede') && !text.includes('{price}')) {
        push(check, rel, line, `trialLede/freeLede must include the formatted {price} (${key})`);
      }
    });
    if (strings === 0) {
      check.errors.push(`no string values in ${rel}`);
    }
  }
  return check;
}

export function run(root: string): CheckResult[] {
  return [
    checkCopyDashes(root),
    checkCopyPhrases(root),
    checkCopyDeSie(root),
    checkBlogCopy(root),
    checkBillingPlanId(root),
    checkBillingEmailCta(root),
    checkBillingPrices(root),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('copy-policy', run(projectRoot())));
}
