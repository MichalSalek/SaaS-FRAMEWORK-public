import { z } from 'zod';
import { ANNOUNCEMENT_TYPES } from './announcements.config';
import {
  announcementTranslationsSchema,
  hasAnnouncementAudience,
} from './announcement-content';
import { TRAIT_CATEGORIES } from './traits.config';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import {
  VALIDATION_BULK,
  VALIDATION_CONFIG,
  VALIDATION_LENGTHS,
  VALIDATION_REGEX,
} from '../../policies/validation.config';
import { validateOptionalHttpsUrl } from '../../policies/validation/validation.utils';

const V = VALIDATION_MESSAGES;

/** Bodyless command (switch-back, refresh): the handler receives `{}`. */
export const emptyBodySchema = z.object({});

// ── Notes ────────────────────────────────────────────────────────────────────

export const adminSaveNoteSchema = z.object({
  notes: z.string({ error: V.admin.missingNotes }).min(1, V.admin.missingNotes),
});

export const adminSetMainNoteSchema = z.object({
  id: z.string({ error: V.admin.invalidNoteId }).min(1, V.admin.invalidNoteId),
});

// ── Policies ─────────────────────────────────────────────────────────────────

// id optional on create. title/content: missing and whitespace share one key; max runs first.
export const adminSavePolicySchema = z.object({
  id: z.string({ error: V.admin.invalidPolicyId }).optional(),
  title: z
    .string({ error: V.admin.missingPolicyTitle })
    .max(VALIDATION_LENGTHS.POLICY_TITLE_MAX, V.admin.policyTitleTooLong)
    .refine(v => v.trim().length > 0, V.admin.missingPolicyTitle),
  content: z
    .string({ error: V.admin.missingPolicyContent })
    .max(VALIDATION_LENGTHS.POLICY_CONTENT_MAX, V.admin.policyContentTooLong)
    .refine(v => v.trim().length > 0, V.admin.missingPolicyContent),
});

export const adminDeletePolicySchema = z.object({
  id: z
    .string({ error: V.admin.invalidPolicyId })
    .min(1, V.admin.invalidPolicyId),
});

export const adminSetMainPolicySchema = z.object({
  id: z
    .string({ error: V.admin.invalidPolicyId })
    .min(1, V.admin.invalidPolicyId),
});

// ── Feature flags, debug, check-access URL, RBAC, runtime config ────────────

// Unknown key is a 404 from the operation, not a validation error.
export const adminToggleFeatureFlagSchema = z.object({
  key: z
    .string({ error: V.featureFlag.invalidKey })
    .min(1, V.featureFlag.invalidKey),
  is_enabled: z.boolean({ error: V.featureFlag.invalidEnabled }),
});

export const adminDebugModeSchema = z.object({
  enabled: z.boolean({ message: V.general.booleanRequired }),
  debug_db: z.boolean({ message: V.general.booleanRequired }).optional(),
});

// Falsy url → urlRequired; truthy non-string → urlMustBeString; any string passes.
// DECISION: not z.string(), because the original split those two messages by JS truthiness.
export const adminCheckAccessUrlSchema = z
  .object({
    url: z.custom<string>().optional(),
  })
  .superRefine((val, ctx) => {
    const url: unknown = val.url;
    if (Boolean(url) === false) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: V.checkAccess.urlRequired,
      });
    } else if (typeof url !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: V.checkAccess.urlMustBeString,
      });
    }
  });

// Empty permission_ids is valid (revoke all). Each element must be a non-empty string.
export const adminUpdatePermissionsSchema = z.object({
  role_id: z
    .string({ error: V.permissions.roleIdRequired })
    .min(1, V.permissions.roleIdRequired),
  permission_ids: z.array(
    z
      .string({ error: V.permissions.permissionIdsRequired })
      .min(1, V.permissions.permissionIdsRequired),
    { error: V.permissions.permissionIdsRequired }
  ),
});

// Cap depends on the value shape: JSON object/array 32 KB, a scalar 1 KB.
// DECISION: field-level superRefine so a bad key still reports a too-long value.
export const adminUpdateConfigSchema = z.object({
  key: z.string({ error: V.config.keyRequired }).min(1, V.config.keyRequired),
  value: z
    .string({ error: V.config.valueMustBeString })
    .superRefine((value, ctx) => {
      const trimmed = value.trim();
      const isJsonComplex =
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'));
      const cap = isJsonComplex
        ? VALIDATION_CONFIG.VALUE_OBJECT_MAX
        : VALIDATION_CONFIG.VALUE_PRIMITIVE_MAX;
      if (value.length > cap) {
        ctx.addIssue({ code: 'custom', message: V.config.valueTooLong });
      }
    }),
});

// ── Announcements ────────────────────────────────────────────────────────────

const announcementTitleSchema = z
  .string({ error: V.announcement.titleInvalid })
  .refine(
    v =>
      v.trim().length >= 1 &&
      v.trim().length <= VALIDATION_LENGTHS.ANNOUNCEMENT_TITLE_MAX,
    V.announcement.titleInvalid
  );

const announcementMessageSchema = z
  .string({ error: V.announcement.messageInvalid })
  .refine(
    v =>
      v.trim().length >= 1 &&
      v.trim().length <= VALIDATION_LENGTHS.ANNOUNCEMENT_MESSAGE_MAX,
    V.announcement.messageInvalid
  );

const announcementTypeSchema = z.enum(ANNOUNCEMENT_TYPES, {
  error: V.announcement.typeInvalid,
});

export const adminCreateAnnouncementSchema = z
  .object({
    title: announcementTitleSchema,
    message: announcementMessageSchema,
    type: announcementTypeSchema,
    is_active: z.boolean({ error: V.announcement.isActiveInvalid }),
    starts_at: z.string({ error: V.announcement.startsAtInvalid }).optional(),
    ends_at: z.string({ error: V.announcement.endsAtInvalid }).optional(),
    translations: announcementTranslationsSchema.optional(),
    audience_anonymous: z.boolean().optional(),
    audience_client: z.boolean().optional(),
    audience_stylist: z.boolean().optional(),
  })
  .refine(
    value =>
      hasAnnouncementAudience({
        audience_anonymous: value.audience_anonymous ?? true,
        audience_client: value.audience_client ?? true,
        audience_stylist: value.audience_stylist ?? true,
      }),
    {
      message: V.announcement.audienceRequired,
      path: ['audience_anonymous'],
    }
  );

export const adminUpdateAnnouncementSchema = z.object({
  id: z.string({ error: V.admin.invalidId }).min(1, V.admin.invalidId),
  title: announcementTitleSchema.optional(),
  message: announcementMessageSchema.optional(),
  type: announcementTypeSchema.optional(),
  is_active: z.boolean({ error: V.announcement.isActiveInvalid }).optional(),
  starts_at: z
    .string({ error: V.announcement.startsAtInvalid })
    .nullable()
    .optional(),
  ends_at: z
    .string({ error: V.announcement.endsAtInvalid })
    .nullable()
    .optional(),
  translations: announcementTranslationsSchema.optional(),
  audience_anonymous: z.boolean().optional(),
  audience_client: z.boolean().optional(),
  audience_stylist: z.boolean().optional(),
});

export const adminDeleteAnnouncementSchema = z.object({
  id: z.string({ error: V.admin.invalidId }).min(1, V.admin.invalidId),
});

// ── Colors and traits ────────────────────────────────────────────────────────

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

const hexCodeSchema = z
  .string({ error: V.admin.invalidHexCode })
  .regex(VALIDATION_REGEX.HEX_COLOR, V.admin.invalidHexCode);

const categorySchema = z.enum(TRAIT_CATEGORIES, {
  error: V.admin.invalidCategory,
});

// DECISION: int and Int4 max. A float or a value above 2^31-1 used to reach Prisma as a 500.
// Both reject with the existing invalidDisplayOrder token.
const displayOrderSchema = z
  .number({ error: V.admin.invalidDisplayOrder })
  .int(V.admin.invalidDisplayOrder)
  .min(VALIDATION_BULK.MIN_DISPLAY_ORDER, V.admin.invalidDisplayOrder)
  .max(2147483647, V.admin.invalidDisplayOrder)
  .optional();

const booleanFlagSchema = z
  .boolean({ error: V.featureFlag.invalidEnabled })
  .optional();

const iconUrlSchema = z
  .string({ error: V.admin.invalidIconUrl })
  .refine(
    v => validateOptionalHttpsUrl(v, VALIDATION_LENGTHS.ICON_URL_MAX),
    V.admin.invalidIconUrl
  )
  .optional();

const requiredIdSchema = z
  .string({ error: V.admin.invalidId })
  .min(1, V.admin.invalidId);

export const adminCreateColorSchema = z.object({
  name: colorNameSchema,
  hex_code: hexCodeSchema,
  display_order: displayOrderSchema,
});

export const adminUpdateColorSchema = z.object({
  color_id: requiredIdSchema,
  name: colorNameSchema.optional(),
  hex_code: hexCodeSchema.optional(),
  display_order: displayOrderSchema,
  is_active: booleanFlagSchema,
});

export const adminDeleteColorSchema = z.object({
  color_id: requiredIdSchema,
});

export const adminCreateTraitSchema = z.object({
  name: traitNameSchema,
  category: categorySchema,
  icon_url: iconUrlSchema,
  display_order: displayOrderSchema,
  is_featured: booleanFlagSchema,
});

export const adminUpdateTraitSchema = z.object({
  trait_id: requiredIdSchema,
  name: traitNameSchema.optional(),
  category: categorySchema.optional(),
  icon_url: iconUrlSchema,
  display_order: displayOrderSchema,
  is_active: booleanFlagSchema,
  is_featured: booleanFlagSchema,
});

export const adminDeleteTraitSchema = z.object({
  trait_id: requiredIdSchema,
});

export {
  purgeDeletedUserSchema,
  adminBecomeUserSchema,
  adminChangePricingPlanSchema,
  adminBulkDisableSchema,
  adminBulkEnableSchema,
  adminBulkLogoutSchema,
  adminBulkChangePlanSchema,
  adminResolveReportSchema,
  adminApplyStrikeSchema,
  sendLogSchema,
  getUserTimelineRuntimeSchema,
  getUserTimelineBindingSchema,
  getLogsSchema,
  getLogDetailsSchema,
  getLogGroupsSchema,
  setLogIssueStatusSchema,
  adminGetReportsSchema,
} from './admin-command-users.contract-schemas';
