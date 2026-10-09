import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import { NAIL_LENGTHS } from '../../domain/gallery/nail-length.config';
import type { GALLERY_DTO_API_V1 } from '../../models/gallery/gallery.dto';
import {
  VALIDATION_PAGINATION,
  VALIDATION_LENGTHS,
  VALIDATION_GALLERY,
} from '../validation.config';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';
import { isCloudinaryAssetUrl } from './validation.utils';

const V = VALIDATION_MESSAGES;

// Shared field schemas (kept inline-simple; rule-of-three not yet reached across domains).
const traitIdsArray = z
  .array(
    z
      .string({ error: V.gallery.missingStyleTraits })
      .min(1, V.gallery.missingStyleTraits),
    {
      error: V.gallery.missingStyleTraits,
    }
  )
  .min(1, V.gallery.missingStyleTraits)
  .max(VALIDATION_GALLERY.MAX_TRAIT_IDS, V.gallery.tooManyTraitIds);

const colorIdsArray = z
  .array(
    z
      .string({ error: V.gallery.missingColorTraits })
      .min(1, V.gallery.missingColorTraits),
    {
      error: V.gallery.missingColorTraits,
    }
  )
  .min(1, V.gallery.missingColorTraits)
  .max(VALIDATION_GALLERY.MAX_COLOR_IDS, V.gallery.tooManyColorIds);

// nail_length where the original distinguishes "missing" from "invalid value".
// create: falsy (incl. '') or non-string → missing; non-empty string not in set → invalid.
const nailLengthCreate = z.enum(NAIL_LENGTHS, {
  error: issue =>
    typeof issue.input === 'string' && issue.input.length > 0
      ? V.gallery.invalidNailLength
      : V.gallery.missingNailLength,
});
// update (partial): non-string → missing; any string not in set (incl. '') → invalid.
const nailLengthUpdate = z.enum(NAIL_LENGTHS, {
  error: issue =>
    typeof issue.input === 'string'
      ? V.gallery.invalidNailLength
      : V.gallery.missingNailLength,
});

const createGalleryRecordSchema = z.object({
  asset_url: z
    .string({ error: V.gallery.missingPhoto })
    .min(1, V.gallery.missingPhoto)
    // Parytet ze zdjęciami wizyt — ta sama powierzchnia, ta sama granica.
    .max(VALIDATION_LENGTHS.ASSET_URL_MAX, V.gallery.invalidAssetUrl)
    .refine(isCloudinaryAssetUrl, V.gallery.invalidAssetUrl),
  color_ids: colorIdsArray,
  trait_ids: traitIdsArray,
  nail_length: nailLengthCreate,
});

const getGalleryRecordsSchema = z.object({
  // DECISION (nie usuwaj tego komentarza):
  // gallery_record_id + apply_strict_filter to JEDYNY drift schema↔DTO w całym zbiorze
  // walidatorów (audyt FWE Wave H FAZA 2): ręczny walidator inicjalizował te pola w
  // error-DTO, ale NIGDY ich nie sprawdzał (cicho akceptował cokolwiek), choć REQUEST DTO
  // obiecuje `apply_strict_filter: boolean` i `gallery_record_id?: string`. zod wymusza
  // teraz zgodność runtime z kontraktem — to świadome ZACIEŚNIENIE (frontend zawsze wysyła
  // boolean/string; testy charakteryzacyjne zielone). Element color_ids/trait_ids też
  // zacieśniony do `string` (był tylko `Array.isArray`) by związać `z.infer == string[]`.
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

const deleteAssetFromVendorSchema = z.object({
  asset_id: z
    .string({ error: V.gallery.missingAssetId })
    .min(1, V.gallery.missingAssetId),
});

const updateGalleryRecordSchema = z.object({
  gallery_record_id: z
    .string({ error: V.gallery.invalidRecordId })
    .min(1, V.gallery.invalidRecordId),
  color_ids: colorIdsArray.optional(),
  trait_ids: traitIdsArray.optional(),
  nail_length: nailLengthUpdate.optional(),
});

const deleteGalleryRecordSchema = z.object({
  gallery_record_id: z
    .string({ error: V.gallery.invalidRecordId })
    .min(1, V.gallery.invalidRecordId),
});

const getGalleryRecordByIdSchema = z.object({
  gallery_record_id: z
    .string({ error: V.gallery.invalidRecordId })
    .min(1, V.gallery.invalidRecordId),
});

const publicGetGalleryRecordsByAccountSchema = z.object({
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
    // CLASS A schema-mirror: bound matches the live GET-handler clamp (clampOffset →
    // PAGINATION_CEILING = 10_000_000 in the HTTP query-params util). A float / past-ceiling
    // offset reached Prisma and overflowed Postgres OFFSET into a 500; the schema now
    // rejects it at the boundary with the EXISTING invalidOffset token (no new i18n key).
    // Literal (not the app-layer const): the kernel is upstream of the application layer and
    // cannot import it — same mirror-by-literal pattern as moderation-reports-list.
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

const galleryGetForPairedClientSchema = z.object({
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
    // CLASS A schema-mirror: see publicGetGalleryRecordsByAccountSchema.offset above —
    // bound matches the live GET-handler clampOffset (PAGINATION_CEILING = 10_000_000),
    // reusing the existing invalidOffset token; literal mirror (kernel cannot import that layer).
    .max(10_000_000, V.pagination.invalidOffset)
    .optional(),
});

const exploreGalleryRecordsSchema = z.object({
  color_ids: z
    .array(
      z
        .string({ error: V.gallery.traitsRequired })
        .min(1, V.gallery.traitsRequired),
      {
        error: V.gallery.traitsRequired,
      }
    )
    .optional(),
  trait_ids: z
    .array(
      z
        .string({ error: V.gallery.traitsRequired })
        .min(1, V.gallery.traitsRequired),
      {
        error: V.gallery.traitsRequired,
      }
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

export const galleryValidators = {
  createGalleryRecord: (data: unknown) =>
    zodValidate(createGalleryRecordSchema, data),
  getGalleryRecords: (data: unknown) =>
    zodValidate(getGalleryRecordsSchema, data),
  deleteAssetFromVendor: (data: unknown) =>
    zodValidate(deleteAssetFromVendorSchema, data),
  updateGalleryRecord: (data: unknown) =>
    zodValidate(updateGalleryRecordSchema, data),
  deleteGalleryRecord: (data: unknown) =>
    zodValidate(deleteGalleryRecordSchema, data),
  getGalleryRecordById: (data: unknown) =>
    zodValidate(getGalleryRecordByIdSchema, data),
  publicGetGalleryRecordsByAccount: (data: unknown) =>
    zodValidate(publicGetGalleryRecordsByAccountSchema, data),
  galleryGetForPairedClient: (data: unknown) =>
    zodValidate(galleryGetForPairedClientSchema, data),
  exploreGalleryRecords: (data: unknown) =>
    zodValidate(exploreGalleryRecordsSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
export type GalleryRequestSchemaBindings = {
  createGalleryRecord: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof createGalleryRecordSchema>,
      GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST']
    >
  >;
  getGalleryRecords: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof getGalleryRecordsSchema>,
      GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['REQUEST']
    >
  >;
  deleteAssetFromVendor: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof deleteAssetFromVendorSchema>,
      GALLERY_DTO_API_V1['DELETE_ASSET_FROM_VENDOR']['REQUEST']
    >
  >;
  updateGalleryRecord: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof updateGalleryRecordSchema>,
      GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['REQUEST']
    >
  >;
  deleteGalleryRecord: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof deleteGalleryRecordSchema>,
      GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['REQUEST']
    >
  >;
  getGalleryRecordById: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof getGalleryRecordByIdSchema>,
      GALLERY_DTO_API_V1['GET_GALLERY_RECORD_BY_ID']['REQUEST']
    >
  >;
  publicGetGalleryRecordsByAccount: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof publicGetGalleryRecordsByAccountSchema>,
      GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['REQUEST']
    >
  >;
  galleryGetForPairedClient: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof galleryGetForPairedClientSchema>,
      GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['REQUEST']
    >
  >;
  exploreGalleryRecords: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof exploreGalleryRecordsSchema>,
      GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['REQUEST']
    >
  >;
};
