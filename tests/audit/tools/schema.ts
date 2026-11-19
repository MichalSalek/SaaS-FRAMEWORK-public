// schema — guards of the Prisma schema and of the kernel and backend code that restates it.
// Successor of tests/audit/prisma-fk-index.sh, prisma-redundant-index.sh, enum-parity.sh,
// pricing-parity.sh and archive-cascade-completeness.sh. AST-based: comments trip nothing.
//  1. fk-index: every `@relation(fields: [...])` column leads an index of its model (main schema
//     only), else seq-scans on every CASCADE / SET NULL and join.
//  2. redundant-index: no btree `@@index` that is a left prefix of, or equal to, another index,
//     unique or id. Escape: `redundant-index-allow: <reason>` on or right above the `@@index`.
//  3. enum-generated: schema enums equal their generated `<Enum>Value` in
//     .shared-kernel/models/db_models.generated.dto.ts; a generated value with no enum is stale.
//  4. enum-mirrors: hand-written enum mirrors in .shared-kernel are DISCOVERED (>= 2 'UPPER_CASE'
//     strings covering >= 50% of an enum, not derived from `<Enum>Value`) and must equal it.
//  5. pricing-parity: schema PricingPlan equals kernel `PricingPlanValue`; `SKIP_ENUMS` names it.
//  6. archive-cascade: every `onDelete: Cascade` child of User / StylistAccount / ClientAccount is
//     in `userRelationsArchiveEnabler` (web-1/src/domain/user/user.config.ts) or ARCHIVE_ALLOWLIST,
//     else terminal delete leaves no archive copy of it.
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { Field, Model } from '@mrleebo/prisma-ast';
import {
  assertPaths,
  newCheck,
  projectRoot,
  readText,
  report,
  walk,
  type CheckResult,
  type MutableCheck,
} from './_lib';
import {
  blockAttrsOf,
  columnList,
  enumValues,
  fieldAttr,
  fieldsOf,
  lineOf,
  namedArg,
  parsePrisma,
  prismaComments,
  relatedModel,
  relationFields,
  relationName,
  type IndexColumn,
  type PrismaDoc,
} from './_prisma';
import { nodeLine, propName, unwrapExpr } from './_ts';

export const MAIN_SCHEMA = 'web-1/src/prisma/schema.prisma';
export const LOGS_SCHEMA = 'web-1/src/prisma-app-logs/schema.prisma';
export const KERNEL = '.shared-kernel';
export const GENERATED_DTO = '.shared-kernel/models/db_models.generated.dto.ts';
export const PRICING_CONFIG = '.shared-kernel/domain/pricing/pricing.config.ts';
export const GENERATOR_CONFIG = 'scripts/generate-dto/config.ts';
export const ARCHIVE_CONFIG = 'web-1/src/domain/user/user.config.ts';
export const ARCHIVE_CONST = 'userRelationsArchiveEnabler';

/** Enums whose parity check 5 owns (the generator skips them, so check 3 does not apply). */
export const OWNED_ENUMS = ['PricingPlan'] as const;

/**
 * Existence anchors of check 4 (CONST|Enum): not a scope list, discovery finds mirrors itself;
 * a mirror listed here that discovery stops seeing (moved, renamed, reshaped) fails the check.
 */
export const MUST_DISCOVER = [
  'NAIL_LENGTHS|NailLength',
  'STAFF_ROLES|StaffRole',
  'TIMELINE_EVENT_TYPES|EventLogType',
] as const;

/** Account roots whose cascade children must be archived before the hard delete. */
export const ACCOUNT_ROOTS = [
  'User',
  'StylistAccount',
  'ClientAccount',
] as const;

/**
 * Cascade children deliberately NOT archived (Model.field → reason). An entry that names no
 * cascade child of a root is an error: a dead exemption exempts nothing and invites growth.
 */
export const ARCHIVE_ALLOWLIST: Readonly<Record<string, string>> = {
  'StylistAccount.checkout_attempt':
    'ephemeral fenced purchase coordination is not financial history; account restoration must not revive a provider session or lease (SCHEMA_DECISIONS.md#checkout-attempt)',
  'StylistAccount.salon_invitations':
    'transient invitation consent tokens and invited third-party addresses must not be retained or revived by account restoration',
  'StylistAccount.favorited_by':
    "other users' bookmarks OF this stylist: their data, not the deleted user's",
  'User.notifications':
    'notification-centre rows: 90-day ephemeral signals, nothing to restore (notifications v2)',
  'User.push_subscriptions':
    'device push capabilities (endpoints + keys): a restored account re-registers its devices; retaining capability URLs would be a liability',
  'StylistAccount.profile_link_aliases':
    'retired profile links follow the live link: the archive move releases the live vanity and salon slug, so their old links go with them (SCHEMA_DECISIONS.md#profile-link-alias)',
};

/** Floors, measured 2026-10-23 on the real tree (measured value in each comment). */
export const FLOORS = {
  /** FK columns of `@relation(fields:)` in the main schema (measured 49). */
  fkIndex: 35,
  /** plain btree `@@index` entries, both schemas (measured 128). */
  redundantIndex: 90,
  /** schema enums compared with the generated mirror (measured 19). */
  enumGenerated: 14,
  /** hand-written mirrors discovered in the kernel (measured 3). */
  enumMirrors: 3,
  /** PricingPlan values compared (measured 5). */
  pricing: 3,
  /** cascade children of the account roots (measured 26). */
  archive: 18,
} as const;

function schemaDoc(
  check: MutableCheck,
  root: string,
  rel: string
): { doc: PrismaDoc; text: string } | undefined {
  const text = readText(root, rel);
  try {
    return { doc: parsePrisma(text), text };
  } catch (error) {
    check.errors.push(
      `${rel} does not parse: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`
    );
    return undefined;
  }
}

function parseKernelFile(root: string, rel: string): ts.SourceFile {
  return ts.createSourceFile(
    rel,
    readText(root, rel),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

// ── 1. fk-index ─────────────────────────────────────────────────────────────────────────────

/** Columns that lead some index of the model (first column of a block index, field @id/@unique). */
function leadingColumns(model: Model): Set<string> {
  const out = new Set<string>();
  for (const attr of blockAttrsOf(model)) {
    if (attr.name === 'index' || attr.name === 'unique' || attr.name === 'id') {
      const first = columnList(attr.args?.[0]?.value as never)?.[0];
      if (first !== undefined) {
        out.add(first.name);
      }
    }
  }
  for (const field of fieldsOf(model)) {
    if (
      fieldAttr(field, 'id') !== undefined ||
      fieldAttr(field, 'unique') !== undefined
    ) {
      out.add(field.name);
    }
  }
  return out;
}

export function checkFkIndex(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'schema:fk-index',
    FLOORS.fkIndex,
    'FK columns'
  );
  assertPaths(check, root, [MAIN_SCHEMA]);
  const parsed =
    check.errors.length > 0 ? undefined : schemaDoc(check, root, MAIN_SCHEMA);
  if (parsed === undefined) {
    return check;
  }
  for (const model of parsed.doc.models) {
    const leading = leadingColumns(model);
    for (const field of fieldsOf(model)) {
      for (const fk of relationFields(field) ?? []) {
        check.sites++;
        if (!leading.has(fk)) {
          check.findings.push({
            file: MAIN_SCHEMA,
            line: lineOf(field),
            message: `MISSING FK INDEX ${model.name}.${fk}: add @@index([${fk}]) (or @@unique / @unique); without it every CASCADE / SET NULL and join on it seq-scans`,
          });
        }
      }
    }
  }
  return check;
}

// ── 2. redundant-index ──────────────────────────────────────────────────────────────────────

interface IndexEntry {
  readonly cols: readonly IndexColumn[];
  readonly kind: 'index' | 'unique' | 'id';
  readonly btree: boolean;
  readonly line: number;
}

function modelIndexes(model: Model): IndexEntry[] {
  const out: IndexEntry[] = [];
  for (const attr of blockAttrsOf(model)) {
    if (attr.name !== 'index' && attr.name !== 'unique' && attr.name !== 'id') {
      continue;
    }
    const cols = columnList(attr.args?.[0]?.value as never);
    if (cols === undefined || cols.length === 0) {
      continue;
    }
    const type = namedArg(attr, 'type');
    const btree =
      (type === undefined || type === 'BTree') &&
      !cols.some(c => c.ops !== undefined && /gin_trgm_ops/.test(c.ops));
    out.push({ cols, kind: attr.name, btree, line: lineOf(attr) });
  }
  for (const field of fieldsOf(model)) {
    for (const kind of ['id', 'unique'] as const) {
      if (fieldAttr(field, kind) !== undefined) {
        out.push({
          cols: [{ name: field.name, sort: 'Asc', ops: undefined }],
          kind,
          btree: true,
          line: lineOf(field),
        });
      }
    }
  }
  return out;
}

function isPrefix(
  a: readonly IndexColumn[],
  b: readonly IndexColumn[]
): boolean {
  return (
    a.length <= b.length &&
    a.every((col, i) => col.name === b[i]?.name && col.sort === b[i]?.sort)
  );
}

function colsText(cols: readonly IndexColumn[]): string {
  return cols
    .map(c => (c.sort === 'Desc' ? `${c.name}(sort: Desc)` : c.name))
    .join(', ');
}

function escapeState(
  comments: Map<number, string>,
  lines: readonly string[],
  line: number
): 'reason' | 'bare' | 'none' {
  const candidates = [comments.get(line)];
  if (/^\s*\/\//.test(lines[line - 2] ?? '')) {
    candidates.push(comments.get(line - 1));
  }
  let state: 'reason' | 'bare' | 'none' = 'none';
  for (const text of candidates) {
    const at = text?.indexOf('redundant-index-allow:') ?? -1;
    if (text === undefined || at === -1) {
      continue;
    }
    if (text.slice(at + 'redundant-index-allow:'.length).trim() !== '') {
      return 'reason';
    }
    state = 'bare';
  }
  return state;
}

export function checkRedundantIndex(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'schema:redundant-index',
    FLOORS.redundantIndex,
    'plain btree @@index entries'
  );
  assertPaths(check, root, [MAIN_SCHEMA, LOGS_SCHEMA]);
  if (check.errors.length > 0) {
    return check;
  }
  for (const rel of [MAIN_SCHEMA, LOGS_SCHEMA]) {
    const parsed = schemaDoc(check, root, rel);
    if (parsed === undefined) {
      continue;
    }
    const comments = prismaComments(parsed.text);
    const lines = parsed.text.split('\n');
    for (const model of parsed.doc.models) {
      const indexes = modelIndexes(model);
      indexes.forEach((a, ai) => {
        if (a.kind !== 'index' || !a.btree) {
          return;
        }
        check.sites++;
        const cover = indexes.find(
          (b, bi) =>
            b !== a &&
            b.btree &&
            isPrefix(a.cols, b.cols) &&
            (a.cols.length < b.cols.length || b.kind !== 'index' || bi < ai)
        );
        if (cover === undefined) {
          return;
        }
        const escape = escapeState(comments, lines, a.line);
        if (escape === 'reason') {
          return;
        }
        check.findings.push({
          file: rel,
          line: a.line,
          message:
            escape === 'bare'
              ? 'redundant-index-allow without a reason'
              : `REDUNDANT INDEX ${model.name} @@index([${colsText(a.cols)}]) is covered by ${cover.kind} [${colsText(cover.cols)}] (line ${cover.line}); drop it or add // redundant-index-allow: <reason>`,
        });
      });
    }
  }
  return check;
}

// ── kernel value lists ──────────────────────────────────────────────────────────────────────

const UPPER = /^[A-Z][A-Z0-9_]*$/;

/** Initializer behind `Object.freeze(...)`, `as const`, `satisfies` and parentheses. */
function listInitializer(init: ts.Expression): ts.Expression {
  let expr = unwrapExpr(init);
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    ts.isIdentifier(expr.expression.expression) &&
    expr.expression.expression.text === 'Object' &&
    expr.expression.name.text === 'freeze' &&
    expr.arguments[0] !== undefined
  ) {
    expr = unwrapExpr(expr.arguments[0]);
  }
  return expr;
}

/** 'UPPER_CASE' string values of an array literal's elements or an object literal's properties. */
function upperValues(expr: ts.Expression): string[] | undefined {
  const items: ts.Expression[] = [];
  if (ts.isArrayLiteralExpression(expr)) {
    items.push(...expr.elements);
  } else if (ts.isObjectLiteralExpression(expr)) {
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        items.push(prop.initializer);
      }
    }
  } else {
    return undefined;
  }
  const out: string[] = [];
  for (const item of items) {
    const value = unwrapExpr(item);
    if (
      (ts.isStringLiteral(value) ||
        ts.isNoSubstitutionTemplateLiteral(value)) &&
      UPPER.test(value.text)
    ) {
      out.push(value.text);
    }
  }
  return out;
}

interface ConstList {
  readonly name: string;
  readonly line: number;
  readonly values: readonly string[];
  readonly init: ts.Expression;
}

function constLists(sf: ts.SourceFile): ConstList[] {
  const out: ConstList[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const init = listInitializer(node.initializer);
      const values = upperValues(init);
      if (values !== undefined) {
        out.push({
          name: node.name.text,
          line: nodeLine(sf, node),
          values,
          init,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function references(node: ts.Node, identifier: string): boolean {
  if (ts.isIdentifier(node) && node.text === identifier) {
    return true;
  }
  return (
    ts.forEachChild(node, child =>
      references(child, identifier) ? true : undefined
    ) === true
  );
}

function setDiff(
  expected: readonly string[],
  actual: readonly string[]
): string | undefined {
  const want = new Set(expected);
  const have = new Set(actual);
  const missing = [...want].filter(v => !have.has(v)).sort();
  const extra = [...have].filter(v => !want.has(v)).sort();
  const dupes = actual.filter((v, i) => actual.indexOf(v) !== i);
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing ${missing.join(' ')}`);
  }
  if (extra.length > 0) {
    parts.push(`extra ${extra.join(' ')}`);
  }
  if (dupes.length > 0) {
    parts.push(`duplicated ${[...new Set(dupes)].join(' ')}`);
  }
  return parts.length > 0 ? parts.join('; ') : undefined;
}

function schemaEnums(
  check: MutableCheck,
  root: string
): Map<string, string[]> | undefined {
  const parsed = schemaDoc(check, root, MAIN_SCHEMA);
  if (parsed === undefined) {
    return undefined;
  }
  return new Map(parsed.doc.enums.map(en => [en.name, enumValues(en)]));
}

// ── 3. enum-generated ───────────────────────────────────────────────────────────────────────

export function checkEnumGenerated(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'schema:enum-generated',
    FLOORS.enumGenerated,
    'schema enums'
  );
  assertPaths(check, root, [MAIN_SCHEMA, GENERATED_DTO]);
  const enums = check.errors.length > 0 ? undefined : schemaEnums(check, root);
  if (enums === undefined) {
    return check;
  }
  const generated = new Map(
    constLists(parseKernelFile(root, GENERATED_DTO))
      .filter(c => c.name.endsWith('Value'))
      .map(c => [c.name, c] as const)
  );
  for (const [name, values] of enums) {
    if ((OWNED_ENUMS as readonly string[]).includes(name)) {
      continue;
    }
    check.sites++;
    const mirror = generated.get(`${name}Value`);
    if (mirror === undefined) {
      check.findings.push({
        file: GENERATED_DTO,
        line: 1,
        message: `${name}: no ${name}Value in the generated DTO (new enum not wired or stale file: npm run system:generate-dto)`,
      });
      continue;
    }
    const diff = setDiff(values, mirror.values);
    if (diff !== undefined) {
      check.findings.push({
        file: GENERATED_DTO,
        line: mirror.line,
        message: `${name} DRIFT schema enum vs ${name}Value: ${diff} (re-run npm run system:generate-dto)`,
      });
    }
  }
  for (const [constName, mirror] of generated) {
    const enumName = constName.slice(0, -'Value'.length);
    if (!enums.has(enumName)) {
      check.findings.push({
        file: GENERATED_DTO,
        line: mirror.line,
        message: `${constName} has no enum ${enumName} in the schema (stale generated file: npm run system:generate-dto)`,
      });
    }
  }
  return check;
}

// ── 4. enum-mirrors ─────────────────────────────────────────────────────────────────────────

export interface DiscoveredMirror {
  readonly enumName: string;
  readonly file: string;
  readonly constName: string;
  readonly line: number;
  readonly values: readonly string[];
}

/** Hand-written enum mirrors in the kernel (see header, check 4). */
export function discoverMirrors(
  root: string,
  enums: ReadonlyMap<string, readonly string[]>
): DiscoveredMirror[] {
  const out: DiscoveredMirror[] = [];
  const files = walk(
    root,
    KERNEL,
    rel => rel.endsWith('.ts') && rel !== GENERATED_DTO
  );
  for (const rel of files) {
    const text = readText(root, rel);
    if (!/['"`][A-Z]/.test(text)) {
      continue;
    }
    for (const list of constLists(
      ts.createSourceFile(
        rel,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      )
    )) {
      if (list.values.length < 2) {
        continue;
      }
      const set = new Set(list.values);
      for (const [enumName, enumVals] of enums) {
        if (references(list.init, `${enumName}Value`)) {
          continue; // derived from the kernel const: tsc already relates it
        }
        const inter = enumVals.filter(v => set.has(v));
        if (inter.length < 2 || inter.length / enumVals.length < 0.5) {
          continue;
        }
        out.push({
          enumName,
          file: rel,
          constName: list.name,
          line: list.line,
          values: list.values,
        });
      }
    }
  }
  return out;
}

export function checkEnumMirrors(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'schema:enum-mirrors',
    FLOORS.enumMirrors,
    'hand-written enum mirrors'
  );
  assertPaths(check, root, [MAIN_SCHEMA, KERNEL]);
  const enums = check.errors.length > 0 ? undefined : schemaEnums(check, root);
  if (enums === undefined) {
    return check;
  }
  const found = discoverMirrors(root, enums);
  for (const mirror of found) {
    if ((OWNED_ENUMS as readonly string[]).includes(mirror.enumName)) {
      continue; // owned by check 5
    }
    check.sites++;
    const diff = setDiff(enums.get(mirror.enumName) ?? [], mirror.values);
    if (diff !== undefined) {
      check.findings.push({
        file: mirror.file,
        line: mirror.line,
        message: `${mirror.enumName} DRIFT schema enum vs hand-written ${mirror.constName}: ${diff} (tsc does NOT catch this)`,
      });
    }
  }
  for (const anchor of MUST_DISCOVER) {
    const [constName, enumName] = anchor.split('|');
    if (
      !found.some(m => m.constName === constName && m.enumName === enumName)
    ) {
      check.errors.push(
        `ANCHOR LOST: ${constName} (~ enum ${enumName}) is no longer discovered: renamed, moved or reshaped (fix discovery or drop the anchor deliberately)`
      );
    }
  }
  return check;
}

// ── 5. pricing-parity ───────────────────────────────────────────────────────────────────────

export function checkPricingParity(root: string): CheckResult {
  const check: MutableCheck = newCheck(
    'schema:pricing-parity',
    FLOORS.pricing,
    'PricingPlan values'
  );
  assertPaths(check, root, [MAIN_SCHEMA, PRICING_CONFIG, GENERATOR_CONFIG]);
  const enums = check.errors.length > 0 ? undefined : schemaEnums(check, root);
  if (enums === undefined) {
    return check;
  }
  const schemaVals = enums.get('PricingPlan');
  const kernel = constLists(parseKernelFile(root, PRICING_CONFIG)).find(
    c => c.name === 'PricingPlanValue'
  );
  if (schemaVals === undefined) {
    check.errors.push(`${MAIN_SCHEMA} has no enum PricingPlan`);
  } else if (kernel === undefined) {
    check.errors.push(`${PRICING_CONFIG} has no PricingPlanValue list`);
  } else {
    check.sites = schemaVals.length;
    const diff = setDiff(kernel.values, schemaVals);
    if (diff !== undefined) {
      check.findings.push({
        file: MAIN_SCHEMA,
        line: 1,
        message: `PricingPlan DRIFT schema enum vs kernel PricingPlanValue (the SSOT): ${diff}; align both, then db push`,
      });
    }
  }
  const skip = skipEnums(root);
  if (skip === undefined) {
    check.errors.push(`${GENERATOR_CONFIG} declares no SKIP_ENUMS`);
  } else if (!skip.includes('PricingPlan')) {
    check.findings.push({
      file: GENERATOR_CONFIG,
      line: 1,
      message:
        "SKIP_ENUMS no longer lists 'PricingPlan': a generated duplicate would shadow the kernel type",
    });
  }
  return check;
}

/** String literals in the initializer of `SKIP_ENUMS` (any shape: Set, array), code only. */
function skipEnums(root: string): string[] | undefined {
  const sf = parseKernelFile(root, GENERATOR_CONFIG);
  let out: string[] | undefined;
  const collect = (node: ts.Node, into: string[]): void => {
    if (ts.isStringLiteral(node)) {
      into.push(node.text);
    }
    ts.forEachChild(node, child => collect(child, into));
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'SKIP_ENUMS'
    ) {
      out = [];
      if (node.initializer !== undefined) {
        collect(node.initializer, out);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ── 6. archive-cascade ──────────────────────────────────────────────────────────────────────

/** Truthy enabler entry (`true` or an object); its nested include/select object, if any. */
interface EnablerEntry {
  readonly enabled: boolean;
  readonly nested: ts.ObjectLiteralExpression | undefined;
}

function enablerEntries(
  obj: ts.ObjectLiteralExpression
): Map<string, EnablerEntry> {
  const out = new Map<string, EnablerEntry>();
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const key = propName(prop.name);
    if (key === undefined) {
      continue;
    }
    const value = unwrapExpr(prop.initializer);
    if (value.kind === ts.SyntaxKind.TrueKeyword) {
      out.set(key, { enabled: true, nested: undefined });
    } else if (ts.isObjectLiteralExpression(value)) {
      let nested: ts.ObjectLiteralExpression | undefined;
      for (const inner of value.properties) {
        const innerKey = ts.isPropertyAssignment(inner)
          ? propName(inner.name)
          : undefined;
        if (
          ts.isPropertyAssignment(inner) &&
          (innerKey === 'include' || innerKey === 'select')
        ) {
          const innerValue = unwrapExpr(inner.initializer);
          if (ts.isObjectLiteralExpression(innerValue)) {
            nested = innerValue;
          }
        }
      }
      out.set(key, { enabled: true, nested });
    } else {
      out.set(key, { enabled: false, nested: undefined });
    }
  }
  return out;
}

function findEnabler(
  sf: ts.SourceFile
): ts.ObjectLiteralExpression | undefined {
  let out: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === ARCHIVE_CONST &&
      node.initializer !== undefined
    ) {
      const init = unwrapExpr(node.initializer);
      if (ts.isObjectLiteralExpression(init)) {
        out = init;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The FK-owning side of a back-relation field of `root` in its child model. */
function owningSide(
  doc: PrismaDoc,
  root: string,
  field: Field,
  modelNames: ReadonlySet<string>
): Field | undefined {
  const childName = relatedModel(field, modelNames);
  const child = doc.models.find(m => m.name === childName);
  if (child === undefined) {
    return undefined;
  }
  const name = relationName(field);
  const candidates = fieldsOf(child).filter(
    f =>
      f.fieldType === root &&
      relationFields(f) !== undefined &&
      relationName(f) === name
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function checkArchiveCascade(
  root: string,
  allowlist: Readonly<Record<string, string>> = ARCHIVE_ALLOWLIST
): CheckResult {
  const check: MutableCheck = newCheck(
    'schema:archive-cascade',
    FLOORS.archive,
    'account-root cascade children'
  );
  assertPaths(check, root, [MAIN_SCHEMA, ARCHIVE_CONFIG]);
  const parsed =
    check.errors.length > 0 ? undefined : schemaDoc(check, root, MAIN_SCHEMA);
  if (parsed === undefined) {
    return check;
  }
  const doc = parsed.doc;
  const modelNames = new Set(doc.models.map(m => m.name));
  const config = parseKernelFile(root, ARCHIVE_CONFIG);
  const enabler = findEnabler(config);
  if (enabler === undefined) {
    check.errors.push(
      `${ARCHIVE_CONFIG} has no object literal ${ARCHIVE_CONST}`
    );
    return check;
  }
  const top = enablerEntries(enabler);
  const user = doc.models.find(m => m.name === 'User');
  const candidates = new Set<string>();
  for (const rootName of ACCOUNT_ROOTS) {
    const model = doc.models.find(m => m.name === rootName);
    if (model === undefined || user === undefined) {
      check.errors.push(`${MAIN_SCHEMA} has no model ${rootName}`);
      continue;
    }
    // Where this root's children sit in the enabler: User = top level; other roots = inside the
    // include of the User relation field that leads to them.
    let place: Map<string, EnablerEntry> | undefined;
    let placeName = ARCHIVE_CONST;
    if (rootName === 'User') {
      place = top;
    } else {
      const via = fieldsOf(user).find(
        f => f.fieldType === rootName && relationFields(f) === undefined
      );
      if (via === undefined) {
        check.errors.push(
          `model User has no back-relation field to ${rootName}`
        );
        continue;
      }
      placeName = `${ARCHIVE_CONST}.${via.name}.include`;
      const entry = top.get(via.name);
      place =
        entry?.nested === undefined ? new Map() : enablerEntries(entry.nested);
    }
    for (const field of fieldsOf(model)) {
      if (
        relatedModel(field, modelNames) === undefined ||
        relationFields(field) !== undefined
      ) {
        continue; // scalar, or the FK side (a parent, not a child)
      }
      const owner = owningSide(doc, rootName, field, modelNames);
      if (owner === undefined) {
        check.errors.push(
          `${rootName}.${field.name}: cannot find the FK side of the relation in ${String(field.fieldType)}`
        );
        continue;
      }
      const onDelete = namedArg(
        fieldAttr(owner, 'relation') ?? {
          type: 'attribute',
          kind: 'field',
          name: 'relation',
        },
        'onDelete'
      );
      if (onDelete !== 'Cascade') {
        continue; // SetNull / Restrict: the row survives the delete, nothing vanishes
      }
      const key = `${rootName}.${field.name}`;
      candidates.add(key);
      check.sites++;
      if (place.get(field.name)?.enabled === true) {
        continue;
      }
      if (allowlist[key] !== undefined) {
        continue;
      }
      check.findings.push({
        file: MAIN_SCHEMA,
        line: lineOf(field),
        message: `${key}: cascade child NOT archived at ${placeName} and not in ARCHIVE_ALLOWLIST; its rows vanish with no copy on terminal delete`,
      });
    }
  }
  for (const key of Object.keys(allowlist)) {
    if (!candidates.has(key)) {
      check.errors.push(
        `ARCHIVE_ALLOWLIST entry ${key} names no cascade child of an account root (dead exemption)`
      );
    }
  }
  return check;
}

export function run(root: string): CheckResult[] {
  return [
    checkFkIndex(root),
    checkRedundantIndex(root),
    checkEnumGenerated(root),
    checkEnumMirrors(root),
    checkPricingParity(root),
    checkArchiveCascade(root),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(report('schema', run(projectRoot())));
}
