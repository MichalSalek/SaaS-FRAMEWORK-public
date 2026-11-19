import type { z } from 'zod';
import type { CLIENT_DTO_API_V1 } from '../../models/client/client.dto';
import type { VISIT_DTO_API_V1 } from '../../models/visit/visit.dto';
import {
  clientDeleteCrmNoteSchema,
  clientUpsertCrmNoteSchema,
  clientUpsertImportantNoteSchema,
} from '../../domain/visit/crm-note.schemas';
import {
  addVisitResultPhotoSchema,
  createManualVisitSchema,
  deleteManualVisitSchema,
  removeVisitResultPhotoSchema,
  updateVisitNoteSchema,
} from '../../domain/visit/visit.contract-schemas';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

export const visitValidators = {
  createManualVisit: (data: unknown) =>
    zodValidate(createManualVisitSchema, data),
  updateVisitNote: (data: unknown) => zodValidate(updateVisitNoteSchema, data),
  addVisitResultPhoto: (data: unknown) =>
    zodValidate(addVisitResultPhotoSchema, data),
  removeVisitResultPhoto: (data: unknown) =>
    zodValidate(removeVisitResultPhotoSchema, data),
  deleteManualVisit: (data: unknown) =>
    zodValidate(deleteManualVisitSchema, data),
  clientUpsertCrmNote: (data: unknown) =>
    zodValidate(clientUpsertCrmNoteSchema, data),
  clientDeleteCrmNote: (data: unknown) =>
    zodValidate(clientDeleteCrmNoteSchema, data),
  clientUpsertImportantNote: (data: unknown) =>
    zodValidate(clientUpsertImportantNoteSchema, data),
} as const;

export type VisitRequestSchemaBindings = {
  createManualVisit: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof createManualVisitSchema>,
      VISIT_DTO_API_V1['CREATE_MANUAL_VISIT']['REQUEST']
    >
  >;
  updateVisitNote: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof updateVisitNoteSchema>,
      VISIT_DTO_API_V1['UPDATE_VISIT_NOTE']['REQUEST']
    >
  >;
  addVisitResultPhoto: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof addVisitResultPhotoSchema>,
      VISIT_DTO_API_V1['ADD_VISIT_RESULT_PHOTO']['REQUEST']
    >
  >;
  removeVisitResultPhoto: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof removeVisitResultPhotoSchema>,
      VISIT_DTO_API_V1['REMOVE_VISIT_RESULT_PHOTO']['REQUEST']
    >
  >;
  deleteManualVisit: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof deleteManualVisitSchema>,
      VISIT_DTO_API_V1['DELETE_MANUAL_VISIT']['REQUEST']
    >
  >;
  clientUpsertCrmNote: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof clientUpsertCrmNoteSchema>,
      CLIENT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['REQUEST']
    >
  >;
  clientDeleteCrmNote: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof clientDeleteCrmNoteSchema>,
      CLIENT_DTO_API_V1['CLIENT_DELETE_CRM_NOTE']['REQUEST']
    >
  >;
  clientUpsertImportantNote: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof clientUpsertImportantNoteSchema>,
      CLIENT_DTO_API_V1['CLIENT_UPSERT_IMPORTANT_NOTE']['REQUEST']
    >
  >;
};
