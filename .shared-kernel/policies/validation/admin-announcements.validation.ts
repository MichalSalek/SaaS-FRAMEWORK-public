import { z } from 'zod';
import { ANNOUNCEMENT_TYPES } from '../../domain/admin/announcements.config';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { ADMIN_DTO_API_V1 } from '../../models/admin/admin.dto';
import { VALIDATION_LENGTHS } from '../validation.config';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// title/message: original rejects falsy | non-string | trimmed length < 1 | trimmed
// length > MAX — all under a SINGLE i18n key. `z.string({error})` covers missing/non-string;
// `.refine` covers the trim-length window. Trim semantics preserved 1:1.
const announcementTitleSchema = z
  .string({ error: V.announcement.titleInvalid })
  .refine(
    v =>
      v.trim().length >= 1 &&
      v.trim().length <= VALIDATION_LENGTHS.ANNOUNCEMENT_TITLE_MAX,
    V.announcement.titleInvalid
  );

const announcementMessageSchema = z
  .string({ error: V.announcement.messageInvalid })
  .refine(
    v =>
      v.trim().length >= 1 &&
      v.trim().length <= VALIDATION_LENGTHS.ANNOUNCEMENT_MESSAGE_MAX,
    V.announcement.messageInvalid
  );

// type: union = AnnouncementType DTO. z.enum infers the literal union → binds to DTO.
// Original emits a single key for both missing and not-in-set → flat `{ error }`.
const announcementTypeSchema = z.enum(ANNOUNCEMENT_TYPES, {
  error: V.announcement.typeInvalid,
});

const adminCreateAnnouncementSchema = z.object({
  title: announcementTitleSchema,
  message: announcementMessageSchema,
  type: announcementTypeSchema,
  is_active: z.boolean({ error: V.announcement.isActiveInvalid }),
  // create: original validates starts_at/ends_at only when `!== undefined`; null (or any
  // non-string) → error. DTO `starts_at?: string` (no null) → `.optional()` (null rejected).
  starts_at: z.string({ error: V.announcement.startsAtInvalid }).optional(),
  ends_at: z.string({ error: V.announcement.endsAtInvalid }).optional(),
});

const adminUpdateAnnouncementSchema = z.object({
  // id: original `!typedData?.id || typeof !== 'string'` → invalidId (missing/empty/non-string).
  id: z.string({ error: V.admin.invalidId }).min(1, V.admin.invalidId),
  // partial-update: each field validated ONLY when `!== undefined` → `.optional()` + constraints.
  title: announcementTitleSchema.optional(),
  message: announcementMessageSchema.optional(),
  type: announcementTypeSchema.optional(),
  is_active: z.boolean({ error: V.announcement.isActiveInvalid }).optional(),
  // update: original validates starts_at/ends_at only when `!== undefined && !== null`; null is
  // accepted. DTO `starts_at?: string | null` → `.nullable().optional()` (null passes, non-string
  // non-null fails). Same i18n key as create.
  starts_at: z
    .string({ error: V.announcement.startsAtInvalid })
    .nullable()
    .optional(),
  ends_at: z
    .string({ error: V.announcement.endsAtInvalid })
    .nullable()
    .optional(),
});

// delete: ports validateRequiredId(data, V.admin.invalidId) — `!id || typeof !== 'string'`
// → invalidId. `.min(1)` covers the empty-string-is-falsy branch.
const adminDeleteAnnouncementSchema = z.object({
  id: z.string({ error: V.admin.invalidId }).min(1, V.admin.invalidId),
});

export const adminAnnouncementsValidators = {
  // always-valid passthrough (REQUEST: undefined; GET, no body to validate) — no schema.
  adminGetAnnouncements: (_data: unknown) => ({
    __isValid: true,
    __general: '',
  }),
  adminCreateAnnouncement: (data: unknown) =>
    zodValidate(adminCreateAnnouncementSchema, data),
  adminUpdateAnnouncement: (data: unknown) =>
    zodValidate(adminUpdateAnnouncementSchema, data),
  adminDeleteAnnouncement: (data: unknown) =>
    zodValidate(adminDeleteAnnouncementSchema, data),
  // always-valid passthrough (REQUEST: undefined; public GET active, no body) — no schema.
  announcementsGetActive: (_data: unknown) => ({
    __isValid: true,
    __general: '',
  }),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One property per non-passthrough validator. adminGetAnnouncements / announcementsGetActive
// are omitted: REQUEST is `undefined` (nothing to validate, always-valid passthrough — rule 9).
export type AdminAnnouncementsRequestSchemaBindings = {
  adminCreateAnnouncement: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminCreateAnnouncementSchema>,
      ADMIN_DTO_API_V1['ADMIN_CREATE_ANNOUNCEMENT']['REQUEST']
    >
  >;
  adminUpdateAnnouncement: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminUpdateAnnouncementSchema>,
      ADMIN_DTO_API_V1['ADMIN_UPDATE_ANNOUNCEMENT']['REQUEST']
    >
  >;
  adminDeleteAnnouncement: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof adminDeleteAnnouncementSchema>,
      ADMIN_DTO_API_V1['ADMIN_DELETE_ANNOUNCEMENT']['REQUEST']
    >
  >;
};
