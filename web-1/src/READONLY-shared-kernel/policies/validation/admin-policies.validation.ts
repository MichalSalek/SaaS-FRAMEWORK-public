import type { z } from 'zod';
import {
  adminDeletePolicySchema,
  adminSavePolicySchema,
  adminSetMainPolicySchema,
} from '../../domain/admin/admin.contract-schemas';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

export const adminPoliciesValidators = {
  adminSavePolicy: (data: unknown) => zodValidate(adminSavePolicySchema, data),
  adminDeletePolicy: (data: unknown) =>
    zodValidate(adminDeletePolicySchema, data),
  adminSetMainPolicy: (data: unknown) =>
    zodValidate(adminSetMainPolicySchema, data),
} as const;

export type AdminPoliciesRequestSchemaBindings = {
  adminSavePolicy: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminSavePolicySchema>,
      ADMIN_DTO_API_V1['ADMIN_SAVE_POLICY']['REQUEST']
    >
  >;
  adminDeletePolicy: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminDeletePolicySchema>,
      ADMIN_DTO_API_V1['ADMIN_DELETE_POLICY']['REQUEST']
    >
  >;
  adminSetMainPolicy: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminSetMainPolicySchema>,
      ADMIN_DTO_API_V1['ADMIN_SET_MAIN_POLICY']['REQUEST']
    >
  >;
};
