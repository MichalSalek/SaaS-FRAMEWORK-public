import type { z } from 'zod';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { ValidationFlag } from './validation.types';
import { hasReturnObjectValidationError } from './validation.utils';

/**
 * zod engine for the REQUEST validators (FWE Wave H).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Walidatory są przepisane na schematy zod, ALE kontrakt `ValidationFunction` (i cały
 * seam middleware) pozostaje NIEZMIENIONY: walidator nadal zwraca `{__isValid, __general,
 * <pole>: ''}` (pusty string = OK, niepusty = i18n-błąd), a `request.middleware`
 * przekazuje do businessLogic ten sam *coalesced* body — NIE sparsowany output zod.
 * Powód: body jest scentralizowane i coalesce'owane w jednym miejscu (request.middleware
 * §4 GET REQUEST BODY); podmiana body na `schema.parse()` strip'owałaby klucze, których
 * handlery używają, a siatka testów charakteryzacyjnych pokrywa walidator w IZOLACJI,
 * nie użycie body w handlerze — to byłaby cicha regresja niewidoczna dla testów. zod tu
 * = silnik walidacji + compile-time wiązanie `z.infer == REQUEST_DTO` (anti-drift),
 * NIE warstwa transportu body. Ratchet `audit:no-body-cast` trzyma anty-cast intent.
 */

/**
 * Runs a zod object schema and projects its issues onto the project's per-field
 * error-DTO shape: `{__isValid, __general, <field>: ''}`. Empty string = valid field,
 * non-empty = accumulated i18n error message(s).
 *
 * Mirrors the `request.middleware` body coalesce (non-plain-object → `{}`) so a
 * null/array/primitive input yields per-field "missing" issues exactly like the
 * hand-written validators did (which optional-chained `data?.field`). Error-slot keys
 * are derived from `schema.shape`, so they stay in lockstep with the schema (and, via
 * the SchemaMatchesDto binding below, with the REQUEST DTO).
 */
export const zodValidate = <S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
  data: unknown
): ValidationFlag & DetailedErrorPayload<z.infer<S>> => {
  const fields: Record<string, string> = { __general: '' };
  for (const key of Object.keys(schema.shape)) {
    fields[key] = '';
  }

  const input =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? data
      : {};

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const top = issue.path.length > 0 ? String(issue.path[0]) : '__general';
      const slot = top in fields ? top : '__general';
      fields[slot] = fields[slot] + issue.message + ' ';
    }
  }

  // DECISION (nie usuwaj tego komentarza):
  // Return type derived from the schema (`DetailedErrorPayload<z.infer<S>>`) so consumers
  // keep the SAME typed error-DTO fields the hand-written validators exposed (e.g. the
  // frontend reads `validation.email.trim()`). DetailedErrorPayload maps keys→string, so
  // every error slot stays `string` regardless of the schema's value types. The runtime
  // object is keyed by `schema.shape`, matching those keys; the cast bridges the
  // string-built object to the per-key error type.
  const __isValid = hasReturnObjectValidationError({
    __isValid: false,
    ...fields,
  });
  return { __isValid, ...fields } as unknown as ValidationFlag &
    DetailedErrorPayload<z.infer<S>>;
};

// ── Compile-time REQUEST-DTO ↔ zod-schema binding (anti-drift) ──
//
// DECISION (nie usuwaj tego komentarza):
// `NormalizeOptional` neutralizuje JEDYNĄ różnicę szumu między `z.infer` a ręcznymi
// DTO pod `exactOptionalPropertyTypes`: zod produkuje optional jako `key?: T | undefined`,
// część DTO pisze `key?: T` (bez jawnego undefined). Normalizacja sprowadza OBA do
// `key?: T`, ZACHOWUJĄC rozróżnienie required-vs-optional (pola wymagane zostają w
// "required bucket"). Dzięki temu binding wyłapuje PRAWDZIWY drift (dodane/usunięte pole,
// zmiana typu, required↔optional), a ignoruje czysto-składniowy szum optional-undefined.
// Użycie (w pliku walidatora): jeden eksportowany typ agregujący per domena, każda
// własność = `AssertTrue<SchemaMatchesDto<z.infer<typeof schemaX>, DTO['X']['REQUEST']>>`.
// `SchemaMatchesDto` rozwija się do konkretnego `true`/`false` w miejscu użycia (konkretne
// typy), a `AssertTrue<false>` nie kompiluje się → drift zatrzymuje build.
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

export type SchemaMatchesDto<Schema, Dto> = Equals<
  NormalizeOptional<Schema>,
  NormalizeOptional<Dto>
>;

/** Resolves to `true` only when `T` is exactly `true`; otherwise a compile error. */
export type AssertTrue<T extends true> = T;
