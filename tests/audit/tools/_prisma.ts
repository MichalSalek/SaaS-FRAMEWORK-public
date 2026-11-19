// Prisma schema reading for the TypeScript audit tools: the real parser (`@mrleebo/prisma-ast`, the
// one scripts/generate-dto uses), with line numbers, plus the few derived views the checks need.
//
// DECISION: the parser, not a regex. The shell guards split model blocks with `\nmodel\s+` and
// matched attributes per line, so a `@unique` inside a comment counted as an index and a wrapped
// `@relation(...)` could be missed. A schema the parser rejects is an ERROR of the check (loud),
// never an empty model list (a green over nothing).
import {
  getSchema,
  PrismaParser,
  VisitorClassFactory,
  type Attribute,
  type BlockAttribute,
  type Enum,
  type Field,
  type KeyValue,
  type Model,
  type Value,
} from '@mrleebo/prisma-ast';

export interface PrismaDoc {
  readonly models: readonly Model[];
  readonly enums: readonly Enum[];
}

/** Parses a schema with location tracking; throws with the parser's message on invalid input. */
export function parsePrisma(text: string): PrismaDoc {
  const parser = new PrismaParser({ nodeLocationTracking: 'full' });
  const Visitor = VisitorClassFactory(parser);
  const schema = getSchema(text, { parser, visitor: new Visitor(parser) });
  const models: Model[] = [];
  const enums: Enum[] = [];
  for (const block of schema.list) {
    if (block.type === 'model') {
      models.push(block);
    } else if (block.type === 'enum') {
      enums.push(block);
    }
  }
  return { models, enums };
}

export function fieldsOf(model: Model): Field[] {
  return model.properties.filter((p): p is Field => p.type === 'field');
}

export function blockAttrsOf(model: Model): BlockAttribute[] {
  return model.properties.filter(
    (p): p is BlockAttribute => p.type === 'attribute'
  );
}

export function enumValues(en: Enum): string[] {
  const out: string[] = [];
  for (const item of en.enumerators) {
    if (item.type === 'enumerator') {
      out.push(item.name);
    }
  }
  return out;
}

export function lineOf(node: { location?: { startLine?: number } }): number {
  return node.location?.startLine ?? 0;
}

function isKeyValue(value: unknown): value is KeyValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'keyValue'
  );
}

/** Value of a named argument (`fields: [...]`, `type: Gin`) of an attribute. */
export function namedArg(
  attr: Attribute | BlockAttribute,
  key: string
): Value | undefined {
  for (const arg of attr.args ?? []) {
    if (isKeyValue(arg.value) && arg.value.key === key) {
      return arg.value.value;
    }
  }
  return undefined;
}

/** First positional (non key-value) argument of an attribute. */
export function positionalArg(
  attr: Attribute | BlockAttribute
): Value | undefined {
  for (const arg of attr.args ?? []) {
    if (!isKeyValue(arg.value)) {
      return arg.value as Value;
    }
  }
  return undefined;
}

export interface IndexColumn {
  readonly name: string;
  readonly sort: 'Asc' | 'Desc';
  /** `ops:` operator class, raw text (`gin_trgm_ops`), if any. */
  readonly ops: string | undefined;
}

function opsText(value: Value): string | undefined {
  if (typeof value === 'string') {
    return value.replace(/^"|"$/g, '');
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    value.type === 'function'
  ) {
    return (value.params ?? [])
      .map(p => (typeof p === 'string' ? p.replace(/^"|"$/g, '') : ''))
      .join(',');
  }
  return undefined;
}

/** Column list of `[a, b(sort: Desc), c(ops: raw("x"))]`; undefined when the value is not one. */
export function columnList(
  value: Value | undefined
): IndexColumn[] | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    value.type !== 'array'
  ) {
    return undefined;
  }
  const out: IndexColumn[] = [];
  for (const arg of value.args) {
    if (typeof arg === 'string') {
      out.push({ name: arg, sort: 'Asc', ops: undefined });
    } else if (
      typeof arg === 'object' &&
      arg !== null &&
      !Array.isArray(arg) &&
      arg.type === 'function'
    ) {
      let sort: 'Asc' | 'Desc' = 'Asc';
      let ops: string | undefined;
      for (const param of arg.params ?? []) {
        if (
          isKeyValue(param) &&
          param.key === 'sort' &&
          param.value === 'Desc'
        ) {
          sort = 'Desc';
        } else if (isKeyValue(param) && param.key === 'ops') {
          ops = opsText(param.value);
        }
      }
      out.push({ name: arg.name, sort, ops });
    }
  }
  return out;
}

export function fieldAttr(field: Field, name: string): Attribute | undefined {
  return (field.attributes ?? []).find(
    a => a.name === name && a.group === undefined
  );
}

/** Model name of a field's type, when it is a model of the same schema. */
export function relatedModel(
  field: Field,
  modelNames: ReadonlySet<string>
): string | undefined {
  return typeof field.fieldType === 'string' && modelNames.has(field.fieldType)
    ? field.fieldType
    : undefined;
}

/** Relation name (`@relation("Name", ...)` or `name: "Name"`), undefined for an unnamed one. */
export function relationName(field: Field): string | undefined {
  const rel = fieldAttr(field, 'relation');
  if (rel === undefined) {
    return undefined;
  }
  const value = positionalArg(rel) ?? namedArg(rel, 'name');
  return typeof value === 'string' ? value.replace(/^"|"$/g, '') : undefined;
}

/** `fields: [...]` of a field's `@relation`, i.e. the FK columns this side owns. */
export function relationFields(field: Field): string[] | undefined {
  const rel = fieldAttr(field, 'relation');
  return rel === undefined
    ? undefined
    : columnList(namedArg(rel, 'fields'))?.map(c => c.name);
}

/**
 * Comment text per 1-based line of a Prisma schema (`//` and `///`, outside string literals).
 * Escape markers are read from here, so a marker inside a string value never counts.
 */
export function prismaComments(text: string): Map<number, string> {
  const out = new Map<number, string>();
  text.split('\n').forEach((line, i) => {
    let inString = false;
    for (let at = 0; at < line.length; at++) {
      const ch = line[at];
      if (ch === '\\' && inString) {
        at++;
      } else if (ch === '"') {
        inString = !inString;
      } else if (!inString && ch === '/' && line[at + 1] === '/') {
        out.set(i + 1, line.slice(at));
        return;
      }
    }
  });
  return out;
}
