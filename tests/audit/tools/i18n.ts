// i18n — translation files are complete, in sync across locales and safe to render.
// Successor of tests/audit/i18n-coverage.sh, i18n-interpolation-parity.sh, events-i18n-parity.sh,
// events-i18n-coverage.sh and email-locale-parity.sh. Checks:
//  1. validation-keys: kernel `'validation.*'` literals (`validation.i18n.ts`, code only) equal the
//     `validation.*` keys of every common.json, both directions.
//  2. common-parity / 3. common-empty: every common.json leaf exists in every locale, none empty.
//  4. interpolation:<group>: per key, CONTENT parameters are identical across locales (ICU via
//     next-intl's parser for common/events, strict `{{param}}` for kernel e-mails). A plural
//     selector used only for inflection is grammar. Unparseable ICU, malformed mustache = finding.
//  5. events-parity: every events.json key exists in every locale, none empty.
//  6. events-coverage: every INFO event reaching the HTTP envelope from web-1/src, unless in
//     `eventsDisallowedForUI`, has a key in every events.json (else the snackbar shows the token).
//  7. email-parity: kernel e-mail locale files have the same non-empty leaf keys (EN/DE are cast to
//     the PL type, so TypeScript cannot see drift). Locales come from `I18N_CONFIG.locales`.
// DECISION: JSON.parse, never a lenient reader; sorting is code-unit order, so LC_ALL does not matter.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  assertPaths,
  newCheck,
  parseTs,
  projectRoot,
  report,
  walk,
  type CheckResult,
  type MutableCheck,
} from './_lib';
import {
  isObject,
  loadJson,
  type JsonDoc,
  type JsonLoad,
  type JsonValue,
} from './_json';
import {
  boundResponderEmissions,
  successEventsByKey,
} from './endpoint-bind';
import { nodeLine, objectProp, propName, unwrapExpr } from './_ts';

export const I18N_CONFIG_FILE = '.shared-kernel/domain/i18n/i18n.config.ts';
export const VALIDATION_FILE = '.shared-kernel/domain/i18n/validation.i18n.ts';
export const LOCALES_DIR = 'main/src/locales';
export const EMAIL_LOCALES_DIR = '.shared-kernel/domain/email/locales';
export const APP_EVENTS_FILE =
  '.shared-kernel/domain/events/app-events.const.ts';
export const CQRS_FILE =
  '.shared-kernel/domain/commands-and-queries/cqrs.config.ts';
export const BACKEND_SRC = 'web-1/src';
const ICU_PARSER = '@formatjs/icu-messageformat-parser';

export const commonFile = (locale: string): string =>
  `${LOCALES_DIR}/${locale}/common.json`;
export const eventsFile = (locale: string): string =>
  `${LOCALES_DIR}/${locale}/events.json`;
export const emailFile = (locale: string): string =>
  `${EMAIL_LOCALES_DIR}/email-i18n.${locale}.json`;

/**
 * Presence floors (measured 2026-10-23 on the real tree → floor). validation keys 225 → 180;
 * common.json leaf keys 5371 → 4000; common.json string values 3 × 5371 → 12000; interpolation
 * keys common 5371 → 4000, events 245 → 180, e-mail 286 → 220; events.json keys 245 → 180;
 * UI-emitted INFO events 165 → 120 (contract `ok` / `created` included; the floor stays 120);
 * e-mail leaf keys 286 → 220.
 */
export const FLOORS = {
  validationKeys: 180,
  commonKeys: 4000,
  commonValues: 12000,
  interpolationCommon: 4000,
  interpolationEvents: 180,
  interpolationEmail: 220,
  eventsKeys: 180,
  emittedEvents: 120,
  emailKeys: 220,
} as const;

// ── ICU ─────────────────────────────────────────────────────────────────────────────────────
// formatjs AST element types: 1 argument, 2 number, 3 date, 4 time, 5 select, 6 plural,
// 7 pound (#), 8 tag.
export interface IcuElement {
  readonly type: number;
  readonly value?: string;
  readonly children?: IcuElement[];
  readonly options?: Record<string, { readonly value: IcuElement[] }>;
}
export interface IcuParser {
  parse(message: string): IcuElement[];
}

/** The parser next-intl itself uses, resolved from main's own node_modules. */
export function loadIcuParser(root: string): IcuParser {
  const require = createRequire(path.join(root, 'main', 'package.json'));
  return require(ICU_PARSER) as IcuParser;
}

function collectContent(
  ast: readonly IcuElement[],
  out: Set<string>,
  pluralArg: string | null
): Set<string> {
  for (const el of ast) {
    if (el.type >= 1 && el.type <= 5 && el.value !== undefined) {
      out.add(el.value);
    }
    if (el.type === 7 && pluralArg !== null) {
      out.add(pluralArg);
    }
    if (el.type === 8) {
      out.add(`<${el.value ?? ''}>`);
      collectContent(el.children ?? [], out, pluralArg);
    }
    if ((el.type === 5 || el.type === 6) && el.options !== undefined) {
      for (const option of Object.values(el.options)) {
        collectContent(option.value, out, el.value ?? null);
      }
    }
  }
  return out;
}

const MUSTACHE_PLURAL = /\{\{([A-Za-z0-9_]+)#([^{}|]+(?:\|[^{}|]+)*)\}\}/g;

/**
 * Content parameters of one message, sorted and joined; throws on a malformed message.
 * Mustache = the kernel renderer's exact `/\{\{(\w+)\}\}/` plus the plural form
 * `{{key#one|few|many}}` (parameter = the part before `#`).
 */
export function contentParams(
  message: string,
  syntax: 'icu' | 'mustache',
  parser: IcuParser
): string {
  if (syntax === 'mustache') {
    const plural = [...message.matchAll(MUSTACHE_PLURAL)].map(m => m[1] ?? '');
    const rest = message.replace(MUSTACHE_PLURAL, '');
    if (/\{\{(?![A-Za-z0-9_]+\}\})/.test(rest)) {
      throw new Error(
        'malformed mustache (space, dot or other character inside {{…}}: the renderer will not interpolate it)'
      );
    }
    if (/(^|[^{])\{[A-Za-z0-9_]+\}(?!\})/.test(rest)) {
      throw new Error(
        'single-brace {x} in a mustache group: the renderer interpolates only {{x}}'
      );
    }
    const plain = [...rest.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)].map(
      m => m[1] ?? ''
    );
    return [...plain, ...plural].sort().join(',');
  }
  return [...collectContent(parser.parse(message), new Set(), null)]
    .sort()
    .join(',');
}

// ── JSON shapes ─────────────────────────────────────────────────────────────────────────────

interface Leaf {
  readonly segments: readonly string[];
  readonly value: JsonValue;
}

/** Leaves of nested objects; arrays are leaves (the shape i18n-coverage used). */
function objectLeaves(
  value: JsonValue,
  prefix: readonly string[] = [],
  out: Leaf[] = []
): Leaf[] {
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (isObject(child)) {
        objectLeaves(child, [...prefix, key], out);
      } else {
        out.push({ segments: [...prefix, key], value: child });
      }
    }
  }
  return out;
}

/** Leaves of objects AND arrays (`key.[i]`); every non-container value is a leaf. */
function deepLeaves(
  value: JsonValue,
  prefix: readonly string[] = [],
  out: Leaf[] = []
): Leaf[] {
  if (Array.isArray(value)) {
    value.forEach((child, i) => {
      if (child !== null && typeof child === 'object') {
        deepLeaves(child, [...prefix, `[${i}]`], out);
      } else {
        out.push({ segments: [...prefix, `[${i}]`], value: child });
      }
    });
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (child !== null && typeof child === 'object') {
        deepLeaves(child, [...prefix, key], out);
      } else {
        out.push({ segments: [...prefix, key], value: child });
      }
    }
  }
  return out;
}

const dotted = (segments: readonly string[]): string =>
  segments.map((s, i) => (i > 0 && !s.startsWith('[') ? `.${s}` : s)).join('');

interface Ctx {
  readonly root: string;
  readonly locales: readonly string[];
  readonly cache: Map<string, JsonLoad>;
  readonly parser: () => IcuParser;
}

/** Loads one file per locale; a missing or broken file becomes an error of the check. */
function loadAll(
  ctx: Ctx,
  check: MutableCheck,
  file: (locale: string) => string
): Map<string, JsonDoc> {
  const docs = new Map<string, JsonDoc>();
  for (const locale of ctx.locales) {
    const loaded = loadJson(ctx.root, file(locale), ctx.cache);
    if (loaded.ok) {
      docs.set(locale, loaded.doc);
    } else {
      check.errors.push(loaded.error);
    }
  }
  return docs;
}

/** Union diff of key sets: a key some locale has and another lacks is a finding at the lacking file. */
function parity(
  check: MutableCheck,
  docs: Map<string, JsonDoc>,
  leaves: (doc: JsonDoc) => Leaf[],
  fix: string
): void {
  const keysByLocale = new Map<string, Set<string>>();
  const where = new Map<
    string,
    { doc: JsonDoc; segments: readonly string[] }
  >();
  for (const [locale, doc] of docs) {
    const keys = new Set<string>();
    for (const leaf of leaves(doc)) {
      const key = dotted(leaf.segments);
      keys.add(key);
      if (!where.has(key)) {
        where.set(key, { doc, segments: leaf.segments });
      }
    }
    keysByLocale.set(locale, keys);
  }
  const union = [
    ...new Set([...keysByLocale.values()].flatMap(keys => [...keys])),
  ].sort();
  check.sites = union.length;
  for (const [locale, keys] of keysByLocale) {
    const doc = docs.get(locale);
    if (doc === undefined) {
      continue;
    }
    for (const key of union) {
      if (!keys.has(key)) {
        const origin = where.get(key);
        const seen =
          origin === undefined
            ? ''
            : ` (present in ${origin.doc.rel}:${origin.doc.lineOf(origin.segments)})`;
        check.findings.push({
          file: doc.rel,
          line: 1,
          message: `missing key \`${key}\`${seen}. ${fix}`,
        });
      }
    }
  }
}

function emptyValues(
  check: MutableCheck,
  docs: Map<string, JsonDoc>,
  leaves: (doc: JsonDoc) => Leaf[]
): number {
  let values = 0;
  for (const doc of docs.values()) {
    for (const leaf of leaves(doc)) {
      if (typeof leaf.value !== 'string') {
        continue;
      }
      values++;
      if (leaf.value.trim() === '') {
        check.findings.push({
          file: doc.rel,
          line: doc.lineOf(leaf.segments),
          message: `empty translation \`${dotted(leaf.segments)}\`: it renders as a blank. Write the text.`,
        });
      }
    }
  }
  return values;
}

// ── TypeScript sources ──────────────────────────────────────────────────────────────────────

function readSource(root: string, rel: string): ts.SourceFile {
  return parseTs(rel, readFileSync(path.join(root, rel), 'utf8'));
}

function findVariable(
  sf: ts.SourceFile,
  name: string
): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) {
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Expression without type wrappers and an `Object.freeze(…)` call around it. */
function literalOf(node: ts.Expression | undefined): ts.Expression | undefined {
  if (node === undefined) {
    return undefined;
  }
  const inner = unwrapExpr(node);
  if (
    ts.isCallExpression(inner) &&
    inner.expression.getText().replace(/\s+/g, '') === 'Object.freeze' &&
    inner.arguments[0] !== undefined
  ) {
    return unwrapExpr(inner.arguments[0]);
  }
  return inner;
}

/** `I18N_CONFIG.locales` as written in the kernel config. */
export function readLocales(root: string, check: MutableCheck): string[] {
  const sf = readSource(root, I18N_CONFIG_FILE);
  const obj = literalOf(findVariable(sf, 'I18N_CONFIG')?.initializer);
  const prop =
    obj !== undefined && ts.isObjectLiteralExpression(obj)
      ? objectProp(obj, 'locales')
      : undefined;
  const array =
    prop !== undefined && ts.isPropertyAssignment(prop)
      ? literalOf(prop.initializer)
      : undefined;
  if (array === undefined || !ts.isArrayLiteralExpression(array)) {
    check.errors.push(
      `${I18N_CONFIG_FILE}: I18N_CONFIG.locales is not an array literal; the locale list cannot be read`
    );
    return [];
  }
  const locales: string[] = [];
  for (const element of array.elements) {
    if (ts.isStringLiteral(element)) {
      locales.push(element.text);
    } else {
      check.errors.push(
        `${I18N_CONFIG_FILE}:${nodeLine(sf, element)}: a locale that is not a string literal`
      );
    }
  }
  return locales;
}

const INFO_TOKEN = /^APP_EVENTS\.INFO\.[A-Z0-9_]+\.[A-Z0-9_]+$/;

/** `APP_EVENTS.INFO.<GROUP>.<PROP>` written as a plain property chain (no whitespace, no `?.`). */
function infoToken(node: ts.Node, sf: ts.SourceFile): string | undefined {
  if (!ts.isPropertyAccessExpression(node)) {
    return undefined;
  }
  const text = node.getText(sf).replace(/\s+/g, '');
  return INFO_TOKEN.test(text) ? text : undefined;
}

function infoTokensIn(
  node: ts.Node,
  sf: ts.SourceFile,
  out: string[] = []
): string[] {
  const token = infoToken(node, sf);
  if (token !== undefined) {
    out.push(token);
    return out;
  }
  ts.forEachChild(node, child => {
    infoTokensIn(child, sf, out);
  });
  return out;
}

/** Path → value of every `APP_EVENTS.INFO.<GROUP>.<PROP>` (the value can differ from the name). */
export function readInfoEvents(
  root: string,
  check: MutableCheck
): Map<string, string> {
  const map = new Map<string, string>();
  const sf = readSource(root, APP_EVENTS_FILE);
  const obj = literalOf(findVariable(sf, 'APP_EVENTS')?.initializer);
  const info =
    obj !== undefined && ts.isObjectLiteralExpression(obj)
      ? objectProp(obj, 'INFO')
      : undefined;
  const groups =
    info !== undefined && ts.isPropertyAssignment(info)
      ? literalOf(info.initializer)
      : undefined;
  if (groups === undefined || !ts.isObjectLiteralExpression(groups)) {
    check.errors.push(
      `${APP_EVENTS_FILE}: APP_EVENTS.INFO is not an object literal`
    );
    return map;
  }
  for (const group of groups.properties) {
    const groupName = ts.isPropertyAssignment(group)
      ? propName(group.name)
      : undefined;
    const events =
      groupName !== undefined && ts.isPropertyAssignment(group)
        ? literalOf(group.initializer)
        : undefined;
    if (
      groupName === undefined ||
      events === undefined ||
      !ts.isObjectLiteralExpression(events)
    ) {
      check.errors.push(
        `${APP_EVENTS_FILE}:${nodeLine(sf, group)}: an INFO group that is not a named object literal`
      );
      continue;
    }
    for (const event of events.properties) {
      const name = ts.isPropertyAssignment(event)
        ? propName(event.name)
        : undefined;
      const value = ts.isPropertyAssignment(event)
        ? unwrapExpr(event.initializer)
        : undefined;
      if (
        name === undefined ||
        value === undefined ||
        !ts.isStringLiteralLike(value)
      ) {
        check.errors.push(
          `${APP_EVENTS_FILE}:${nodeLine(sf, event)}: an INFO event whose value is not a string literal`
        );
        continue;
      }
      map.set(`APP_EVENTS.INFO.${groupName}.${name}`, value.text);
    }
  }
  return map;
}

const RESPOND_NAME = /^respond[A-Z][A-Za-z]*$/;

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  return undefined;
}

/** Function-like value of a `respond*` declaration (`const respondX = (…) => …` or `function respondX`). */
function respondHelper(
  node: ts.Node
): { name: string; fn: ts.SignatureDeclaration } | undefined {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name !== undefined &&
    RESPOND_NAME.test(node.name.text)
  ) {
    return { name: node.name.text, fn: node };
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    RESPOND_NAME.test(node.name.text) &&
    node.initializer !== undefined
  ) {
    const init = unwrapExpr(node.initializer);
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      return { name: node.name.text, fn: init };
    }
  }
  return undefined;
}

interface Emission {
  readonly emitted: Set<string>;
  readonly files: number;
}

/** Every INFO event value that reaches the response envelope from web-1/src. */
export function emittedEvents(
  root: string,
  pathToValue: Map<string, string>
): Emission {
  const files = walk(
    root,
    BACKEND_SRC,
    rel => rel.endsWith('.ts') && !rel.includes('READONLY-shared-kernel')
  );
  // Only files that can hold a respond*(), .json(), or a contract ok/created call are parsed
  // (a plain-text prefilter; the AST decides what counts). `ok(` is required: a contract handler
  // no longer spells `respondSuccess`, so a respond-only prefilter dropped those events.
  const sources = files.flatMap(rel => {
    const text = readFileSync(path.join(root, rel), 'utf8');
    return text.includes('respond') ||
      text.includes('.json(') ||
      text.includes('ok(') ||
      text.includes('created(') ||
      text.includes('defineEndpoint') ||
      text.includes('bindEndpoint')
      ? [parseTs(rel, text)]
      : [];
  });
  const emitted = new Set<string>();
  const add = (token: string): void => {
    const value = pathToValue.get(token);
    if (value !== undefined) {
      emitted.add(value);
    }
  };

  // Default events of respond* helpers, read from their parameter defaults
  // (`event: EVENT_INFO_TYPE = APP_EVENTS.INFO.…`). Events a helper passes in its own body are
  // emitted by the scan below, because the body is a respond*() call like any other.
  const defaults = new Map<string, string[]>();
  for (const sf of sources) {
    const visit = (node: ts.Node): void => {
      const helper = respondHelper(node);
      if (helper !== undefined) {
        const tokens = helper.fn.parameters.flatMap(p =>
          p.initializer === undefined ? [] : infoTokensIn(p.initializer, sf)
        );
        defaults.set(helper.name, [
          ...(defaults.get(helper.name) ?? []),
          ...tokens,
        ]);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  for (const sf of sources) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node);
        if (name !== undefined && RESPOND_NAME.test(name)) {
          const tokens = node.arguments.flatMap(arg => infoTokensIn(arg, sf));
          if (tokens.length > 0) {
            tokens.forEach(add);
          } else {
            (defaults.get(name) ?? []).forEach(add);
          }
          // A map indexed in the event argument: respondX(res, someMap[reason], …).
          const second = node.arguments[1];
          if (
            second !== undefined &&
            ts.isElementAccessExpression(second) &&
            ts.isIdentifier(second.expression)
          ) {
            const init = findVariable(sf, second.expression.text)?.initializer;
            if (init !== undefined) {
              infoTokensIn(init, sf).forEach(add);
            }
          }
        }
        if (name === 'json' && ts.isPropertyAccessExpression(node.expression)) {
          const visitArg = (child: ts.Node): void => {
            if (
              ts.isPropertyAssignment(child) &&
              propName(child.name) === 'event'
            ) {
              const token = infoToken(unwrapExpr(child.initializer), sf);
              if (token !== undefined) {
                add(token);
              }
            }
            ts.forEachChild(child, visitArg);
          };
          node.arguments.forEach(visitArg);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // Contract handlers answer through scope.ok / scope.created, which forward the event to
  // respondSuccess / respondCreated. The event argument is counted; when it is not a literal,
  // every successEvents entry of the bound contract can reach the envelope.
  const success = successEventsByKey(root);
  for (const sf of sources) {
    const extra = boundResponderEmissions(sf, success, root);
    extra.tokens.forEach(add);
    for (const value of extra.values) {
      emitted.add(value);
    }
  }
  return { emitted, files: sources.length };
}

/** Values of `eventsDisallowedForUI` (cqrs.config.ts); an entry that does not resolve is an error. */
export function readDisallowed(
  root: string,
  pathToValue: Map<string, string>,
  check: MutableCheck
): Set<string> {
  const out = new Set<string>();
  const sf = readSource(root, CQRS_FILE);
  const init = findVariable(sf, 'eventsDisallowedForUI')?.initializer;
  if (init === undefined) {
    check.errors.push(`${CQRS_FILE}: eventsDisallowedForUI not found`);
    return out;
  }
  const visit = (node: ts.Node): void => {
    const token = infoToken(node, sf);
    if (token !== undefined) {
      const value = pathToValue.get(token);
      if (value === undefined) {
        check.errors.push(
          `${CQRS_FILE}:${nodeLine(sf, node)}: ${token} is not an APP_EVENTS.INFO event`
        );
      } else {
        out.add(value);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(init);
  return out;
}

// ── checks ──────────────────────────────────────────────────────────────────────────────────

function checkValidationKeys(ctx: Ctx): CheckResult {
  const check: MutableCheck = newCheck(
    'i18n:validation-keys',
    FLOORS.validationKeys,
    `validation keys in ${VALIDATION_FILE}`
  );
  assertPaths(check, ctx.root, [VALIDATION_FILE]);
  const docs = loadAll(ctx, check, commonFile);
  if (check.errors.some(e => e.includes(VALIDATION_FILE))) {
    return check;
  }
  const sf = readSource(ctx.root, VALIDATION_FILE);
  const expected = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteralLike(node) &&
      node.text.startsWith('validation.') &&
      !expected.has(node.text)
    ) {
      expected.set(node.text, nodeLine(sf, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  check.sites = expected.size;
  for (const doc of docs.values()) {
    const present = new Map(
      objectLeaves(doc.data)
        .filter(leaf => leaf.segments[0] === 'validation')
        .map(leaf => [dotted(leaf.segments), leaf.segments] as const)
    );
    for (const [key, line] of [...expected].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )) {
      if (!present.has(key)) {
        check.findings.push({
          file: doc.rel,
          line: 1,
          message: `missing validation key \`${key}\` (declared at ${VALIDATION_FILE}:${line}). Add the translation.`,
        });
      }
    }
    for (const [key, segments] of [...present].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )) {
      if (!expected.has(key)) {
        check.findings.push({
          file: doc.rel,
          line: doc.lineOf(segments),
          message: `validation key \`${key}\` is not declared in ${VALIDATION_FILE}: nothing can produce it. Remove it or declare it in the SSOT.`,
        });
      }
    }
  }
  return check;
}

function checkCommonParity(ctx: Ctx): CheckResult {
  const check: MutableCheck = newCheck(
    'i18n:common-parity',
    FLOORS.commonKeys,
    'common.json keys (union)'
  );
  const docs = loadAll(ctx, check, commonFile);
  parity(check, docs, doc => objectLeaves(doc.data), 'Add it to every locale.');
  return check;
}

function checkCommonEmpty(ctx: Ctx): CheckResult {
  const check: MutableCheck = newCheck(
    'i18n:common-empty',
    FLOORS.commonValues,
    'common.json string values'
  );
  const docs = loadAll(ctx, check, commonFile);
  check.sites = emptyValues(check, docs, doc => objectLeaves(doc.data));
  return check;
}

const GROUPS: readonly {
  id: string;
  file: (l: string) => string;
  syntax: 'icu' | 'mustache';
  floor: number;
}[] = [
  {
    id: 'common',
    file: commonFile,
    syntax: 'icu',
    floor: FLOORS.interpolationCommon,
  },
  {
    id: 'events',
    file: eventsFile,
    syntax: 'icu',
    floor: FLOORS.interpolationEvents,
  },
  {
    id: 'email',
    file: emailFile,
    syntax: 'mustache',
    floor: FLOORS.interpolationEmail,
  },
];

function checkInterpolation(
  ctx: Ctx,
  group: (typeof GROUPS)[number]
): CheckResult {
  const check: MutableCheck = newCheck(
    `i18n:interpolation:${group.id}`,
    group.floor,
    `${group.id} keys`
  );
  const docs = loadAll(ctx, check, group.file);
  let parser: IcuParser | undefined;
  if (group.syntax === 'icu') {
    try {
      parser = ctx.parser();
    } catch (error) {
      check.errors.push(
        `${ICU_PARSER} cannot be loaded from main/node_modules (run npm ci in main): ${String(error)}`
      );
      return check;
    }
  }
  const byKey = new Map<
    string,
    Map<string, { value: string; segments: readonly string[] }>
  >();
  for (const [locale, doc] of docs) {
    for (const leaf of deepLeaves(doc.data)) {
      if (leaf.value === null) {
        continue;
      }
      const key = dotted(leaf.segments);
      const perLocale =
        byKey.get(key) ??
        new Map<string, { value: string; segments: readonly string[] }>();
      // A non-string leaf is compared as text without parameters: a locale that hardcodes a number
      // where the others interpolate is the same drift.
      perLocale.set(locale, {
        value: typeof leaf.value === 'string' ? leaf.value : String(leaf.value),
        segments: leaf.segments,
      });
      byKey.set(key, perLocale);
    }
  }
  check.sites = byKey.size;
  const noParser: IcuParser = { parse: () => [] };
  for (const [key, perLocale] of [...byKey].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    const sets = new Map<string, string>();
    for (const [locale, entry] of perLocale) {
      const doc = docs.get(locale);
      try {
        sets.set(
          locale,
          contentParams(entry.value, group.syntax, parser ?? noParser)
        );
      } catch (error) {
        check.findings.push({
          file: doc?.rel ?? group.file(locale),
          line: doc?.lineOf(entry.segments) ?? 1,
          message: `\`${key}\` does not parse: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`,
        });
      }
    }
    if (new Set(sets.values()).size > 1) {
      const first = [...perLocale.keys()][0] ?? '';
      const doc = docs.get(first);
      const entry = perLocale.get(first);
      const detail = [...sets]
        .map(([locale, params]) => `${locale} {${params}}`)
        .join(', ');
      check.findings.push({
        file: doc?.rel ?? group.file(first),
        line:
          doc !== undefined && entry !== undefined
            ? doc.lineOf(entry.segments)
            : 1,
        message: `\`${key}\` renders different content parameters per locale: ${detail}. A locale that hardcodes what the others interpolate rots silently; use the same {param} everywhere.`,
      });
    }
  }
  return check;
}

function checkEventsParity(ctx: Ctx): CheckResult {
  const check: MutableCheck = newCheck(
    'i18n:events-parity',
    FLOORS.eventsKeys,
    'events.json keys (union)'
  );
  const docs = loadAll(ctx, check, eventsFile);
  const topLevel = (doc: JsonDoc): Leaf[] =>
    isObject(doc.data)
      ? Object.entries(doc.data).map(([key, value]) => ({
          segments: [key],
          value,
        }))
      : [];
  parity(check, docs, topLevel, 'Add it to every locale.');
  emptyValues(check, docs, topLevel);
  return check;
}

function checkEventsCoverage(ctx: Ctx): CheckResult {
  const check: MutableCheck = newCheck(
    'i18n:events-coverage',
    FLOORS.emittedEvents,
    'UI-emitted INFO events'
  );
  assertPaths(check, ctx.root, [APP_EVENTS_FILE, CQRS_FILE, BACKEND_SRC]);
  const docs = loadAll(ctx, check, eventsFile);
  if (check.errors.length > 0) {
    return check;
  }
  const pathToValue = readInfoEvents(ctx.root, check);
  const disallowed = readDisallowed(ctx.root, pathToValue, check);
  const { emitted } = emittedEvents(ctx.root, pathToValue);
  const visible = [...emitted].filter(event => !disallowed.has(event)).sort();
  check.sites = visible.length;
  for (const event of visible) {
    for (const doc of docs.values()) {
      if (
        !isObject(doc.data) ||
        !Object.prototype.hasOwnProperty.call(doc.data, event)
      ) {
        check.findings.push({
          file: doc.rel,
          line: 1,
          message: `event \`${event}\` reaches the UI but has no translation (the snackbar shows the raw token). Add the key, or add the event to eventsDisallowedForUI in ${CQRS_FILE} if it must not toast.`,
        });
      }
    }
  }
  return check;
}

function checkEmailParity(ctx: Ctx): CheckResult {
  const check: MutableCheck = newCheck(
    'i18n:email-parity',
    FLOORS.emailKeys,
    'e-mail leaf keys (union)'
  );
  const docs = loadAll(ctx, check, emailFile);
  // Leaf paths as the shell guard walked them: arrays are entered with their index as a segment.
  const leaves = (doc: JsonDoc): Leaf[] => deepLeaves(doc.data);
  parity(
    check,
    docs,
    leaves,
    'Add it to every locale, then run npm run system:kernel.'
  );
  emptyValues(check, docs, leaves);
  return check;
}

function checkLocaleDirs(
  root: string,
  locales: readonly string[],
  check: MutableCheck
): void {
  const abs = path.join(root, LOCALES_DIR);
  if (!existsSync(abs)) {
    return;
  }
  for (const entry of readdirSync(abs).sort()) {
    if (
      statSync(path.join(abs, entry)).isDirectory() &&
      !locales.includes(entry)
    ) {
      check.findings.push({
        file: `${LOCALES_DIR}/${entry}`,
        line: 1,
        message: `locale directory \`${entry}\` is not in I18N_CONFIG.locales (${I18N_CONFIG_FILE}); nothing loads it and no check covers it.`,
      });
    }
  }
}

export interface I18nDeps {
  readonly loadParser: (root: string) => IcuParser;
}

export function run(
  root: string,
  deps: I18nDeps = { loadParser: loadIcuParser }
): CheckResult[] {
  const config: MutableCheck = newCheck(
    'i18n:locales',
    2,
    `locales in ${I18N_CONFIG_FILE}`
  );
  assertPaths(config, root, [I18N_CONFIG_FILE, LOCALES_DIR, EMAIL_LOCALES_DIR]);
  const locales = config.errors.length > 0 ? [] : readLocales(root, config);
  config.sites = locales.length;
  checkLocaleDirs(root, locales, config);
  let parser: IcuParser | undefined;
  const ctx: Ctx = {
    root,
    locales,
    cache: new Map(),
    parser: () => (parser ??= deps.loadParser(root)),
  };
  return [
    config,
    checkValidationKeys(ctx),
    checkCommonParity(ctx),
    checkCommonEmpty(ctx),
    ...GROUPS.map(group => checkInterpolation(ctx, group)),
    checkEventsParity(ctx),
    checkEventsCoverage(ctx),
    checkEmailParity(ctx),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('i18n', run(projectRoot())));
}
