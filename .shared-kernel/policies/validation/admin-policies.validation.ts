import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import { VALIDATION_LENGTHS } from '../validation.config';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// adminSavePolicy: create-or-update.
// - id: optional (absent on create); if present must be a string → invalidPolicyId.
// - title/content: required non-blank strings. Original treats falsy | non-string |
//   trim()-empty all as the same "missing" error → z.string() (missing/non-string) +
//   .refine(trim) (whitespace-only) both emit the identical i18n key on the same field.
//   `.max()` (added turbo-review S58) is behavior-preserving for legal payloads (a real
//   regulamin/ToS << cap) and closes the source-unbounded gap — title/content are stored
//   straight to Postgres `Policy.title`/`Policy.content @db.Text` by savePolicy_IO with no
//   producer-side cap (sibling saveNote_IO has one). `.max` runs before `.refine` so it
//   sits on the ZodString (a mega-string trips tooLong; a blank still trips missing).
const adminSavePolicySchema = z.object({
  id: z.string({ error: V.admin.invalidPolicyId }).optional(),
  title: z
    .string({ error: V.admin.missingPolicyTitle })
    .max(VALIDATION_LENGTHS.POLICY_TITLE_MAX, V.admin.policyTitleTooLong)
    .refine(v => v.trim().length > 0, V.admin.missingPolicyTitle),
  content: z
    .string({ error: V.admin.missingPolicyContent })
    .max(VALIDATION_LENGTHS.POLICY_CONTENT_MAX, V.admin.policyContentTooLong)
    .refine(v => v.trim().length > 0, V.admin.missingPolicyContent),
});

// adminDeletePolicy / adminSetMainPolicy: original delegates to validateRequiredId,
// which rejects falsy (incl. '') and non-string id with the same invalidPolicyId key.
// .min(1) reproduces the falsy/empty rejection; z.string() the non-string/missing one.
const adminDeletePolicySchema = z.object({
  id: z
    .string({ error: V.admin.invalidPolicyId })
    .min(1, V.admin.invalidPolicyId),
});

const adminSetMainPolicySchema = z.object({
  id: z
    .string({ error: V.admin.invalidPolicyId })
    .min(1, V.admin.invalidPolicyId),
});

export const adminPoliciesValidators = {
  adminSavePolicy: (data: unknown) => zodValidate(adminSavePolicySchema, data),
  adminDeletePolicy: (data: unknown) =>
    zodValidate(adminDeletePolicySchema, data),
  adminSetMainPolicy: (data: unknown) =>
    zodValidate(adminSetMainPolicySchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per validator; each property fails to compile if the
// schema's inferred output drifts from its REQUEST DTO. Exported so it is never unused.
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
