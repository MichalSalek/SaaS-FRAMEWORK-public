import type { z } from 'zod';
import {
  adminCreateColorSchema,
  adminCreateTraitSchema,
  adminDeleteColorSchema,
  adminDeleteTraitSchema,
  adminUpdateColorSchema,
  adminUpdateTraitSchema,
} from '../../domain/admin/admin.contract-schemas';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import { NO_VALIDATION } from './validation.types';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

export const adminTraitsValidators = {
  getColors: NO_VALIDATION,
  getTraits: NO_VALIDATION,
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
