import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import { VISIT_CONFIG } from '../../domain/visit/visit.config';
import { VALIDATION_LENGTHS } from '../validation.config';
import type { VISIT_DTO_API_V1 } from '../../models/visit/visit.dto';
import {
  countCodePoints,
  hasUnpairedSurrogate,
  isCloudinaryAssetUrl,
  parsePgSafeDate,
} from './validation.utils';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// Data poprawna dla JS, ale spoza zakresu PostgreSQL, docierała do Prismy i wracała
// jako nieprzezroczyste 500 zamiast błędu walidacji — patrz DECISION przy
// `parsePgSafeDate`.
const isValidDateString = (value: string): boolean =>
  parsePgSafeDate(value) !== null;

// Wizyta = zdarzenie przeszłe/dzisiejsze (feature = retrospektywna historia usług "co robiłam /
// kiedy przyszła"; planowanie przyszłych wizyt to osobny booking system, post-MVP). Odrzucamy daty
// z przyszłości. Bufor 1 dnia (24h) pokrywa maksymalny rozrzut stref czasowych (date-only "dzisiaj"
// w UTC+14 to ≈ +14h wobec now), więc lokalne "dzisiaj" klienta w dowolnej strefie nigdy nie zostaje
// błędnie odrzucone, a wpis „jutro+" jest już blokowany.
const FUTURE_VISIT_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const isNotFutureDate = (value: string): boolean => {
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) && parsed <= Date.now() + FUTURE_VISIT_TOLERANCE_MS
  );
};

const clientUserId = z
  .string({ error: V.visit.clientUserIdRequired })
  .min(1, V.visit.clientUserIdRequired)
  // Górna granica identyfikatora — patrz WHY przy ENTITY_ID_MAX.
  .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.visit.clientUserIdRequired);

const visitId = z
  .string({ error: V.visit.visitIdRequired })
  .min(1, V.visit.visitIdRequired)
  .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.visit.visitIdRequired);

// Treść pisana przez człowieka (D5, 2026-09-05): limit w PUNKTACH KODOWYCH
// (DECISION przy countCodePoints), osierocony surogat ODRZUCANY zamiast cichej
// zamiany na U+FFFD. Jeden komunikat na pole (superRefine + return).
const humanText = (max: number, tooLongMessage: string) =>
  z.string({ error: tooLongMessage }).superRefine((value, ctx) => {
    if (hasUnpairedSurrogate(value)) {
      ctx.addIssue({ code: 'custom', message: V.general.invalidCharacters });
      return;
    }
    if (countCodePoints(value) > max) {
      ctx.addIssue({ code: 'custom', message: tooLongMessage });
    }
  });

const serviceNote = humanText(
  VISIT_CONFIG.SERVICE_NOTE_MAX,
  V.visit.serviceNoteTooLong
);

const createManualVisitSchema = z.object({
  client_user_id: clientUserId,
  visit_date: z
    .string({ error: V.visit.visitDateRequired })
    .min(1, V.visit.visitDateRequired)
    .refine(isValidDateString, V.visit.visitDateInvalid)
    .refine(isNotFutureDate, V.visit.visitDateInFuture),
  service_note: serviceNote.optional(),
});

const updateVisitNoteSchema = z.object({
  visit_id: visitId,
  service_note: serviceNote,
});

const addVisitResultPhotoSchema = z.object({
  visit_id: visitId,
  asset_url: z
    .string({ error: V.visit.assetUrlRequired })
    .min(1, V.visit.assetUrlRequired)
    .max(VALIDATION_LENGTHS.ASSET_URL_MAX, V.visit.assetUrlInvalid)
    .refine(isCloudinaryAssetUrl, V.visit.assetUrlInvalid),
});

const removeVisitResultPhotoSchema = z.object({
  visit_id: visitId,
  photo_id: z
    .string({ error: V.visit.photoIdRequired })
    .min(1, V.visit.photoIdRequired)
    .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.visit.photoIdRequired),
});

const deleteManualVisitSchema = z.object({
  visit_id: visitId,
});

const clientUpsertCrmNoteSchema = z.object({
  client_user_id: clientUserId,
  note: humanText(VISIT_CONFIG.CRM_NOTE_MAX, V.visit.crmNoteTooLong),
});

// D4: kasowanie notatki — tylko identyfikator klientki.
const clientDeleteCrmNoteSchema = z.object({
  client_user_id: clientUserId,
});

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
      VISIT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['REQUEST']
    >
  >;
  clientDeleteCrmNote: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof clientDeleteCrmNoteSchema>,
      VISIT_DTO_API_V1['CLIENT_DELETE_CRM_NOTE']['REQUEST']
    >
  >;
};
