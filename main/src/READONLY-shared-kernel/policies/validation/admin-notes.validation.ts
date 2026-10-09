import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// adminSaveNote: original rejected falsy (incl. '') OR non-string `notes` with a single
// message (V.admin.missingNotes). z.string({error}) covers the non-string/missing case;
// .min(1) covers the empty-string case — same message on the same `notes` field.
const adminSaveNoteSchema = z.object({
  notes: z.string({ error: V.admin.missingNotes }).min(1, V.admin.missingNotes),
});

// adminSetMainNote: delegated to validateRequiredId(data, V.admin.invalidNoteId), which
// rejected falsy (incl. '') OR non-string `id` with a single message on the `id` field.
// Same shape as adminSaveNote: type/required-error + .min(1) for the empty-string reject.
const adminSetMainNoteSchema = z.object({
  id: z.string({ error: V.admin.invalidNoteId }).min(1, V.admin.invalidNoteId),
});

export const adminNotesValidators = {
  adminSaveNote: (data: unknown) => zodValidate(adminSaveNoteSchema, data),
  adminSetMainNote: (data: unknown) =>
    zodValidate(adminSetMainNoteSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
export type AdminNotesRequestSchemaBindings = {
  adminSaveNote: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminSaveNoteSchema>,
      ADMIN_DTO_API_V1['SAVE_NOTE']['REQUEST']
    >
  >;
  adminSetMainNote: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminSetMainNoteSchema>,
      ADMIN_DTO_API_V1['SET_MAIN_NOTE']['REQUEST']
    >
  >;
};
