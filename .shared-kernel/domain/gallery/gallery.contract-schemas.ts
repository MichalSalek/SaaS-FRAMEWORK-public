import { z } from 'zod';
import { wireInstant } from '../../application/contracts/wire-values';
import { TRAIT_CATEGORIES } from '../admin/traits.config';
import { NAIL_LENGTHS } from '../gallery/nail-length.config';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import { CONTENT_REPORT_REASONS } from '../../models/moderation/moderation.dto';
import {
  VALIDATION_GALLERY,
  VALIDATION_LENGTHS,
  VALIDATION_MODERATION,
  VALIDATION_PAGINATION,
} from '../../policies/validation.config';
import { isCloudinaryAssetUrl } from '../../policies/validation/validation.utils';

const V = VALIDATION_MESSAGES;

const traitIdsArray = z
  .array(
    z
      .string({ error: V.gallery.missingStyleTraits })
      .min(1, V.gallery.missingStyleTraits),
    { error: V.gallery.missingStyleTraits }
  )
  .min(1, V.gallery.missingStyleTraits)
  .max(VALIDATION_GALLERY.MAX_TRAIT_IDS, V.gallery.tooManyTraitIds);

const colorIdsArray = z
  .array(
    z
      .string({ error: V.gallery.missingColorTraits })
      .min(1, V.gallery.missingColorTraits),
    { error: V.gallery.missingColorTraits }
  )
  .min(1, V.gallery.missingColorTraits)
  .max(VALIDATION_GALLERY.MAX_COLOR_IDS, V.gallery.tooManyColorIds);

const nailLengthCreate = z.enum(NAIL_LENGTHS, {
  error: issue =>
    typeof issue.input === 'string' && issue.input.length > 0
      ? V.gallery.invalidNailLength
      : V.gallery.missingNailLength,
});

const nailLengthUpdate = z.enum(NAIL_LENGTHS, {
  error: issue =>
    typeof issue.input === 'string'
      ? V.gallery.invalidNailLength
      : V.gallery.missingNailLength,
});

export const createGalleryRecordSchema = z.object({
  asset_url: z
    .string({ error: V.gallery.missingPhoto })
    .min(1, V.gallery.missingPhoto)
    .max(VALIDATION_LENGTHS.ASSET_URL_MAX, V.gallery.invalidAssetUrl)
    .refine(isCloudinaryAssetUrl, V.gallery.invalidAssetUrl),
  color_ids: colorIdsArray,
  trait_ids: traitIdsArray,
  nail_length: nailLengthCreate,
});

export const getGalleryRecordsSchema = z.object({
  // DECISION: gallery_record_id + apply_strict_filter are the only schema/DTO drift in the validator
  // set: the manual validator initialised them in the error DTO but never checked them, although the
  // REQUEST DTO promises `apply_strict_filter: boolean` and `gallery_record_id?: string`. zod now
  // enforces the contract: a deliberate TIGHTENING (the frontend always sends boolean/string). The
  // color_ids/trait_ids elements are also tightened to `string` (was only `Array.isArray`) so that
  // `z.infer == string[]`.
  gallery_record_id: z.string({ error: V.gallery.invalidRecordId }).optional(),
  color_ids: z.array(z.string({ error: V.gallery.traitsRequired }), {
    error: V.gallery.traitsRequired,
  }),
  trait_ids: z.array(z.string({ error: V.gallery.traitsRequired }), {
    error: V.gallery.traitsRequired,
  }),
  apply_strict_filter: z.boolean({ error: V.general.booleanRequired }),
  cursor: z
    .string({ error: V.pagination.invalidCursor })
    .min(1, V.pagination.invalidCursor)
    .optional(),
  take: z
    .number({ error: V.pagination.invalidLimit })
    .min(VALIDATION_PAGINATION.LIMIT_MIN, V.pagination.invalidLimit)
    .max(VALIDATION_PAGINATION.LIMIT_MAX, V.pagination.invalidLimit)
    .optional(),
});

export const deleteAssetFromVendorSchema = z.object({
  asset_id: z
    .string({ error: V.gallery.missingAssetId })
    .min(1, V.gallery.missingAssetId),
});

export const updateGalleryRecordSchema = z.object({
  gallery_record_id: z
    .string({ error: V.gallery.invalidRecordId })
    .min(1, V.gallery.invalidRecordId),
  color_ids: colorIdsArray.optional(),
  trait_ids: traitIdsArray.optional(),
  nail_length: nailLengthUpdate.optional(),
});

export const deleteGalleryRecordSchema = z.object({
  gallery_record_id: z
    .string({ error: V.gallery.invalidRecordId })
    .min(1, V.gallery.invalidRecordId),
});

export const getGalleryRecordByIdSchema = z.object({
  gallery_record_id: z
    .string({ error: V.gallery.invalidRecordId })
    .min(1, V.gallery.invalidRecordId),
});

export const publicGetGalleryRecordsByAccountSchema = z.object({
  account_id: z
    .string({ error: V.account.invalidId })
    .min(1, V.account.invalidId),
  limit: z
    .number({ error: V.pagination.invalidLimit })
    .min(VALIDATION_PAGINATION.LIMIT_MIN, V.pagination.invalidLimit)
    .max(VALIDATION_PAGINATION.LIMIT_MAX, V.pagination.invalidLimit)
    .optional(),
  offset: z
    .number({ error: V.pagination.invalidOffset })
    .int(V.pagination.invalidOffset)
    .min(VALIDATION_PAGINATION.OFFSET_MIN, V.pagination.invalidOffset)
    .max(10_000_000, V.pagination.invalidOffset)
    .optional(),
  color_ids: z
    .array(z.string({ error: V.gallery.traitsRequired }), {
      error: V.gallery.traitsRequired,
    })
    .optional(),
  trait_ids: z
    .array(z.string({ error: V.gallery.traitsRequired }), {
      error: V.gallery.traitsRequired,
    })
    .optional(),
});

export const galleryGetForPairedClientSchema = z.object({
  stylist_account_id: z
    .string({ error: V.account.invalidId })
    .min(1, V.account.invalidId),
  limit: z
    .number({ error: V.pagination.invalidLimit })
    .min(VALIDATION_PAGINATION.LIMIT_MIN, V.pagination.invalidLimit)
    .max(VALIDATION_PAGINATION.LIMIT_MAX, V.pagination.invalidLimit)
    .optional(),
  offset: z
    .number({ error: V.pagination.invalidOffset })
    .int(V.pagination.invalidOffset)
    .min(VALIDATION_PAGINATION.OFFSET_MIN, V.pagination.invalidOffset)
    .max(10_000_000, V.pagination.invalidOffset)
    .optional(),
});

export const exploreGalleryRecordsSchema = z.object({
  color_ids: z
    .array(
      z
        .string({ error: V.gallery.traitsRequired })
        .min(1, V.gallery.traitsRequired),
      { error: V.gallery.traitsRequired }
    )
    .optional(),
  trait_ids: z
    .array(
      z
        .string({ error: V.gallery.traitsRequired })
        .min(1, V.gallery.traitsRequired),
      { error: V.gallery.traitsRequired }
    )
    .optional(),
  nail_length: z
    .enum(NAIL_LENGTHS, { error: V.gallery.invalidNailLength })
    .optional(),
  apply_strict_filter: z
    .boolean({ error: V.general.booleanRequired })
    .optional(),
  cursor: z
    .string({ error: V.pagination.invalidCursor })
    .min(1, V.pagination.invalidCursor)
    .optional(),
  take: z
    .number({ error: V.pagination.invalidLimit })
    .min(VALIDATION_PAGINATION.LIMIT_MIN, V.pagination.invalidLimit)
    .max(VALIDATION_PAGINATION.LIMIT_MAX_BROWSE, V.pagination.invalidLimit)
    .optional(),
  city: z
    .string({ error: V.search.invalidType })
    .max(VALIDATION_LENGTHS.CITY_FILTER_MAX, V.search.cityTooLong)
    .optional(),
  searchQuery: z
    .string({ error: V.search.invalidType })
    .max(VALIDATION_LENGTHS.SEARCH_QUERY_MAX, V.search.queryTooLong)
    .optional(),
});

export const reorderPinnedGalleryRecordsSchema = z.object({
  gallery_record_ids: z
    .array(
      z
        .string({ error: V.gallery.invalidRecordId })
        .min(1, V.gallery.invalidRecordId),
      { error: V.gallery.invalidRecordId }
    )
    .min(1, V.gallery.invalidRecordId)
    .max(VALIDATION_GALLERY.MAX_PINNED_REORDER_IDS, V.gallery.invalidRecordId)
    .refine(ids => new Set(ids).size === ids.length, V.gallery.invalidRecordId),
});

const reasonEnum = z.enum(CONTENT_REPORT_REASONS, {
  error: issue =>
    typeof issue.input === 'string' && issue.input.length > 0
      ? V.moderation.reasonInvalid
      : V.moderation.reasonRequired,
});

const optionalCappedText = (maxLen: number, key: string) =>
  z
    .preprocess(
      value => (value === null ? undefined : value),
      z.string({ error: key }).max(maxLen, key).optional()
    )
    .optional();

/** Same object the moderation validator parses. Parent rewires that file to this export. */
export const reportGalleryRecordSchema = z.object({
  gallery_record_id: z
    .string({ error: V.moderation.galleryRecordIdRequired })
    .min(1, V.moderation.galleryRecordIdRequired),
  reason: reasonEnum,
  description: optionalCappedText(
    VALIDATION_MODERATION.DESCRIPTION_MAX,
    V.moderation.descriptionTooLong
  ),
});

const nailLength = z.enum(NAIL_LENGTHS);
const traitCategory = z.enum(TRAIT_CATEGORIES);

const colorSchema = z.object({
  id: z.string(),
  name: z.string(),
  hex_code: z.string(),
});

const traitSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: traitCategory,
  icon_url: z.string().nullable(),
  is_featured: z.boolean(),
});

const stylistCardSchema = z.object({
  account_id: z.string(),
  display_name: z.string().nullable(),
  business_name: z.string().nullable(),
  address_city: z.string().nullable(),
});

const galleryRecordSchema = z.object({
  gallery_record_id: z.string(),
  asset_url: z.string(),
  nail_length: nailLength,
  colors: z.array(colorSchema),
  traits: z.array(traitSchema),
  created_at: wireInstant,
});

export const galleryRecordCreatedSchema = z.object({
  gallery_record_id: z.string(),
});

export const galleryRecordsPageSchema = z.object({
  records: z.array(galleryRecordSchema.extend({ is_pinned: z.boolean() })),
  nextCursor: z.string().nullable(),
});

export const deleteAssetFromVendorResponseSchema = z.undefined();

export const galleryRecordUpdatedSchema = z.object({
  gallery_record_id: z.string(),
  nail_length: nailLength,
  colors: z.array(colorSchema),
  traits: z.array(traitSchema),
});

export const galleryRecordDeletedSchema = z.object({
  success: z.boolean(),
  gallery_record_id: z.string(),
});

export const galleryRecordDetailSchema = z.object({
  gallery_record: galleryRecordSchema,
  stylist_info: stylistCardSchema,
  is_favorited: z.boolean(),
  is_pinned: z.boolean(),
});

export const publicGalleryPageSchema = z.object({
  records: z.array(galleryRecordSchema),
  total_count: z.number(),
  show_watermark: z.boolean(),
  stylist_info: stylistCardSchema.extend({
    brand_accent_color: z.string().nullable(),
  }),
});

export const galleryPinResponseSchema = z.object({
  success: z.boolean(),
  pinned_count: z.number(),
});

export const galleryColorsSchema = z.array(colorSchema);

export const galleryTraitsSchema = z.array(traitSchema);

export const sitemapProfilesSchema = z.object({
  profiles: z.array(
    z.object({
      identifier: z.string(),
      path: z.string().optional(),
      updated_at: z.string(),
    })
  ),
});

export const pairedGalleryPageSchema = z.object({
  records: z.array(galleryRecordSchema.extend({ is_pinned: z.boolean() })),
  total_count: z.number(),
  stylist_info: stylistCardSchema.extend({
    brand_accent_color: z.string().nullable(),
  }),
});

export const exploreGalleryPageSchema = z.object({
  records: z.array(
    galleryRecordSchema.extend({
      is_pinned: z.boolean(),
      like_count: z.number(),
      is_favorited: z.boolean(),
      show_watermark: z.boolean(),
      created_by_account: z.object({
        account_id: z.string(),
        display_name: z.string().nullable(),
        vanity_url: z.string().nullable(),
        address_city: z.string().nullable(),
      }),
    })
  ),
  nextCursor: z.string().nullable(),
});

export const galleryPinnedOrderSchema = z.object({
  success: z.boolean(),
  gallery_record_ids: z.array(z.string()),
});

export const galleryPinnedRecordsSchema = z.object({
  records: z.array(
    z.object({
      gallery_record_id: z.string(),
      asset_url: z.string(),
    })
  ),
});

export const contentReportCreatedSchema = z.object({
  report_id: z.string(),
});
