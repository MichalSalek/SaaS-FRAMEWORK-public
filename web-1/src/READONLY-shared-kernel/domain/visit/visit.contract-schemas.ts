import { z } from 'zod';
import { wireInstant } from '../../application/contracts/wire-values';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import { VISIT_CONFIG } from './visit.config';
import { VisitRecordSourceValue } from '../../models/db_models.generated.dto';
import { VALIDATION_LENGTHS } from '../../policies/validation.config';
import {
  countCodePoints,
  hasUnpairedSurrogate,
  isCloudinaryAssetUrl,
  parsePgSafeDate,
} from '../../policies/validation/validation.utils';

const V = VALIDATION_MESSAGES;

const visitDateWire = z.union([
  z.iso.date(),
  z.iso.datetime({ offset: true, local: true }),
]);
const isValidDateString = (value: string): boolean =>
  visitDateWire.safeParse(value).success && parsePgSafeDate(value) !== null;

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
  .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.visit.clientUserIdRequired);

const visitId = z
  .string({ error: V.visit.visitIdRequired })
  .min(1, V.visit.visitIdRequired)
  .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.visit.visitIdRequired);

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

export const createManualVisitSchema = z.object({
  client_user_id: clientUserId,
  visit_date: z
    .string({ error: V.visit.visitDateRequired })
    .min(1, V.visit.visitDateRequired)
    .refine(isValidDateString, V.visit.visitDateInvalid)
    .refine(isNotFutureDate, V.visit.visitDateInFuture),
  service_note: serviceNote.optional(),
});

export const updateVisitNoteSchema = z.object({
  visit_id: visitId,
  service_note: serviceNote,
});

export const addVisitResultPhotoSchema = z.object({
  visit_id: visitId,
  asset_url: z
    .string({ error: V.visit.assetUrlRequired })
    .min(1, V.visit.assetUrlRequired)
    .max(VALIDATION_LENGTHS.ASSET_URL_MAX, V.visit.assetUrlInvalid)
    .refine(isCloudinaryAssetUrl, V.visit.assetUrlInvalid),
});

export const removeVisitResultPhotoSchema = z.object({
  visit_id: visitId,
  photo_id: z
    .string({ error: V.visit.photoIdRequired })
    .min(1, V.visit.photoIdRequired)
    .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.visit.photoIdRequired),
});

export const deleteManualVisitSchema = z.object({
  visit_id: visitId,
});

const visitPhotoSchema = z.object({
  id: z.string(),
  visitRecordId: z.string(),
  assetUrl: z.string(),
  position: z.number(),
  createdAt: wireInstant,
});

export const visitRecordSchema = z.object({
  id: z.string(),
  clientUserId: z.string(),
  visitDate: wireInstant,
  serviceNote: z.string().nullable(),
  source: z.enum([
    VisitRecordSourceValue.SESSION,
    VisitRecordSourceValue.MANUAL,
  ]),
  sessionId: z.string().nullable(),
  resultPhotos: z.array(visitPhotoSchema),
  createdAt: wireInstant,
});

export const visitCreatedSchema = z.object({ visit: visitRecordSchema });

export const visitPhotoCreatedSchema = z.object({ photo: visitPhotoSchema });

export const visitSuccessSchema = z.object({ success: z.boolean() });

export const clientVisitsSchema = z.object({
  visits: z.array(visitRecordSchema),
  nextCursor: z.string().nullable(),
  historyAccess: z.object({
    isLocked: z.boolean(),
    canViewHistory: z.boolean(),
    retentionDays: z.number(),
  }),
  expiredSessions: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      sharedAt: wireInstant,
      expiresAt: wireInstant,
      photoCount: z.number(),
    })
  ),
});
