import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import { PricingPlanValue } from '../pricing/pricing.config';
import { AccountTypeValue } from '../../models/db_models.generated.dto';
import {
  BILLING_CURRENCIES,
  COUNTRY_CODES,
} from '../localization/country.config';
import {
  VALIDATION_GEO,
  VALIDATION_LENGTHS,
  VALIDATION_REGEX,
} from '../../policies/validation.config';
import {
  isCloudinaryAssetUrl,
  isValidNip,
} from '../../policies/validation/validation.utils';

const V = VALIDATION_MESSAGES;

/** Command with no fields. A missing body parses as {}. Unknown keys are stripped. */
export const emptyCommandBody = z.object({});

export const emptyResponse = z.undefined();

export const accountDisplayNameChangeSchema = z.object({
  display_name: z
    .string({ error: V.displayName.required })
    .min(VALIDATION_LENGTHS.DISPLAY_NAME_MIN, V.displayName.tooShort)
    .max(VALIDATION_LENGTHS.DISPLAY_NAME_MAX, V.displayName.tooLong),
});

export const accountGetStylistsWithLocationSchema = z.object({
  latitude: z
    .number({ error: V.location.invalidLatitude })
    .min(VALIDATION_GEO.LATITUDE_MIN, V.location.invalidLatitude)
    .max(VALIDATION_GEO.LATITUDE_MAX, V.location.invalidLatitude)
    .optional(),
  longitude: z
    .number({ error: V.location.invalidLongitude })
    .min(VALIDATION_GEO.LONGITUDE_MIN, V.location.invalidLongitude)
    .max(VALIDATION_GEO.LONGITUDE_MAX, V.location.invalidLongitude)
    .optional(),
  radius_km: z
    .number({ error: V.location.invalidRadius })
    .gt(0, V.location.invalidRadius)
    .max(VALIDATION_GEO.RADIUS_KM_MAX, V.location.invalidRadius)
    .optional(),
});

export const accountSetAvatarSchema = z.object({
  avatar_url: z
    .string({ error: V.account.avatarUrlInvalid })
    .min(1, V.account.avatarUrlInvalid)
    .max(VALIDATION_LENGTHS.ASSET_URL_MAX, V.account.avatarUrlInvalid)
    .refine(isCloudinaryAssetUrl, V.account.avatarUrlInvalid)
    .nullable(),
});

export const accountIncrementViewSchema = z.object({
  stylist_account_id: z
    .string({ error: V.account.invalidId })
    .min(1, V.account.invalidId),
});

export const accountSetDashboardNoteSchema = z.object({
  note: z
    .string({ error: V.general.fieldRequired })
    .max(VALIDATION_LENGTHS.DASHBOARD_NOTE_MAX, V.dashboardNote.tooLong)
    .nullable(),
  account_type: z.enum(AccountTypeValue, {
    error: V.dashboardNote.invalidAccountType,
  }),
});

// DECISION: `.trim()` comes BEFORE `.min()` on the text fields. Otherwise a whitespace-only
// company name passed the length check and a VAT identity was saved without a buyer name.
// Postal code and NIP need no trim: the regex rejects whitespace and isValidNip normalises.
export const vatInvoiceDetailsSchema = z
  .object({
    companyName: z
      .string({ error: V.vatInvoice.companyNameRequired })
      .trim()
      .min(
        VALIDATION_LENGTHS.VAT_COMPANY_NAME_MIN,
        V.vatInvoice.companyNameRequired
      )
      .max(
        VALIDATION_LENGTHS.VAT_COMPANY_NAME_MAX,
        V.vatInvoice.companyNameTooLong
      ),
    nip: z
      .string({ error: V.vatInvoice.nipInvalid })
      .refine(value => isValidNip(value), V.vatInvoice.nipInvalid)
      .optional(),
    country: z.enum(COUNTRY_CODES).optional(),
    taxId: z
      .object({
        type: z.string().min(1).max(50),
        value: z.string().trim().min(1).max(80),
      })
      .nullable()
      .optional(),
    addressLine1: z
      .string({ error: V.vatInvoice.addressLineRequired })
      .trim()
      .min(
        VALIDATION_LENGTHS.VAT_ADDRESS_LINE_MIN,
        V.vatInvoice.addressLineRequired
      )
      .max(
        VALIDATION_LENGTHS.VAT_ADDRESS_LINE_MAX,
        V.vatInvoice.addressLineTooLong
      ),
    addressLine2: z
      .string()
      .trim()
      .max(VALIDATION_LENGTHS.VAT_ADDRESS_LINE_MAX)
      .optional(),
    addressCity: z
      .string({ error: V.vatInvoice.cityRequired })
      .trim()
      .max(VALIDATION_LENGTHS.CITY_MAX, V.vatInvoice.cityTooLong),
    addressPostalCode: z
      .string({ error: V.vatInvoice.postalCodeInvalid })
      .trim()
      .max(32, V.vatInvoice.postalCodeInvalid),
    addressState: z.string().trim().max(100).optional(),
  })
  .superRefine((data, ctx) => {
    if (
      (data.country ?? 'PL') === 'PL' &&
      data.addressCity.length < VALIDATION_LENGTHS.CITY_MIN
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['addressCity'],
        message: V.vatInvoice.cityRequired,
      });
    }
    if (
      (data.country ?? 'PL') === 'PL' &&
      !VALIDATION_REGEX.POSTAL_CODE_PL.test(data.addressPostalCode)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['addressPostalCode'],
        message: V.vatInvoice.postalCodeInvalid,
      });
    }
    if (
      data.nip !== undefined &&
      ((data.country ?? 'PL') !== 'PL' || data.taxId !== undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['nip'],
        message: V.vatInvoice.nipInvalid,
      });
    }
  });

export const checkoutSessionSchema = z.object({
  expectedTrialDays: z.number().int().nonnegative().optional(),
  planId: z.enum(PricingPlanValue, { error: V.payment.invalidPlan }),
  billingPeriod: z.enum(['month', 'year'], {
    error: V.payment.invalidBillingPeriod,
  }),
  currency: z.enum(BILLING_CURRENCIES).optional(),
  billingCountry: z.enum(COUNTRY_CODES).optional(),
  source: z
    .string()
    .max(VALIDATION_LENGTHS.CHECKOUT_SOURCE_MAX, V.payment.invalidSource)
    .optional(),
  promo: z
    .string()
    .trim()
    .max(VALIDATION_LENGTHS.CHECKOUT_PROMO_MAX, V.payment.invalidPromo)
    .regex(/^[A-Za-z0-9-]+$/, V.payment.invalidPromo)
    .optional(),
});

export const planChangeSchema = z.object({
  targetPlanId: z.enum(PricingPlanValue, { error: V.payment.invalidPlan }),
  billingPeriod: z.enum(['month', 'year'], {
    error: V.payment.invalidBillingPeriod,
  }),
  quoteId: z.string().uuid().optional(),
});

export const planChangePreviewResponseSchema = z.object({
  quoteId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  amountDue: z.number().int().nonnegative(),
  total: z.number().int(),
  taxAmount: z.number().int().nullable(),
  currency: z.string(),
  billingPeriod: z.enum(['month', 'year']),
  trialEndsAt: z.string().datetime().nullable(),
  cancelAt: z.string().datetime().nullable(),
  regularAmount: z.number().int().nonnegative().nullable().optional(),
  nextBillingAt: z.string().datetime().nullable().optional(),
});

export const stripePortalSchema = z.object({
  purpose: z
    .enum(['manage', 'cancel'], { error: V.payment.invalidSource })
    .optional(),
  locale: z
    .enum(['pl', 'en', 'de'], { error: V.payment.invalidSource })
    .optional(),
});

export {
  UPDATE_STYLIST_PROFILE_ERROR_SLOTS,
  updateStylistProfileSchema,
} from './account-profile.contract-schemas';

export {
  stylistAccountRowSchema,
  stylistsWithLocationSchema,
  stylistProfileUpdatedSchema,
  avatarSetSchema,
  galleryStrengthDismissedSchema,
  publicProfileSchema,
  resolvedProfileLinkSchema,
  portalUrlSchema,
  checkoutSessionResponseSchema,
  planChangeResponseSchema,
  vatInvoiceSavedSchema,
  viewCountSchema,
  dashboardNoteSetSchema,
  dashboardNoteReadSchema,
  dashboardFeedSchema,
  privateNotesSchema,
} from './account-response.contract-schemas';
