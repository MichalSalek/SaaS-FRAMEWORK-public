import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// permission_ids: an empty array is VALID (revokes all permissions from a custom
// role), but every element must be a non-empty string so it never reaches createMany
// and surfaces as an unhandled 500 instead of a clean 400. Mirrors the original
// element-type guard (typeof !== 'string' || id.length === 0 → reject). No `.min(1)`
// on the array itself — empty is allowed by design.
const adminUpdatePermissionsSchema = z.object({
  role_id: z
    .string({ error: V.permissions.roleIdRequired })
    .min(1, V.permissions.roleIdRequired),
  permission_ids: z.array(
    z
      .string({ error: V.permissions.permissionIdsRequired })
      .min(1, V.permissions.permissionIdsRequired),
    { error: V.permissions.permissionIdsRequired }
  ),
});

export const adminRbacValidators = {
  adminUpdatePermissions: (data: unknown) =>
    zodValidate(adminUpdatePermissionsSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
export type AdminRbacRequestSchemaBindings = {
  adminUpdatePermissions: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminUpdatePermissionsSchema>,
      ADMIN_DTO_API_V1['ADMIN_UPDATE_PERMISSIONS']['REQUEST']
    >
  >;
};
