import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import { NAIL_LENGTHS } from '../gallery/nail-length.config';
import { SessionContainerLifecycleStateValue } from '../../models/db_models.generated.dto';
import { SESSION_CONTAINER_CONFIG } from './session-container.config';
import { validateOptionalString } from '../../policies/validation/validation.utils';

const V = VALIDATION_MESSAGES;

// CREATE: both fields optional. Each is checked only when present.
// DECISION: '' is REJECTED for stylist_account_id. A type-only check let '' skip the
// operation's truthy pairing test and hit Prisma P2003. Omit the field for no stylist.
// DECISION: `name: null` is REJECTED. The request type is `name?: string`, not `| null`.
// Test: validation-null-contract.test.ts (null name; not a present empty stylist id).
export const sessionContainerCreateSchema = z.object({
  stylist_account_id: z
    .string({ error: V.sessionContainer.stylistIdInvalid })
    .min(1, V.sessionContainer.stylistIdInvalid)
    .optional(),
  name: z
    .string({ error: V.sessionContainer.nameTooLong })
    .refine(
      v =>
        validateOptionalString(
          v,
          SESSION_CONTAINER_CONFIG.SESSION_NAME_MAX_LENGTH
        ),
      V.sessionContainer.nameTooLong
    )
    .optional(),
});

const requiredId = (message: string) =>
  z.string({ error: message }).min(1, message);

export const sessionContainerAddPhotoSchema = z.object({
  session_id: requiredId(V.sessionContainer.sessionIdRequired),
  gallery_record_id: requiredId(V.sessionContainer.galleryRecordIdRequired),
});

export const sessionContainerRemovePhotoSchema = z.object({
  session_id: requiredId(V.sessionContainer.sessionIdRequired),
  gallery_record_id: requiredId(V.sessionContainer.galleryRecordIdRequired),
});

export const sessionContainerShareSchema = z.object({
  session_id: requiredId(V.sessionContainer.sessionIdRequired),
});

export const sessionContainerAcceptSchema = sessionContainerShareSchema;

export const sessionContainerCloseSchema = z.object({
  session_id: requiredId(V.sessionContainer.sessionIdRequired),
});

// SET_NOTE: note is a required string and '' is valid. side is exactly stylist or client.
export const sessionContainerSetNoteSchema = z.object({
  session_id: requiredId(V.sessionContainer.sessionIdRequired),
  note: z
    .string({ error: V.sessionContainer.noteRequired })
    .max(
      SESSION_CONTAINER_CONFIG.SESSION_NOTE_MAX_LENGTH,
      V.sessionContainer.noteTooLong
    ),
  side: z.enum(['stylist', 'client'], {
    error: V.sessionContainer.sideInvalid,
  }),
});

const nullableString = z.string().nullable();

const sessionContainerSchema = z.object({
  id: z.string(),
  clientAccountId: z.string(),
  clientName: nullableString,
  clientUserId: nullableString,
  stylistAccountId: nullableString,
  name: nullableString,
  lifecycleState: z.enum(SessionContainerLifecycleStateValue),
  stylistNote: nullableString,
  clientNote: nullableString,
  sharedAt: nullableString,
  accepted_at: nullableString.optional(),
  last_client_change_at: nullableString.optional(),
  expiresAt: nullableString,
  closedAt: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
  photoCount: z.number(),
});

const photoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  galleryRecordId: z.string(),
  position: z.number(),
  createdAt: z.string(),
  galleryRecord: z
    .object({
      gallery_record_id: z.string(),
      asset_url: z.string(),
      nail_length: z.enum(NAIL_LENGTHS),
      is_pinned: z.boolean(),
      created_by_account_id: z.string(),
      author: z
        .object({
          name: z.string(),
          avatar_url: z.string().nullable(),
          identifier: z.string(),
        })
        .optional(),
    })
    .optional(),
});

export const sessionDetailSchema = sessionContainerSchema.extend({
  photos: z.array(photoSchema),
  can_accept: z.boolean().optional(),
});

export const sessionResponseSchema = z.object({
  session: sessionContainerSchema,
});

export const sessionDetailResponseSchema = z.object({
  session: sessionDetailSchema,
});

export const sessionListResponseSchema = z.object({
  sessions: z.array(sessionContainerSchema),
  nextCursor: z.string().nullable(),
});

export const sessionInsightsResponseSchema = z.object({
  available: z.boolean(),
  sessions_count: z.number(),
  photos_count: z.number(),
  top_colors: z.array(
    z.object({ name: z.string(), hex_code: z.string(), count: z.number() })
  ),
  top_traits: z.array(z.object({ name: z.string(), count: z.number() })),
  top_lengths: z.array(
    z.object({ length: z.enum(NAIL_LENGTHS), count: z.number() })
  ),
});
