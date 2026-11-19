import type { z } from 'zod';
import type {
  DetailedErrorGeneric,
  DetailedErrorPayload,
} from '../../application/http/http.types';
import type { ValidationOutcome } from './validation.types';

type ZodObjectSchema = z.ZodObject<z.ZodRawShape>;

/**
 * Shared engine: parses `data` with `schema`, returns the verdict with the parsed output on success
 * and the per-slot error strings on failure. `slots` are the error-DTO keys; `routeIssuesToGeneral`
 * sends every issue to `__general` regardless of its path.
 */
const runZodValidation = <S extends ZodObjectSchema, E>(
  schema: S,
  data: unknown,
  slots: readonly string[],
  routeIssuesToGeneral: boolean
): ValidationOutcome<ParsedData<z.output<S>>> & E => {
  const fields: Record<string, string> = { __general: '' };
  for (const key of slots) {
    fields[key] = '';
  }

  const input =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? data
      : {};

  const parsed = schema.safeParse(input);
  // DECISION: the return type is derived from the schema (or the declared slots) so consumers keep
  // the typed error-DTO fields the hand-written validators exposed (the frontend reads
  // `validation.email.trim()`). The runtime record is built from `slots`; the casts bridge it to the
  // per-key error type and `z.output<S>` to its ParsedData view (see the module DECISION).
  const errors = fields as E;
  if (parsed.success) {
    return {
      ...errors,
      __isValid: true as const,
      __data: parsed.data as ParsedData<z.output<S>>,
    };
  }
  for (const issue of parsed.error.issues) {
    const top =
      !routeIssuesToGeneral && issue.path.length > 0
        ? String(issue.path[0])
        : '__general';
    const slot = top in fields ? top : '__general';
    fields[slot] = (fields[slot] ?? '') + issue.message + ' ';
  }
  return { ...errors, __isValid: false as const };
};

/**
 * Runs a zod object schema and projects its issues onto the project's per-field
 * error-DTO shape: `{__isValid, __general, <field>: ''}`. Empty string = valid field,
 * non-empty = accumulated i18n error message(s). On success `__data` holds the parsed output.
 *
 * A non-plain-object input (null/array/primitive) is validated as `{}`, so it yields per-field
 * "missing" issues exactly like the hand-written validators did. Error-slot keys are derived from
 * `schema.shape`, so they stay in lockstep with the schema (and, via the SchemaMatchesDto binding
 * below, with the REQUEST DTO). `routeIssuesToGeneral` keeps the slots but reports every issue in
 * `__general` (validators whose error contract has no per-field messages).
 */
export const zodValidate = <S extends ZodObjectSchema>(
  schema: S,
  data: unknown,
  options: { routeIssuesToGeneral?: boolean } = {}
): ValidationOutcome<ParsedData<z.output<S>>> &
  DetailedErrorPayload<z.output<S>> =>
  runZodValidation<S, DetailedErrorPayload<z.output<S>>>(
    schema,
    data,
    Object.keys(schema.shape),
    options.routeIssuesToGeneral === true
  );

/**
 * Like {@link zodValidate}, but the error-DTO slots are declared explicitly instead of derived from
 * the shape: for a validator whose request keys (`vanity: {vanity_url}`) differ from the flat error
 * keys its clients read (`vanity_url`). Issues land in the slot named by their path head.
 */
export const zodValidateWithErrorSlots = <
  S extends ZodObjectSchema,
  K extends string,
>(
  schema: S,
  slots: readonly K[],
  data: unknown
): ValidationOutcome<ParsedData<z.output<S>>> &
  Record<K, string> &
  DetailedErrorGeneric =>
  runZodValidation<S, Record<K, string> & DetailedErrorGeneric>(
    schema,
    data,
    slots,
    false
  );

// ── Compile-time REQUEST-DTO ↔ zod-schema binding (anti-drift) ──
//
// DECISION: `NormalizeOptional` neutralises the one piece of noise between `z.infer` and hand-written
// DTOs under `exactOptionalPropertyTypes`: zod yields optional as `key?: T | undefined`, some DTOs
// write `key?: T`. It reduces both to `key?: T` while KEEPING required-vs-optional, so the binding
// catches real drift (added/removed field, type change, required<->optional) and ignores syntactic
// noise. Usage: one exported aggregate type per domain, each property
// `AssertTrue<SchemaMatchesDto<z.infer<typeof schemaX>, DTO['X']['REQUEST']>>`; `AssertTrue<false>`
// does not compile, so drift stops the build.
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

export type NormalizeOptional<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
    T[K],
    undefined
  >;
};

/** `NormalizeOptional` applied recursively: the static type of a validator's `__data`. */
export type ParsedData<T> = T extends readonly (infer U)[]
  ? ParsedData<U>[]
  : T extends Date
    ? T
    : T extends object
      ? NormalizeOptional<{ [K in keyof T]: ParsedData<T[K]> }>
      : T;

export type SchemaMatchesDto<Schema, Dto> = Equals<
  NormalizeOptional<Schema>,
  NormalizeOptional<Dto>
>;

/** Resolves to `true` only when `T` is exactly `true`; otherwise a compile error. */
export type AssertTrue<T extends true> = T;
