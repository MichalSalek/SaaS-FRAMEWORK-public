import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { EMAIL_DTO_API_V1 } from '../../models/email/email.dto';
import type { USER_DTO_API_V1 } from '../../models/user/user.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// Confirmation-token field shared by emailUnsubscribe / emailChangeConfirm / deleteConfirm
// (all three had byte-identical hand logic). The original gated the length checks behind
// an `else` to a truthy-non-empty-string branch, and measured length on the TRIMMED token:
//   - missing / non-string / '' (falsy)        → token.required
//   - non-empty string, trimmed length < 20    → token.invalidFormat
//   - non-empty string, trimmed length > 500    → token.tooLong  (CPU-abuse cap)
// Reproduced 1:1: `z.string(required).min(1, required)` covers the falsy/non-string cases
// (incl. '' → required), and `superRefine` runs the trimmed-length checks ONLY for a
// raw-non-empty string (the `v.length === 0` guard mirrors the original's truthy `else`,
// so '' yields required-only — NOT required+invalidFormat — while whitespace-only '   '
// still trims to 0 < 20 → invalidFormat, exactly as the hand-written validator did).
const confirmationTokenField = z
  .string({ error: V.token.required })
  .min(1, V.token.required)
  .superRefine((value, ctx) => {
    if (value.length === 0) {
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length < 20) {
      ctx.addIssue({ code: 'custom', message: V.token.invalidFormat });
    }
    if (trimmed.length > 500) {
      ctx.addIssue({ code: 'custom', message: V.token.tooLong });
    }
  });

const emailUnsubscribeSchema = z.object({
  token: confirmationTokenField,
});

const emailChangeConfirmSchema = z.object({
  token: confirmationTokenField,
});

const deleteConfirmSchema = z.object({
  token: confirmationTokenField,
});

const emailUpdatePreferencesSchema = z.object({
  trial_sequence: z.boolean({ error: V.general.booleanRequired }),
  marketing: z.boolean({ error: V.general.booleanRequired }),
});

export const emailValidators = {
  emailUnsubscribe: (data: unknown) =>
    zodValidate(emailUnsubscribeSchema, data),
  emailUpdatePreferences: (data: unknown) =>
    zodValidate(emailUpdatePreferencesSchema, data),
  emailChangeConfirm: (data: unknown) =>
    zodValidate(emailChangeConfirmSchema, data),
  deleteConfirm: (data: unknown) => zodValidate(deleteConfirmSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per validator; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
// emailChangeConfirm / deleteConfirm bind to USER_DTO (the GET confirmation handlers live
// under user/*); emailUnsubscribe / emailUpdatePreferences bind to EMAIL_DTO.
export type EmailRequestSchemaBindings = {
  emailUnsubscribe: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof emailUnsubscribeSchema>,
      EMAIL_DTO_API_V1['EMAIL_UNSUBSCRIBE']['REQUEST']
    >
  >;
  emailUpdatePreferences: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof emailUpdatePreferencesSchema>,
      EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['REQUEST']
    >
  >;
  emailChangeConfirm: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof emailChangeConfirmSchema>,
      USER_DTO_API_V1['USER_EMAIL_CHANGE_CONFIRM']['REQUEST']
    >
  >;
  deleteConfirm: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof deleteConfirmSchema>,
      USER_DTO_API_V1['USER_DELETE_CONFIRM']['REQUEST']
    >
  >;
};
