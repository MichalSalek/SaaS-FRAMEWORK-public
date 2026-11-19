// JSON helpers for the TypeScript audit tools: strict parsing plus line numbers for findings.
//
// DECISION: the data comes from JSON.parse, never from a lenient parser. The repo has had
// i18n files broken by typographic quotes used as JSON delimiters; a file that does not parse
// must fail the check with its name, never be read as "no keys" (that is a green gate over a
// file the app cannot load). The TypeScript JSON parser is used ONLY to map a key path to its
// line, so a finding points at the place to edit.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface JsonDoc {
  readonly rel: string;
  readonly data: JsonValue;
  /** 1-based line of the property at the given key path (segments), or 1 when unknown. */
  lineOf(segments: readonly string[]): number;
}

export type JsonLoad =
  | { readonly ok: true; readonly doc: JsonDoc }
  | { readonly ok: false; readonly error: string };

const SEP = '\u0000';

function lineIndex(rel: string, text: string): Map<string, number> {
  const lines = new Map<string, number>();
  const source = ts.parseJsonText(rel, text);
  const visit = (node: ts.Expression, prefix: string[]): void => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) {
          continue;
        }
        const name =
          ts.isStringLiteral(prop.name) ||
          ts.isIdentifier(prop.name) ||
          ts.isNumericLiteral(prop.name)
            ? prop.name.text
            : undefined;
        if (name === undefined) {
          continue;
        }
        const segments = [...prefix, name];
        const { line } = source.getLineAndCharacterOfPosition(
          prop.getStart(source)
        );
        lines.set(segments.join(SEP), line + 1);
        visit(prop.initializer, segments);
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((element, i) => {
        const segments = [...prefix, `[${i}]`];
        const { line } = source.getLineAndCharacterOfPosition(
          element.getStart(source)
        );
        lines.set(segments.join(SEP), line + 1);
        visit(element, segments);
      });
    }
  };
  const first = source.statements[0];
  if (first !== undefined && ts.isExpressionStatement(first)) {
    visit(first.expression, []);
  }
  return lines;
}

/** Reads and parses a JSON file under root; a missing or unparsable file is an error naming it. */
export function loadJson(
  root: string,
  rel: string,
  cache?: Map<string, JsonLoad>
): JsonLoad {
  const cached = cache?.get(rel);
  if (cached !== undefined) {
    return cached;
  }
  const abs = path.join(root, rel);
  let result: JsonLoad;
  if (!existsSync(abs)) {
    result = { ok: false, error: `file does not exist: ${rel}` };
  } else {
    const text = readFileSync(abs, 'utf8');
    try {
      const data = JSON.parse(text) as JsonValue;
      let index: Map<string, number> | undefined;
      result = {
        ok: true,
        doc: {
          rel,
          data,
          lineOf: segments => {
            index ??= lineIndex(rel, text);
            return index.get(segments.join(SEP)) ?? 1;
          },
        },
      };
    } catch (error) {
      result = {
        ok: false,
        error: `${rel} is not valid JSON (${error instanceof Error ? error.message : String(error)}); typographic quotes used as delimiters are the usual cause`,
      };
    }
  }
  cache?.set(rel, result);
  return result;
}

export function isObject(
  value: JsonValue
): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
