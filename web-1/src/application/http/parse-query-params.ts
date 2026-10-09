import { qStr } from '@app/http/query-params.utils';

/**
 * Declarative query-string parsing for API route handlers.
 *
 * INTENT:
 *   The admin query handlers (users, reports, user-timeline, audit-trail) each
 *   duplicated a local `parseQueryParams` that string→number/bool/enum-narrowed
 *   every param with the same `qStr(...)`+`if (x !== null)` boilerplate. This
 *   module centralises that into one generic `parseQueryParams(query, schema)`
 *   driven by a declarative `{ key: parser }` map plus per-parser combinators.
 *
 * SEMANTICS (`exactOptionalPropertyTypes: true` aware):
 *   A parser returns the narrowed value, or `undefined` to mean "do NOT set this
 *   key". Keys whose parser yields `undefined` are NEVER assigned (not even as
 *   `undefined`) — this preserves exact-optional property contracts: an absent
 *   `?: T` stays absent, never becomes `{ key: undefined }`.
 *
 *   Required keys with a baseline value use `base` (e.g. `user_id: ''`); a
 *   parser may then override the baseline when the param is present.
 *
 * Each combinator receives the raw `string | null` (already collapsed from
 * Next.js `string | string[] | undefined` by `qStr`) and returns `T | undefined`.
 */

/** A parser maps the raw query value to a typed value, or `undefined` to skip the key. */
export type QueryParamParser<T> = (raw: string | null) => T | undefined;

/**
 * A schema maps each output key to a parser producing that key's value type.
 * `Partial<P>` is used so optional output properties stay optional.
 */
export type QueryParamSchema<P> = {
  [K in keyof P]-?: QueryParamParser<NonNullable<P[K]>>;
};

interface ParseQueryParamsOptions<P> {
  /** Baseline values for required keys (parsers may override when present). */
  base?: P;
}

/**
 * Parse a Next.js query object into a typed params object using a declarative
 * schema. Keys whose parser returns `undefined` are omitted from the result.
 */
export const parseQueryParams = <P extends object>(
  query: Record<string, string | string[] | undefined>,
  schema: QueryParamSchema<P>,
  options: ParseQueryParamsOptions<P> = {}
): P => {
  const result: P = { ...(options.base ?? ({} as P)) };

  for (const key of Object.keys(schema) as (keyof P)[]) {
    const parser = schema[key];
    const raw = qStr(query, key as string);
    const value = parser(raw);
    if (value !== undefined) {
      result[key] = value as P[typeof key];
    }
  }

  return result;
};

// ─── Combinators ─────────────────────────────────────────────────────────────

/** Pass-through string (skips when absent/empty). */
export const pStr: QueryParamParser<string> = raw =>
  raw !== null ? raw : undefined;

/** Number via `Number(raw)` (matches legacy behaviour — NaN is preserved, not skipped). */
export const pNum: QueryParamParser<number> = raw =>
  raw !== null ? Number(raw) : undefined;

/** Boolean from the literal string `'true'` (any other present value ⇒ false; absent ⇒ skip). */
export const pBool: QueryParamParser<boolean> = raw =>
  raw !== null ? raw === 'true' : undefined;

/**
 * Narrowed value: keeps the raw string only when the type-guard accepts it.
 * Skips the key when absent OR when the guard rejects (invalid values dropped).
 */
export const pNarrowed =
  <T extends string>(narrower: (v: unknown) => v is T): QueryParamParser<T> =>
  raw =>
    raw !== null && narrower(raw) ? raw : undefined;

/**
 * Member-of-set value with a fallback default. Always sets the key:
 * returns the raw value when it is a member of `allowed`, otherwise `fallback`.
 */
export const pOneOf =
  <T extends string>(allowed: readonly T[], fallback: T): QueryParamParser<T> =>
  raw =>
    raw !== null && (allowed as readonly string[]).includes(raw)
      ? (raw as T)
      : fallback;
