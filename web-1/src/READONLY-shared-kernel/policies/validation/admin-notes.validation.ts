import type { z } from 'zod';
import {
  adminSaveNoteSchema,
  adminSetMainNoteSchema,
} from '../../domain/admin/admin.contract-schemas';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

export const adminNotesValidators = {
  adminSaveNote: (data: unknown) => zodValidate(adminSaveNoteSchema, data),
  adminSetMainNote: (data: unknown) =>
    zodValidate(adminSetMainNoteSchema, data),
} as const;

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
