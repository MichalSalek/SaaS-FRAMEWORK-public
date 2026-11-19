import type { z } from 'zod';
import { adminToggleFeatureFlagSchema } from '../../domain/admin/admin.contract-schemas';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

export const adminFeatureFlagsValidators = {
  adminToggleFeatureFlag: (data: unknown) =>
    zodValidate(adminToggleFeatureFlagSchema, data),
} as const;

export type AdminFeatureFlagsRequestSchemaBindings = {
  adminToggleFeatureFlag: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminToggleFeatureFlagSchema>,
      ADMIN_DTO_API_V1['ADMIN_TOGGLE_FEATURE_FLAG']['REQUEST']
    >
  >;
};
