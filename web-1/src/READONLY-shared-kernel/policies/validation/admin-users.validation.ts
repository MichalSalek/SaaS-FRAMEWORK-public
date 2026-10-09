import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import { PricingPlanValue } from '../../domain/pricing/pricing.config';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import type { SESSION_DTO_API_V1 } from '../../models/session/session.dto';
import { VALIDATION_BULK } from '../validation.config';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// ── Shared field schemas ──

// `user_ids` bulk field. The hand-written original was an if / else-if / else-if chain
// emitting EXACTLY ONE message per call with this precedence:
//   1. not-array OR empty          → bulk.userIdsRequired
//   2. length > MAX_USER_IDS       → bulk.userIdsTooMany
//   3. any non-string / '' element → bulk.userIdsInvalid
// A native `z.array(z.string()).min().max()` schema can't reproduce that single-message
// else-if precedence (it surfaces per-element errors AND the array error together, and a
// non-array/element parse failure would skip a downstream refine and emit a non-i18n
// default). So the field is declared as `z.custom<string[]>` (binds z.infer === string[]
// for the witness) and the entire branching lives in one `.superRefine` that mirrors the
// original byte-for-byte (incl. over-cap-AND-dirty → only `userIdsTooMany`).
const bulkUserIdsField = z.custom<string[]>().superRefine((val, ctx) => {
  if (!Array.isArray(val) || val.length === 0) {
    ctx.addIssue({ code: 'custom', message: V.bulk.userIdsRequired });
  } else if (val.length > VALIDATION_BULK.MAX_USER_IDS) {
    ctx.addIssue({ code: 'custom', message: V.bulk.userIdsTooMany });
  } else if (
    val.some((id: unknown) => typeof id !== 'string' || id.length === 0)
  ) {
    ctx.addIssue({ code: 'custom', message: V.bulk.userIdsInvalid });
  }
});

// pricing_plan — else-if variant (adminBulkChangePlan): ONE message.
//   falsy (incl. '') → payment.missingPlan ; otherwise-not-in-allowlist → payment.invalidPlan
// z.enum(PricingPlanValue) has IDENTICAL allowlist semantics to the original narrower
// (`Object.values(PricingPlanValue).includes(value)`): exact string match, so 'PRO ',
// 'pro', '__proto__' all reject.
const pricingPlanEnumElseIf = z.enum(PricingPlanValue, {
  error: issue => {
    const hasInput = Boolean(issue.input);
    return hasInput ? V.payment.invalidPlan : V.payment.missingPlan;
  },
});

// pricing_plan — sequential variant (adminChangePricingPlan): the original ran TWO
// non-exclusive `if`s, so a falsy value accumulated BOTH keys:
//   if (!pricing_plan)        → missingPlan
//   if (!narrower(...))       → invalidPlan
// → '' yields `missingPlan invalidPlan `, a non-falsy invalid yields `invalidPlan ` only,
//   a valid plan yields nothing. zod emits a single enum issue per field, and an object
//   `.superRefine` is skipped once a field parse fails, so the dual key is reproduced by
//   returning the SAME space-joined two-key string the original accumulated for the falsy
//   case (zodValidate then appends its own trailing space → identical slot value).
const pricingPlanEnumSequential = z.enum(PricingPlanValue, {
  error: issue => {
    const hasInput = Boolean(issue.input);
    return hasInput
      ? V.payment.invalidPlan
      : `${V.payment.missingPlan} ${V.payment.invalidPlan}`;
  },
});

// ── Per-validator schemas ──

// Presence + typeof-string gate ONLY (NO falsy check): an empty-string id PASSES, a
// missing key / non-string / null payload rejects. A bare `z.string()` matches exactly
// (accepts '', required-error on missing, type-error on non-string).
const deleteOrDisableOtherUserSchema = z.object({
  id: z.string({ error: V.user.noIdentifier }),
});

const enableOtherUserSchema = z.object({
  id: z.string({ error: V.user.noIdentifier }),
});

const purgeDeletedUserSchema = z.object({
  user_id: z.string({ error: V.user.noIdentifier }),
});

// validateRequiredId-backed (falsy check): empty string REJECTS. Single message for both
// missing and non-string (the original passed one message into validateRequiredId).
const deleteSessionSchema = z.object({
  id: z.string({ error: V.session.missingId }).min(1, V.session.missingId),
});

const adminBecomeUserSchema = z.object({
  id: z.string({ error: V.user.invalidId }).min(1, V.user.invalidId),
});

const adminChangePricingPlanSchema = z.object({
  // id: falsy check (`!typedData.id`) → empty rejects, single key invalidId.
  id: z.string({ error: V.user.invalidId }).min(1, V.user.invalidId),
  pricing_plan: pricingPlanEnumSequential,
});

const adminBulkDisableSchema = z.object({ user_ids: bulkUserIdsField });
const adminBulkEnableSchema = z.object({ user_ids: bulkUserIdsField });
const adminBulkLogoutSchema = z.object({ user_ids: bulkUserIdsField });

const adminBulkChangePlanSchema = z.object({
  user_ids: bulkUserIdsField,
  pricing_plan: pricingPlanEnumElseIf,
});

export const adminUsersValidators = {
  deleteOrDisableOtherUser: (data: unknown) =>
    zodValidate(deleteOrDisableOtherUserSchema, data),
  purgeDeletedUser: (data: unknown) =>
    zodValidate(purgeDeletedUserSchema, data),
  enableOtherUser: (data: unknown) => zodValidate(enableOtherUserSchema, data),
  deleteSession: (data: unknown) => zodValidate(deleteSessionSchema, data),
  adminChangePricingPlan: (data: unknown) =>
    zodValidate(adminChangePricingPlanSchema, data),
  adminBecomeUser: (data: unknown) => zodValidate(adminBecomeUserSchema, data),
  adminBulkDisable: (data: unknown) =>
    zodValidate(adminBulkDisableSchema, data),
  adminBulkEnable: (data: unknown) => zodValidate(adminBulkEnableSchema, data),
  adminBulkChangePlan: (data: unknown) =>
    zodValidate(adminBulkChangePlanSchema, data),
  adminBulkLogout: (data: unknown) => zodValidate(adminBulkLogoutSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
export type AdminUsersRequestSchemaBindings = {
  deleteOrDisableOtherUser: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof deleteOrDisableOtherUserSchema>,
      ADMIN_DTO_API_V1['USER_DELETE_ANY']['REQUEST']
    >
  >;
  enableOtherUser: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof enableOtherUserSchema>,
      ADMIN_DTO_API_V1['USER_ENABLE_ANY']['REQUEST']
    >
  >;
  purgeDeletedUser: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof purgeDeletedUserSchema>,
      ADMIN_DTO_API_V1['ADMIN_PURGE_DELETED_USER']['REQUEST']
    >
  >;
  deleteSession: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof deleteSessionSchema>,
      SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['REQUEST']
    >
  >;
  adminBecomeUser: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminBecomeUserSchema>,
      ADMIN_DTO_API_V1['BECOME_USER']['REQUEST']
    >
  >;
  adminChangePricingPlan: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminChangePricingPlanSchema>,
      ADMIN_DTO_API_V1['ADMIN_CHANGE_PRICING_PLAN']['REQUEST']
    >
  >;
  adminBulkDisable: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminBulkDisableSchema>,
      ADMIN_DTO_API_V1['ADMIN_BULK_DISABLE']['REQUEST']
    >
  >;
  adminBulkEnable: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminBulkEnableSchema>,
      ADMIN_DTO_API_V1['ADMIN_BULK_ENABLE']['REQUEST']
    >
  >;
  adminBulkChangePlan: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminBulkChangePlanSchema>,
      ADMIN_DTO_API_V1['ADMIN_BULK_CHANGE_PLAN']['REQUEST']
    >
  >;
  adminBulkLogout: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminBulkLogoutSchema>,
      ADMIN_DTO_API_V1['ADMIN_BULK_LOGOUT']['REQUEST']
    >
  >;
};
