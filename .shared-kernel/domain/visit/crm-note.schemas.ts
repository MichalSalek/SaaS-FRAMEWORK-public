import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import { VISIT_CONFIG } from './visit.config';
import { VALIDATION_LENGTHS } from '../../policies/validation.config';
import {
  countCodePoints,
  hasUnpairedSurrogate,
} from '../../policies/validation/validation.utils';

const V = VALIDATION_MESSAGES;

const clientUserId = z
  .string({ error: V.visit.clientUserIdRequired })
  .min(1, V.visit.clientUserIdRequired)
  .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.visit.clientUserIdRequired);

// CRM length is checked against the persisted baseline inside its write transaction.
// Fixed-limit fields keep their code-point cap here; all text rejects unpaired surrogates.
const humanText = (max: number | undefined, tooLongMessage: string) =>
  z.string({ error: tooLongMessage }).superRefine((value, ctx) => {
    if (hasUnpairedSurrogate(value)) {
      ctx.addIssue({ code: 'custom', message: V.general.invalidCharacters });
      return;
    }
    if (max !== undefined && countCodePoints(value) > max) {
      ctx.addIssue({ code: 'custom', message: tooLongMessage });
    }
  });

/** Stylist CRM note on a client card. Canonical request schema for the client contract and the visit validator. */
export const clientUpsertCrmNoteSchema = z.object({
  client_user_id: clientUserId,
  note: humanText(undefined, V.visit.crmNoteTooLong),
  expected_updated_at: z.iso
    .datetime({ error: V.visit.crmNoteChanged })
    .nullable()
    .optional(),
});

/** Important note on a client card. Same canonical module as the CRM note. */
export const clientUpsertImportantNoteSchema = z.object({
  client_user_id: clientUserId,
  note: humanText(
    VISIT_CONFIG.IMPORTANT_NOTE_MAX,
    V.visit.importantNoteTooLong
  ),
  expected_updated_at: z.iso
    .datetime({ error: V.visit.crmNoteChanged })
    .nullable()
    .optional(),
});

/** Clears the CRM note. The body is only the client id. */
export const clientDeleteCrmNoteSchema = z.object({
  client_user_id: clientUserId,
});
