/**
 * Query-string fields of a GET contract: one declaration gives the client its input type and the
 * server its decoder, so a filter can no longer exist on one side only.
 *
 * DECISION: a field is a small codec, not a zod schema. The client sends typed values that
 * `buildQueryString` serialises; the server receives strings (or string arrays) from Next and must
 * reproduce the lenient behaviour the hand-written `qStr` / `qInt` parsers had (an unreadable value
 * falls back, it never turns a list into a 400). With zod the client-side input of a coercing schema
 * is `unknown`, which would lose the client type. A field that should REJECT a bad value is a
 * separate, explicit decision per endpoint (query validators).
 */

/** Raw value of one query key as Next delivers it. */
export type RawQueryValue = string | string[] | undefined;

export type QueryField<TClient, TServer> = {
  /** Turns the raw query value into what the handler receives. Never throws. */
  readonly decode: (raw: RawQueryValue) => TServer;
  /**
   * The client must send this key. The server decode stays lenient: a missing value is
   * `undefined` and the handler decides (a list filter falls back; a required id answers 400).
   */
  readonly required?: boolean;
  /** Phantom: the value type the client may send. Never set at runtime. */
  readonly __client?: (value: TClient) => void;
};

/** Constraint for a field map (contravariant client slot, covariant server slot). */
export type QueryFieldMap = Record<string, QueryField<never, unknown>>;

type ClientOf<F> = F extends QueryField<infer C, unknown> ? C : never;
type ServerOf<F> = F extends QueryField<never, infer S> ? S : never;
type IsRequired<F> = F extends { readonly required: true } ? true : false;

/**
 * What the client may send. A field marked `required` is a mandatory key. The object itself is
 * mutable: screens build it field by field. `-readonly` drops the modifier the const contract
 * object would otherwise copy onto every key.
 */
export type QueryClientInput<F extends QueryFieldMap> = {
  -readonly [
    K in keyof F as IsRequired<F[K]> extends true ? K : never
  ]: ClientOf<F[K]>;
} & {
  -readonly [
    K in keyof F as IsRequired<F[K]> extends true ? never : K
  ]?: ClientOf<F[K]>;
};

/** True when at least one field is `required`. An empty map is false. */
export type QueryHasRequiredField<Q extends QueryFieldMap> = true extends {
  [K in keyof Q]-?: Q[K] extends { readonly required: true } ? true : false;
}[keyof Q]
  ? true
  : false;

/** What the handler receives: a field decoding to `undefined` is an optional key. */
export type QueryServerOutput<F extends QueryFieldMap> = {
  -readonly [
    K in keyof F as undefined extends ServerOf<F[K]> ? never : K
  ]: ServerOf<F[K]>;
} & {
  -readonly [
    K in keyof F as undefined extends ServerOf<F[K]> ? K : never
  ]?: Exclude<ServerOf<F[K]>, undefined>;
};

/** A single non-empty string (Next gives an array for a repeated key: ignored, like `qStr`). */
const firstString = (raw: RawQueryValue): string | undefined =>
  typeof raw === 'string' && raw.length > 0 ? raw : undefined;

export const QUERY_FIELD = {
  /** Optional string; empty or repeated keys read as absent (parity with `qStr`). */
  string: (): QueryField<string, string | undefined> => ({
    decode: firstString,
  }),
  /**
   * Integer with a fallback; a non-numeric value falls back, a fractional one is floored (parity
   * with `qInt(...) ?? fallback`). Range clamping stays with the operation that owns the limit.
   */
  int: (fallback: number): QueryField<number, number> => ({
    decode: raw => {
      const value = firstString(raw);
      if (value === undefined) {
        return fallback;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
    },
  }),
  /**
   * A string the client must send. Missing, empty or repeated keys decode as `undefined`
   * (same as `string`); they do not become a middleware 400.
   */
  requiredString: (): QueryField<string, string | undefined> & {
    readonly required: true;
  } => ({
    required: true,
    decode: firstString,
  }),
  /**
   * One of `values`. Anything else, including a missing key, decodes as `undefined` (dropped
   * filter), never a 400. Parity with the admin-list narrowers.
   */
  oneOf: <T extends string>(
    values: readonly T[]
  ): QueryField<T, T | undefined> => ({
    decode: raw => {
      const value = firstString(raw);
      if (value !== undefined && values.includes(value as T)) {
        return value as T;
      }
      return undefined;
    },
  }),
  /**
   * `true` / `false` only. Anything else decodes as `undefined` (parity with `qBool`, which
   * returns null). Collapsing "absent" to false stays with the handler.
   */
  bool: (): QueryField<boolean, boolean | undefined> => ({
    decode: raw => {
      const value = firstString(raw);
      if (value === 'true') {
        return true;
      }
      if (value === 'false') {
        return false;
      }
      return undefined;
    },
  }),
} as const;

/** Decodes every declared field from a Next query object; undeclared keys are dropped. */
export const decodeQueryFields = <F extends QueryFieldMap>(
  fields: F,
  query: Partial<Record<string, RawQueryValue>>
): QueryServerOutput<F> => {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    const value = field.decode(query[key]);
    if (value !== undefined) {
      out[key] = value;
    }
  }
  // The loop builds exactly the mapped shape: one decoded value per declared key, absent when the
  // decoder yields undefined (the optional half of QueryServerOutput).
  return out as QueryServerOutput<F>;
};
