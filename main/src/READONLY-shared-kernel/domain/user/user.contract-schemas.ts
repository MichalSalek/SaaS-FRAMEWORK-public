import { isStripeHostedInvoiceUrl } from '../stripe/hosted-invoice-url';
import { z } from 'zod';
import { EXTERNAL_LINK_LIMIT } from '../user-and-account/external-links.config';
import { wireInstant } from '../../application/contracts/wire-values';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import {
  AccountStatusValue,
  AccountTypeValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '../../models/db_models.generated.dto';
import { SystemRoleId } from '../../models/db_models.manual.dto';
import { PricingPlanValue } from '../pricing/pricing.config';
import {
  VALIDATION_LENGTHS,
  VALIDATION_REGEX,
  VALIDATION_SOCIAL,
} from '../../policies/validation.config';
import {
  checkPhoneLength,
  validateByMaxLength,
  validateByMinLength,
  validateByWhiteSpaces,
  validateEmail,
} from '../../policies/validation/validation.utils';

const V = VALIDATION_MESSAGES;

/** Command with no fields. A missing body parses as {}. Unknown keys are stripped. */
export const emptyCommandBody = z.object({});

/** A 200 whose `data` is omitted (`respondSuccess(..., undefined)`). */
export const emptyResponse = z.undefined();

export const userChangeEmailSchema = z.object({
  email: z
    .string({ error: V.email.invalid })
    .refine(v => validateEmail(v), V.email.invalid)
    .refine(v => validateByWhiteSpaces(v), V.email.noSpaces),
});

export const userChangeNameSchema = z.object({
  name: z
    .string({ error: V.name.invalid })
    .refine(
      v => validateByMinLength(v.trim(), VALIDATION_LENGTHS.NAME_MIN),
      V.name.tooShort
    )
    .refine(
      v => validateByMaxLength(v.trim(), VALIDATION_LENGTHS.NAME_MAX),
      V.name.tooLong
    ),
});

export const userOnboardAsClientSchema = z.object({
  terms_accepted: z.boolean({ error: V.general.booleanRequired }).optional(),
});

export const userOnboardAsStylistSchema = z.object({
  // DECISION: onboarding asks for the role only; name and city moved to the card shown after her first
  // photo. `null` = not given yet and is accepted; a string still has to meet the length rules. A
  // profile without a name is NOT given the account name: the backend returns the raw null, the
  // frontend shows a generic label and marks the page noindex, and the sitemap skips it
  // (getSitemapProfiles_IO) (owner).
  // DECISION: display_name/address_city are `string | null` (.nullable()) because the DTO types them
  // nullable and the binding needs z.infer == DTO. A non-string non-null value fails the base parse
  // with the field's i18n key; null passes the base and superRefine returns at once.
  // DECISION: min/max run in a FIELD-LEVEL `.superRefine` (not object-level) so the two fields
  // validate INDEPENDENTLY: a non-string sibling fails the base parse and zod would skip an
  // object-level superRefine, losing cityTooShort/cityTooLong.
  display_name: z
    .string({ error: V.name.invalid })
    .nullable()
    .superRefine((value, ctx) => {
      if (value === null) {
        return;
      }
      const t = value.trim();
      if (!validateByMinLength(t, VALIDATION_LENGTHS.NAME_MIN)) {
        ctx.addIssue({ code: 'custom', message: V.name.tooShort });
      }
      if (!validateByMaxLength(t, VALIDATION_LENGTHS.NAME_MAX)) {
        ctx.addIssue({ code: 'custom', message: V.name.tooLong });
      }
    }),
  address_city: z
    .string({ error: V.address.cityRequired })
    .nullable()
    .superRefine((value, ctx) => {
      if (value === null) {
        return;
      }
      const t = value.trim();
      if (!validateByMinLength(t, VALIDATION_LENGTHS.CITY_MIN)) {
        ctx.addIssue({ code: 'custom', message: V.address.cityTooShort });
      }
      if (!validateByMaxLength(t, VALIDATION_LENGTHS.CITY_MAX)) {
        ctx.addIssue({ code: 'custom', message: V.address.cityTooLong });
      }
    }),
  // DECISION: phone is a real `z.string()`: a non-string is rejected with invalidFormat. The original
  // silently SKIPPED a non-string, and since the handler receives the parsed payload that skip let an
  // object such as `{ set: '...' }` reach the Prisma update as an operator, bypassing the format and
  // length checks. null / absent / blank stay "no phone" (the refine accepts them).
  phone: z
    .string({ error: V.phone.invalidFormat })
    .nullable()
    .optional()
    .refine(v => {
      if (typeof v !== 'string') {
        return true;
      }
      const trimmed = v.trim();
      if (trimmed.length === 0) {
        return true;
      }
      // DECISION: a DIGIT floor, not only a character window. PHONE_ONBOARDING is a 9-20 CHARACTER
      // window over [digits + - ( ) space], documented as stricter than PHONE_FORMAT to block gibberish,
      // but "(((((((((" and "+++++++++" (9 characters, zero digits) passed because the regex blocks only
      // letters. `checkPhoneLength` (the SSOT of the client contact path in misc.validation) is added so
      // both paths agree on what a number is: 9-15 digits, PHONE_FIELD_MAX ceiling on the raw string.
      // The regex stays as the character allowlist.
      return (
        VALIDATION_REGEX.PHONE_ONBOARDING.test(trimmed) &&
        checkPhoneLength(trimmed) === null
      );
    }, V.phone.invalidFormat),
  email_marketing: z.boolean({ error: V.general.booleanRequired }).optional(),
  terms_accepted: z.boolean({ error: V.general.booleanRequired }).optional(),
  // Same rules and messages as the profile editor's social section
  // (account.validation): Instagram's own charset, max 30, empty = none. The
  // frontend strips „@” and a pasted profile URL before sending.
  instagram_handle: z
    .string({ error: V.social.instagramNotString })
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      if (typeof value !== 'string' || value.length === 0) {
        return;
      }
      if (value.length > VALIDATION_SOCIAL.INSTAGRAM_HANDLE_MAX) {
        ctx.addIssue({ code: 'custom', message: V.social.instagramTooLong });
      } else if (!VALIDATION_REGEX.INSTAGRAM_HANDLE.test(value)) {
        ctx.addIssue({
          code: 'custom',
          message: V.social.instagramInvalidChars,
        });
      }
    }),
});

export const userSwitchRoleSchema = z.object({
  account_type: z.enum(AccountTypeValue, { error: V.role.invalid }),
});

export const userCheckRecoverySchema = z.object({
  email: z
    .string({ error: V.email.invalid })
    .refine(v => validateEmail(v), V.email.invalid),
});

export const userUpdateNotificationPreferencesSchema = z.object({
  notifications_enabled: z.boolean({ error: V.general.booleanRequired }),
});

// Presence + typeof-string only (empty string passes). Same shape the admin-user
// disable / enable / delete validators enforce. That file still owns its copy.
export const adminTargetUserIdSchema = z.object({
  id: z.string({ error: V.user.noIdentifier }),
});

const messageResponse = z.object({ message: z.string() });

export const userNameChangedSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const stylistAccountCreatedSchema = z.object({
  stylist_account_id: z.string(),
});

export const clientAccountCreatedSchema = z.object({
  client_account_id: z.string(),
});

export const accountStateSchema = z.object({
  role_id: z.enum(SystemRoleId),
  has_stylist_account: z.boolean(),
  has_client_account: z.boolean(),
  needs_onboarding: z.boolean(),
});

export const usageStatsSchema = z.object({
  gallery_records: z.number(),
  favorite_stylists: z.number(),
  paired_clients: z.number(),
  favorite_records_count: z.number(),
  pinned_records: z.number(),
  limits: z.object({
    max_gallery_records: z.number(),
    max_paired_stylists: z.number(),
    max_paired_clients: z.number(),
    max_pinned_records: z.number(),
    can_use_session_share: z.boolean(),
    can_use_multi_session: z.boolean(),
    can_use_staff_accounts: z.boolean(),
  }),
  pricing_plan: z.enum(PricingPlanValue),
});

export const roleSwitchedSchema = z.object({
  success: z.boolean(),
  account_type: z.enum(AccountTypeValue),
});

export const recoveryProbeSchema = z.object({
  recovery_available: z.boolean(),
  deleted_at: z.string().nullable(),
  days_left: z.number().nullable(),
});

export const accountRestoredSchema = z.object({
  success: z.boolean(),
  restored_account_type: z.enum(AccountTypeValue).nullable(),
  gallery_records_restored: z.number(),
});

export const accountReactivatedSchema = z.object({
  reactivated: z.boolean(),
});

export const accountErasedSchema = z.object({ erased: z.boolean() });

export const userDataExportedSchema = z.object({
  export_version: z.string(),
  exported_at: z.string(),
  account_type: z.enum(AccountTypeValue),
  user: z.object({
    email: z.string(),
    name: z.string(),
    created_at: z.string(),
    account_type: z.enum(AccountTypeValue),
  }),
  // Open JSON bag. A finite value check (not z.unknown / z.json): the export is a
  // nested document, and a recursive z.json() blows the type checker. Undefined
  // is the only value JSON cannot carry.
  data: z.record(
    z.string(),
    z.custom<unknown>(value => value !== undefined)
  ),
});

export const notificationPreferencesSchema = z.object({
  notifications_enabled: z.boolean(),
});

export const confirmedSchema = z.object({ confirmed: z.boolean() });

export const deleteRequestedSchema = messageResponse;
export const emailChangeRequestedSchema = messageResponse;

const nullableInstant = wireInstant.nullable();

const emailPreferencesSchema = z
  .object({
    trial_sequence: z.boolean(),
    marketing: z.boolean(),
  })
  .nullable();

const safeStylistAccountSchema = z.object({
  account_id: z.string(),
  display_name: z.string().nullable(),
  business_name: z.string().nullable(),
  address_street: z.string().nullable(),
  address_city: z.string().nullable(),
  address_postal_code: z.string().nullable(),
  address_country: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  external_links: z
    .array(z.string())
    .max(EXTERNAL_LINK_LIMIT)
    .nullable()
    .optional(),
  salon_external_links: z
    .array(z.string())
    .max(EXTERNAL_LINK_LIMIT)
    .nullable()
    .optional(),
  description: z.string().nullable(),
  vanity_url: z.string().nullable(),
  instagram_handle: z.string().nullable(),
  avatar_url: z.string().nullable(),
  brand_accent_color: z.string().nullable(),
  view_count: z.number(),
  pricing_plan: z.enum(PricingPlanValue),
  payment_status: z.enum(PaymentStatusValue),
  account_status: z.enum(AccountStatusValue),
  plan_selected_at: nullableInstant,
  subscription_status: z.enum(SubscriptionStatusValue).nullable(),
  cancel_at_period_end: z.boolean().nullable(),
  cancel_at: nullableInstant,
  current_period_end: nullableInstant,
  trial_started_at: nullableInstant,
  trial_ends_at: nullableInstant,
  admin_plan_override: z.boolean(),
  email_preferences: emailPreferencesSchema,
  effective_pricing_plan: z.enum(PricingPlanValue).optional(),
  salon_plan: z
    .object({
      salon_account_id: z.string(),
      salon_name: z.string(),
      pricing_plan: z.enum(PricingPlanValue),
    })
    .nullable()
    .optional(),
  billing: z
    .object({
      nextChargeAmount: z.number().nullable(),
      currency: z.string().nullable(),
      nextChargeAt: z.string().nullable(),
      billingPeriod: z.enum(['monthly', 'yearly']).nullable(),
      pendingPayment: z
        .object({
          reason: z.enum(['plan_change', 'subscription_start', 'invoice']),
          invoiceId: z.string(),
          url: z.string().url().refine(isStripeHostedInvoiceUrl),
          amountRemaining: z.number().int().positive(),
          currency: z.string(),
          expiresAt: z.string().datetime().nullable(),
        })
        .optional(),
      discounts: z
        .array(
          z.object({
            name: z.string().nullable(),
            percentOff: z.number().min(0).max(100).nullable(),
            amountOff: z.number().int().nonnegative().nullable(),
            currency: z.string().nullable(),
            duration: z.enum(['forever', 'once', 'repeating']),
            endsAt: z.string().datetime().nullable(),
          })
        )
        .optional(),
    })
    .nullable()
    .optional(),
  has_salon_profile: z.boolean().optional(),
  salon_display_name: z.string().optional(),
});

const safeSessionSchema = z.object({
  id: z.string(),
  expires: wireInstant,
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  device_type: z.string().nullable(),
  createdAt: wireInstant,
  updatedAt: wireInstant,
});

const clientAccountSchema = z.object({
  client_account_id: z.string(),
  created_by_user_id: z.string(),
  contact_phone: z.string().nullable(),
  contact_email: z.string().nullable(),
  dashboard_note: z.string().nullable(),
  created_at: wireInstant,
});

export type SafeStylistAccountWire = z.output<typeof safeStylistAccountSchema>;

export const safeCurrentUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  avatar_url: z.string().nullable().optional(),
  name: z.string(),
  role_id: z.enum(SystemRoleId),
  createdAt: wireInstant,
  updatedAt: wireInstant,
  is_active: z.boolean(),
  disabled_at: nullableInstant,
  deleted_at: nullableInstant,
  recovery_available: z.boolean(),
  account_type: z.enum(AccountTypeValue),
  notifications_enabled: z.boolean(),
  terms_accepted_at: nullableInstant,
  last_login_at: nullableInstant,
  moderation_strikes: z.number(),
  delete_confirm_version: z.number(),
  session: safeSessionSchema,
  stylist_account: safeStylistAccountSchema.nullable(),
  client_account: clientAccountSchema.nullable(),
});

export type SafeCurrentUserWire = z.output<typeof safeCurrentUserSchema>;

/** Logged-out get-current answers with no `data`. */
export const currentUserResponseSchema = z.union([
  safeCurrentUserSchema,
  z.undefined(),
]);
