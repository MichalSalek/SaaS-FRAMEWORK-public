import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import { VALIDATION_CONFIG } from '../validation.config';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// adminUpdateConfig: value size cap is CONTENT-DEPENDENT — a stringified JSON
// object/array (trimmed value wrapped in {}/[]) gets the higher 32 KB cap, a
// scalar primitive gets the 1 KB cap.
//
// DECISION (nie usuwaj tego komentarza):
// The cap is a SINGLE-FIELD rule (depends only on `value`'s own content), so it lives
// in a FIELD-LEVEL `.superRefine` on `value` — NOT object-level. Field-level keeps
// `value`'s validation INDEPENDENT of `key`: a missing/invalid `key` still surfaces the
// value-cap error in the same response (an object-level superRefine would be skipped
// whenever the base object parse fails on `key`, dropping the value error — fidelity
// drift vs the hand-written validator, which checked each field independently). The
// field-level superRefine only runs after `z.string` passes, so `value` is already a
// string (matching the original `else` branch that skipped the cap for non-strings).
const adminUpdateConfigSchema = z.object({
  key: z.string({ error: V.config.keyRequired }).min(1, V.config.keyRequired),
  value: z
    .string({ error: V.config.valueMustBeString })
    .superRefine((value, ctx) => {
      const trimmed = value.trim();
      const isJsonComplex =
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'));
      const cap = isJsonComplex
        ? VALIDATION_CONFIG.VALUE_OBJECT_MAX
        : VALIDATION_CONFIG.VALUE_PRIMITIVE_MAX;
      if (value.length > cap) {
        ctx.addIssue({ code: 'custom', message: V.config.valueTooLong });
      }
    }),
});

export const adminRuntimeConfigValidators = {
  // always-valid passthrough: GET endpoint, REQUEST is `undefined` (no payload to
  // validate). Original returned `{__isValid: true, __general: ''}` with no checks.
  // No zod schema / witness — there is no REQUEST shape to bind.
  adminGetConfigs: (_data: unknown) => ({ __isValid: true, __general: '' }),

  adminUpdateConfig: (data: unknown) =>
    zodValidate(adminUpdateConfigSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per non-passthrough validator; each property fails to
// compile if the schema's inferred output drifts from its REQUEST DTO. Exported so
// it is never flagged unused. `adminGetConfigs` is omitted: its REQUEST is
// `undefined` (always-valid passthrough, no object shape to bind).
export type AdminRuntimeConfigRequestSchemaBindings = {
  adminUpdateConfig: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminUpdateConfigSchema>,
      ADMIN_DTO_API_V1['ADMIN_UPDATE_CONFIG']['REQUEST']
    >
  >;
};
