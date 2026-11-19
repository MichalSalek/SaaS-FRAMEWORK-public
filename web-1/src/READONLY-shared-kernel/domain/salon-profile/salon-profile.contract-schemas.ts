import { z } from 'zod';
import type { SalonProfileData } from '../../models/salon-profile/salon-profile.dto';
import { wireInstant } from '../../application/contracts/wire-values';
import { COUNTRY_CODES } from '../localization/country.config';
import { NAIL_LENGTHS } from '../gallery/nail-length.config';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import { isBrandAccentHex } from '../user-and-account/branding.config';
import { vanityUrlSchema } from '../user-and-account/vanity-url.config';
import { messageContent } from '../messaging/messaging.contract-schemas';
import {
  isValidPhoneNumber,
  VALIDATION_LENGTHS,
  VALIDATION_REGEX,
  VALIDATION_SOCIAL,
} from '../../policies/validation.config';
import { validateOptionalHttpsUrl } from '../../policies/validation/validation.utils';
import {
  EXTERNAL_LINK_LIMIT,
  isValidExternalLink,
} from '../user-and-account/external-links.config';

const V = VALIDATION_MESSAGES;

export const salonProfileUpdateSchema = z
  .object({
    salon_vanity_url: vanityUrlSchema.nullable().optional(),
    name: z
      .string({ error: V.general.fieldRequired })
      .trim()
      .min(1, V.general.fieldRequired)
      .max(100, V.name.tooLong)
      .optional(),
    brand_accent_color: z
      .string({ error: V.general.fieldRequired })
      .refine(isBrandAccentHex, V.name.invalid)
      .nullable()
      .optional(),
    contact: z
      .object({
        address_country: z.enum(COUNTRY_CODES).nullable().optional(),
        address_city: z
          .string()
          .trim()
          .max(VALIDATION_LENGTHS.CITY_MAX, V.address.cityTooLong)
          .nullable()
          .optional(),
        address_street: z
          .string()
          .trim()
          .max(VALIDATION_LENGTHS.STREET_MAX, V.location.streetTooLong)
          .nullable()
          .optional(),
        website: z
          .string()
          .trim()
          .refine(
            value =>
              validateOptionalHttpsUrl(value, VALIDATION_LENGTHS.WEBSITE_MAX),
            V.location.websiteInvalid
          )
          .nullable()
          .optional(),
        instagram_handle: z
          .string()
          .trim()
          .max(
            VALIDATION_SOCIAL.INSTAGRAM_HANDLE_MAX,
            V.social.instagramTooLong
          )
          .refine(
            value => !value || VALIDATION_REGEX.INSTAGRAM_HANDLE.test(value),
            V.social.instagramInvalidChars
          )
          .nullable()
          .optional(),
        external_links: z
          .array(
            z.string().refine(isValidExternalLink, V.location.websiteInvalid)
          )
          .max(EXTERNAL_LINK_LIMIT, V.externalLinks.tooMany)
          .nullable()
          .optional(),
        phone: z
          .string()
          .trim()
          .max(VALIDATION_LENGTHS.PHONE_FIELD_MAX, V.location.phoneTooLong)
          .refine(
            value => !value || isValidPhoneNumber(value),
            V.phone.invalidFormat
          )
          .nullable()
          .optional(),
      })
      .superRefine((contact, ctx) => {
        const street = contact.address_street?.trim() ?? '';
        const city = contact.address_city?.trim() ?? '';
        if (
          contact.address_street !== undefined &&
          contact.address_city !== undefined &&
          street.length > 0 &&
          city.length < VALIDATION_LENGTHS.CITY_MIN
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['address_city'],
            message: V.location.cityRequired,
          });
        }
      })
      .optional(),
    show_team: z.boolean({ error: V.general.booleanRequired }).optional(),
    pinned_record_ids: z
      .array(
        z
          .string({ error: V.general.fieldRequired })
          .min(1, V.general.fieldRequired),
        { error: V.general.fieldRequired }
      )
      .max(100, V.name.tooLong)
      .refine(ids => new Set(ids).size === ids.length, V.name.invalid)
      .optional(),
  })
  .refine(
    value =>
      value.name !== undefined ||
      value.brand_accent_color !== undefined ||
      value.show_team !== undefined ||
      value.pinned_record_ids !== undefined ||
      value.salon_vanity_url !== undefined ||
      Object.keys(value.contact ?? {}).length > 0,
    { message: V.general.fieldRequired }
  );

export const salonProfileVisibilitySchema = z.object({
  visible: z.boolean({ error: V.general.booleanRequired }),
});

export const salonSlugAvailabilitySchema = z.object({ slug: vanityUrlSchema });

export const salonProfileContactSchema = z.object({
  content: messageContent,
  stylist_account_id: z
    .string({ error: V.general.fieldRequired })
    .min(1, V.general.fieldRequired)
    .max(100, V.name.tooLong),
});

export const salonGallerySchema = z.object({
  salon_account_id: z
    .string({ error: V.general.fieldRequired })
    .min(1, V.general.fieldRequired)
    .max(100, V.name.tooLong),
  stylist_account_id: z
    .string({ error: V.general.fieldRequired })
    .min(1, V.general.fieldRequired)
    .max(100, V.name.tooLong)
    .optional(),
  cursor: z
    .string({ error: V.general.fieldRequired })
    .max(300, V.name.tooLong)
    .optional(),
  take: z.coerce
    .number({ error: V.name.invalid })
    .int(V.name.invalid)
    .min(1, V.name.invalid)
    .max(50, V.name.invalid)
    .optional(),
  color_ids: z
    .array(
      z
        .string({ error: V.general.fieldRequired })
        .min(1, V.general.fieldRequired)
        .max(100, V.name.tooLong),
      { error: V.name.invalid }
    )
    .max(20, V.name.tooLong)
    .optional(),
  trait_ids: z
    .array(
      z
        .string({ error: V.general.fieldRequired })
        .min(1, V.general.fieldRequired)
        .max(100, V.name.tooLong),
      { error: V.name.invalid }
    )
    .max(20, V.name.tooLong)
    .optional(),
  nail_length: z.enum(NAIL_LENGTHS, { error: V.name.invalid }).optional(),
});

const personSchema = z.object({
  account_id: z.string(),
  name: z.string(),
  avatar_url: z.string().nullable(),
  avatar_fallback_url: z.string().nullable().optional(),
  identifier: z.string(),
});

/** Rebuilds the profile so an absent author is omitted, which exactOptional accepts. */
export const salonProfileResponse = (data: SalonProfileData) => ({
  logo_url: data.logo_url ?? null,
  account_id: data.account_id,
  name: data.name,
  brand_accent_color: data.brand_accent_color,
  show_team: data.show_team,
  owner: data.owner,
  members: data.members,
  contact: {
    address_country: data.contact.address_country ?? null,
    address_city: data.contact.address_city,
    address_street: data.contact.address_street ?? null,
    website: data.contact.website,
    instagram_handle: data.contact.instagram_handle,
    ...(data.contact.phone !== undefined && { phone: data.contact.phone }),
  },
  works: data.works.map(work =>
    work.author === undefined
      ? {
          gallery_record_id: work.gallery_record_id,
          asset_url: work.asset_url,
        }
      : {
          gallery_record_id: work.gallery_record_id,
          asset_url: work.asset_url,
          author: work.author,
        }
  ),
  ...(data.is_active !== undefined && { is_active: data.is_active }),
  ...(data.name_configured !== undefined && {
    name_configured: data.name_configured,
  }),
  ...(data.salon_vanity_url !== undefined && {
    salon_vanity_url: data.salon_vanity_url,
  }),
  ...(data.suggested_slug !== undefined && {
    suggested_slug: data.suggested_slug,
  }),
});

export const salonProfileDataSchema = z.object({
  logo_url: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  name_configured: z.boolean().optional(),
  salon_vanity_url: z.string().nullable().optional(),
  suggested_slug: z.string().nullable().optional(),
  account_id: z.string(),
  name: z.string(),
  brand_accent_color: z.string().nullable(),
  effective_pricing_plan: z.string().nullable().optional(),
  show_team: z.boolean(),
  owner: personSchema,
  members: z.array(personSchema),
  works: z.array(
    z.object({
      gallery_record_id: z.string(),
      asset_url: z.string(),
      author: personSchema.optional(),
    })
  ),
  contact: z.object({
    address_country: z.string().nullable().optional(),
    address_city: z.string().nullable(),
    address_street: z.string().nullable(),
    website: z.string().nullable(),
    instagram_handle: z.string().nullable(),
    external_links: z.array(z.string()).max(EXTERNAL_LINK_LIMIT).optional(),
    phone: z.string().nullable().optional(),
  }),
});

export const salonProfileVisibilityResponseSchema = z.object({
  visible: z.boolean().nullable(),
});

export const salonProfileVisibilityUpdatedSchema = z.object({
  visible: z.boolean(),
});

export const salonSlugAvailabilityResponseSchema = z.object({
  available: z.boolean(),
});

export const salonProfileContactResponseSchema = z.object({
  pair_id: z.string(),
});

const galleryWorkSchema = z.object({
  gallery_record_id: z.string(),
  asset_url: z.string(),
  nail_length: z.enum(NAIL_LENGTHS),
  colors: z.array(
    z.object({ id: z.string(), name: z.string(), hex_code: z.string() })
  ),
  traits: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.enum(['technique', 'finish', 'decoration', 'style']),
      icon_url: z.string().nullable(),
      is_featured: z.boolean(),
    })
  ),
  created_at: wireInstant,
  author: personSchema,
  is_showcase: z.boolean(),
});

export const salonGalleryPageSchema = z.object({
  salon_account_id: z.string(),
  name: z.string(),
  contributors: z.array(personSchema),
  records: z.array(galleryWorkSchema),
  nextCursor: z.string().nullable(),
});
