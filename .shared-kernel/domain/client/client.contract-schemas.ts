import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import {
  VALIDATION_LENGTHS,
  VALIDATION_REGEX,
} from '../../policies/validation.config';
import {
  checkPhoneLength,
  validateEmail,
} from '../../policies/validation/validation.utils';

export {
  clientDeleteCrmNoteSchema,
  clientUpsertCrmNoteSchema,
  clientUpsertImportantNoteSchema,
} from '../visit/crm-note.schemas';

const V = VALIDATION_MESSAGES;

// Both fields optional; an empty / whitespace-only value is "cleared" (valid, stored
// as null). A present non-empty value is validated AFTER trim. Phone accumulates
// tooShort + invalidChars independently; email accumulates tooLong + invalid.
// `z.string(...)` base catches a non-string (→ phone.invalidChars / email.invalid,
// the original type-guard branch) and aborts the refine, so non-strings yield exactly
// one message like the hand-written validator.
//
// DECISION: `.nullable()` is intended: REQUEST DTO = Partial<Pick<ClientAccount, contact_*>> and those
// columns are `string | null`, so `null` is a legal contract value ("clear the field"), as the manual
// validator accepted (`x !== null` guard). `.optional()` covers only `undefined`, so without
// `.nullable()` null would be wrongly rejected. `z.infer` = `string | null | undefined` matches the
// DTO, so the binding witness applies (MiscRequestSchemaBindings).
export const clientUpdateContactSchema = z.object({
  contact_phone: z
    .string({ error: V.phone.invalidChars })
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      const phone = value.trim();
      if (phone.length === 0) {
        return;
      } // whitespace-only → cleared
      // The range counts DIGITS plus a ceiling on the raw string; SSOT is checkPhoneLength
      // (see the DECISION in `validation.utils.ts`). A separate message for a too-long number.
      const lengthIssue = checkPhoneLength(phone);
      if (lengthIssue === 'tooShort') {
        ctx.addIssue({ code: 'custom', message: V.phone.tooShort });
      } else if (lengthIssue === 'tooLong') {
        ctx.addIssue({ code: 'custom', message: V.phone.tooLong });
      }
      if (!VALIDATION_REGEX.PHONE_FORMAT.test(phone)) {
        ctx.addIssue({ code: 'custom', message: V.phone.invalidChars });
      }
    }),
  contact_email: z
    .string({ error: V.email.invalid })
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      const email = value.trim();
      if (email.length === 0) {
        return;
      } // whitespace-only → cleared
      if (email.length > VALIDATION_LENGTHS.EMAIL_MAX) {
        ctx.addIssue({ code: 'custom', message: V.email.tooLong });
      }
      if (!validateEmail(email)) {
        ctx.addIssue({ code: 'custom', message: V.email.invalid });
      }
    }),
});

const storedContact = {
  contact_phone: z.string().nullable(),
  contact_email: z.string().nullable(),
};

export const clientContactUpdatedSchema = z.object({
  success: z.literal(true),
  ...storedContact,
});

/** created_at is already `toISOString()` in the operation. */
export const clientProfileSchema = z.object({
  ...storedContact,
  created_at: z.string(),
});

export const clientContactForStylistSchema = z.object({
  ...storedContact,
  client_name: z.string(),
});

/** updatedAt is `toISOString()` or null. The delete route answers null for both. */
export const clientNoteSchema = z.object({
  note: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const clientNoteClearedSchema = z.object({
  note: z.null(),
  updatedAt: z.null(),
});
