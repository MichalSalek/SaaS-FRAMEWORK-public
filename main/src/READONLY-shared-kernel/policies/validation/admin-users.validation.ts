import { z } from 'zod';
import {
  adminBecomeUserSchema,
  adminBulkChangePlanSchema,
  adminBulkDisableSchema,
  adminBulkEnableSchema,
  adminBulkLogoutSchema,
  adminChangePricingPlanSchema,
  purgeDeletedUserSchema,
} from '../../domain/admin/admin.contract-schemas';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import type { SESSION_DTO_API_V1 } from '../../models/session/session.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// User disable/enable and session revocation stay here. Admin bulk, become-user,
// pricing-plan and purge schemas live in admin.contract-schemas.ts.

// Presence + typeof-string gate ONLY (NO falsy check): an empty-string id PASSES, a
// missing key / non-string / null payload rejects. A bare `z.string()` matches exactly
// (accepts '', required-error on missing, type-error on non-string).
const deleteOrDisableOtherUserSchema = z.object({
  id: z.string({ error: V.user.noIdentifier }),
});

const enableOtherUserSchema = z.object({
  id: z.string({ error: V.user.noIdentifier }),
});

// validateRequiredId-backed (falsy check): empty string REJECTS. Single message for both
// missing and non-string (the original passed one message into validateRequiredId).
const deleteSessionSchema = z.object({
  id: z.string({ error: V.session.missingId }).min(1, V.session.missingId),
});

// SESSION_DELETE_ALL: no body (or no id) = log the CALLER out everywhere; an id targets that user
// (MASTER_ADMIN only, enforced in the handler). SECURITY: a provided id MUST be a string, otherwise an
// operator object such as `{ gt: '' }` reaches `deleteMany({ where: { userId } })` as a valid
// StringFilter and deletes every user's sessions. The empty string passes here as it always did
// (the operation rejects it).
const sessionDeleteAllSchema = z.object({
  id: z.string({ error: V.user.invalidId }).optional(),
});

export const adminUsersValidators = {
  deleteOrDisableOtherUser: (data: unknown) =>
    zodValidate(deleteOrDisableOtherUserSchema, data),
  purgeDeletedUser: (data: unknown) =>
    zodValidate(purgeDeletedUserSchema, data),
  enableOtherUser: (data: unknown) => zodValidate(enableOtherUserSchema, data),
  deleteSession: (data: unknown) => zodValidate(deleteSessionSchema, data),
  sessionDeleteAll: (data: unknown) =>
    zodValidate(sessionDeleteAllSchema, data),
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
