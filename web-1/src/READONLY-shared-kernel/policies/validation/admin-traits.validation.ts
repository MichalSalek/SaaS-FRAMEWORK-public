import { z } from 'zod';
import { TRAIT_CATEGORIES } from '../../domain/admin/traits.config';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  VALIDATION_BULK,
  VALIDATION_LENGTHS,
  VALIDATION_REGEX,
} from '../validation.config';
import { validateOptionalHttpsUrl } from './validation.utils';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// ── Shared field schemas ──────────────────────────────────────────────────
// `name` is validated against the *trimmed* length in the original (a
// whitespace-only string trims below COLOR/TRAIT_NAME_MIN=1 → invalid), so we
// `.trim()` before `.min`/`.max`. Type, min and max all carry the single
// `invalidName` key the original emitted, and the chain short-circuits so at
// most one issue fires (mirrors "added once").
const colorNameSchema = z
  .string({ error: V.admin.invalidName })
  .trim()
  .min(VALIDATION_LENGTHS.COLOR_NAME_MIN, V.admin.invalidName)
  .max(VALIDATION_LENGTHS.COLOR_NAME_MAX, V.admin.invalidName);

const traitNameSchema = z
  .string({ error: V.admin.invalidName })
  .trim()
  .min(VALIDATION_LENGTHS.TRAIT_NAME_MIN, V.admin.invalidName)
  .max(VALIDATION_LENGTHS.TRAIT_NAME_MAX, V.admin.invalidName);

// hex_code: original rejected falsy/non-string/non-#RRGGBB, all with the single
// `invalidHexCode` key. `z.string({error}).regex(...)` reproduces this — empty
// string and non-matching strings fail the regex, non-strings fail the type
// check, every path carries `invalidHexCode`.
const hexCodeSchema = z
  .string({ error: V.admin.invalidHexCode })
  .regex(VALIDATION_REGEX.HEX_COLOR, V.admin.invalidHexCode);

// category enum (create-required & update-partial share the SAME error key:
// `invalidCategory` for missing/non-member/non-string). `z.enum` infers exactly
// `TraitCategory` (= TraitCategoryValue), so the binding holds without z.string().
const categorySchema = z.enum(TRAIT_CATEGORIES, {
  error: V.admin.invalidCategory,
});

// display_order: original checks `!== undefined && (typeof !== 'number' || < MIN)`.
// `.optional()` skips when undefined; non-number → type error, below-min → min
// error, all with `invalidDisplayOrder`.
// DECISION (nie usuwaj tego komentarza):
// `.int().max(2147483647)` added (admin-colors-traits-1) — display_order is persisted
// to a Postgres Int4 column. The original hand-written check imposed NEITHER bound, so a
// float (e.g. 1.5) or a value > 2^31-1 reached Prisma and crashed the write with a raw
// 500 (int4 overflow / "expected int got float"). Both now reject at the boundary with a
// deterministic 400 carrying the EXISTING `invalidDisplayOrder` token — deliberately
// REUSING that key (a new i18n key would need runtime translations in
// main/src/locales/{pl,en,de}/common.json; reuse avoids the parity burden). 2147483647 =
// Int4 max; the consumer column cannot hold more, so this is the canonical contract bound.
const displayOrderSchema = z
  .number({ error: V.admin.invalidDisplayOrder })
  .int(V.admin.invalidDisplayOrder)
  .min(VALIDATION_BULK.MIN_DISPLAY_ORDER, V.admin.invalidDisplayOrder)
  .max(2147483647, V.admin.invalidDisplayOrder)
  .optional();

// boolean flags (is_active / is_featured): partial-optional; non-boolean →
// type error with `featureFlag.invalidEnabled` (CT-1 — blocks silent 500).
const booleanFlagSchema = z
  .boolean({ error: V.featureFlag.invalidEnabled })
  .optional();

// icon_url: HTTPS-only XSS hardening via the security helper (reused, NOT
// reimplemented). `z.string({error})` first rejects non-strings with the
// `invalidIconUrl` key (pinned: number/object icon_url is rejected); the refine
// then runs the allowlist on the string (empty string = "no URL" → valid).
// `.optional()` mirrors the DTO `icon_url?: string` (absence = valid; the helper
// itself returns true for undefined, so behavior is unchanged).
const iconUrlSchema = z
  .string({ error: V.admin.invalidIconUrl })
  .refine(
    v => validateOptionalHttpsUrl(v, VALIDATION_LENGTHS.ICON_URL_MAX),
    V.admin.invalidIconUrl
  )
  .optional();

// required id field (color_id / trait_id): falsy/non-string → `invalidId`.
const requiredIdSchema = z
  .string({ error: V.admin.invalidId })
  .min(1, V.admin.invalidId);

// ── Per-validator object schemas ──────────────────────────────────────────
const adminCreateColorSchema = z.object({
  name: colorNameSchema,
  hex_code: hexCodeSchema,
  display_order: displayOrderSchema,
});

const adminUpdateColorSchema = z.object({
  color_id: requiredIdSchema,
  name: colorNameSchema.optional(),
  hex_code: hexCodeSchema.optional(),
  display_order: displayOrderSchema,
  is_active: booleanFlagSchema,
});

const adminDeleteColorSchema = z.object({
  color_id: requiredIdSchema,
});

const adminCreateTraitSchema = z.object({
  name: traitNameSchema,
  category: categorySchema,
  icon_url: iconUrlSchema,
  display_order: displayOrderSchema,
  is_featured: booleanFlagSchema,
});

const adminUpdateTraitSchema = z.object({
  trait_id: requiredIdSchema,
  name: traitNameSchema.optional(),
  category: categorySchema.optional(),
  icon_url: iconUrlSchema,
  display_order: displayOrderSchema,
  is_active: booleanFlagSchema,
  is_featured: booleanFlagSchema,
});

const adminDeleteTraitSchema = z.object({
  trait_id: requiredIdSchema,
});

export const adminTraitsValidators = {
  // getColors / getTraits = always-valid passthrough (GET, no request body to
  // validate). No schema, no witness — there is nothing to bind to (REQUEST is
  // effectively absent). Kept as the exact `{__isValid:true, __general:''}` the
  // original returned, ignoring input.
  getColors: (_data: unknown) => ({ __isValid: true, __general: '' }),
  getTraits: (_data: unknown) => ({ __isValid: true, __general: '' }),

  adminCreateColor: (data: unknown) =>
    zodValidate(adminCreateColorSchema, data),
  adminUpdateColor: (data: unknown) =>
    zodValidate(adminUpdateColorSchema, data),
  adminDeleteColor: (data: unknown) =>
    zodValidate(adminDeleteColorSchema, data),
  adminCreateTrait: (data: unknown) =>
    zodValidate(adminCreateTraitSchema, data),
  adminUpdateTrait: (data: unknown) =>
    zodValidate(adminUpdateTraitSchema, data),
  adminDeleteTrait: (data: unknown) =>
    zodValidate(adminDeleteTraitSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the
// schema's inferred output drifts from its REQUEST DTO. Exported so it is never
// flagged unused. getColors/getTraits are omitted (no REQUEST body to bind).
export type AdminTraitsRequestSchemaBindings = {
  adminCreateColor: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminCreateColorSchema>,
      ADMIN_DTO_API_V1['ADMIN_CREATE_COLOR']['REQUEST']
    >
  >;
  adminUpdateColor: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminUpdateColorSchema>,
      ADMIN_DTO_API_V1['ADMIN_UPDATE_COLOR']['REQUEST']
    >
  >;
  adminDeleteColor: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminDeleteColorSchema>,
      ADMIN_DTO_API_V1['ADMIN_DELETE_COLOR']['REQUEST']
    >
  >;
  adminCreateTrait: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminCreateTraitSchema>,
      ADMIN_DTO_API_V1['ADMIN_CREATE_TRAIT']['REQUEST']
    >
  >;
  adminUpdateTrait: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminUpdateTraitSchema>,
      ADMIN_DTO_API_V1['ADMIN_UPDATE_TRAIT']['REQUEST']
    >
  >;
  adminDeleteTrait: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminDeleteTraitSchema>,
      ADMIN_DTO_API_V1['ADMIN_DELETE_TRAIT']['REQUEST']
    >
  >;
};
