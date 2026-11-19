import type { z } from 'zod';
import { adminUpdatePermissionsSchema } from '../../domain/admin/admin.contract-schemas';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

export const adminRbacValidators = {
  adminUpdatePermissions: (data: unknown) =>
    zodValidate(adminUpdatePermissionsSchema, data),
} as const;

export type AdminRbacRequestSchemaBindings = {
  adminUpdatePermissions: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminUpdatePermissionsSchema>,
      ADMIN_DTO_API_V1['ADMIN_UPDATE_PERMISSIONS']['REQUEST']
    >
  >;
};
