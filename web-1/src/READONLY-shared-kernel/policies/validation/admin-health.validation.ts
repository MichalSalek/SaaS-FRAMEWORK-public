import type { z } from 'zod';
import {
  adminCheckAccessUrlSchema,
  adminDebugModeSchema,
} from '../../domain/admin/admin.contract-schemas';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

export const adminHealthValidators = {
  adminDebugMode: (data: unknown) => zodValidate(adminDebugModeSchema, data),
  adminCheckAccessUrl: (data: unknown) =>
    zodValidate(adminCheckAccessUrlSchema, data),
} as const;

// DECISION: binds to `{ url?: string }`, not DTO CHECK_ACCESS REQUEST (that one is
// `undefined`). The URL handler's body is this inline shape. See the schema file.
export type AdminHealthRequestSchemaBindings = {
  adminCheckAccessUrl: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminCheckAccessUrlSchema>,
      { url?: string }
    >
  >;
  adminDebugMode: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminDebugModeSchema>,
      ADMIN_DTO_API_V1['SWITCH_BACKEND_DEBUG_MODE']['REQUEST']
    >
  >;
};
