import type { z } from 'zod';
import { adminUpdateConfigSchema } from '../../domain/admin/admin.contract-schemas';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import { NO_VALIDATION } from './validation.types';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

export const adminRuntimeConfigValidators = {
  adminGetConfigs: NO_VALIDATION,
  adminUpdateConfig: (data: unknown) =>
    zodValidate(adminUpdateConfigSchema, data),
} as const;

export type AdminRuntimeConfigRequestSchemaBindings = {
  adminUpdateConfig: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminUpdateConfigSchema>,
      ADMIN_DTO_API_V1['ADMIN_UPDATE_CONFIG']['REQUEST']
    >
  >;
};
