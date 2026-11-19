import type { z } from 'zod';
import type { GALLERY_DTO_API_V1 } from '../../models/gallery/gallery.dto';
import {
  createGalleryRecordSchema,
  deleteAssetFromVendorSchema,
  deleteGalleryRecordSchema,
  exploreGalleryRecordsSchema,
  galleryGetForPairedClientSchema,
  getGalleryRecordByIdSchema,
  getGalleryRecordsSchema,
  publicGetGalleryRecordsByAccountSchema,
  reorderPinnedGalleryRecordsSchema,
  updateGalleryRecordSchema,
} from '../../domain/gallery/gallery.contract-schemas';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';
import { NO_VALIDATION } from './validation.types';

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
  reorderPinnedGalleryRecords: (data: unknown) =>
    zodValidate(reorderPinnedGalleryRecordsSchema, data),
  getPinnedGalleryRecords: NO_VALIDATION,
} as const;

export type GalleryRequestSchemaBindings = {
  createGalleryRecord: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof createGalleryRecordSchema>,
      GALLERY_DTO_API_V1['CREATE_GALLERY_RECORD']['REQUEST']
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
  reorderPinnedGalleryRecords: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof reorderPinnedGalleryRecordsSchema>,
      GALLERY_DTO_API_V1['GALLERY_REORDER_PINNED_RECORDS']['REQUEST']
    >
  >;
};
