import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import { SESSION_CONTAINER_CONFIG } from '../../domain/session-container/session-container.config';
import type { SESSION_CONTAINER_DTO_API_V1 } from '../../models/session-container/session-container.dto';
import { validateOptionalString } from './validation.utils';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// CREATE: both fields optional (DTO `?:`). Original validated each ONLY when present
// (partial-update semantics), so both map to `.optional()`:
//  - stylist_account_id: present-but-not-string OR empty '' → stylistIdInvalid.
//    DECISION (nie usuwaj tego komentarza): '' is REJECTED (testy-api 2026-09-25). The
//    original checked type only, so '' passed validation, skipped the operation's
//    truthy pairing check and reached `sessionContainer.create` as a foreign key to a
//    stylist account that cannot exist → P2003 → 500. An empty id is never a legal
//    reference; omit the field for a session without a stylist.
//  - name: original used validateOptionalString(name, MAX) → invalid (nameTooLong) when
//    present-but-not-string OR string-too-long. Reused via .refine for the length branch;
//    the string base reproduces the non-string→nameTooLong path.
//
// DECISION (nie usuwaj tego komentarza):
// `name: null` jest teraz ODRZUCANY (nameTooLong) gdzie HEAD akceptował null
// (validateOptionalString(null) === true). To CELOWE zacieśnienie zgodne z kontraktem:
// REQUEST DTO = `name?: string | undefined` (BEZ `| null`), więc `null` nie jest legalną
// wartością kontraktu — odrzucenie wyrównuje runtime do typu (cel Wave H). `null` nie jest
// osiągalny z frontu (DTO typuje pole `string | undefined`); różni się tylko od loose-by-
// accident HEAD. Pinowane w validation-null-contract.test.ts. (Kontrast: clientUpdateContact,
// którego DTO faktycznie dopuszcza `string | null`, używa `.nullable()` i akceptuje null.)
const sessionContainerCreateSchema = z.object({
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

// ADD_PHOTO: both required ids. Original: `!id || typeof !== 'string'` → required key.
// z.string type-error (missing/non-string) + .min(1) (empty '') both map to that key.
const sessionContainerAddPhotoSchema = z.object({
  session_id: z
    .string({ error: V.sessionContainer.sessionIdRequired })
    .min(1, V.sessionContainer.sessionIdRequired),
  gallery_record_id: z
    .string({ error: V.sessionContainer.galleryRecordIdRequired })
    .min(1, V.sessionContainer.galleryRecordIdRequired),
});

const sessionContainerShareSchema = z.object({
  session_id: z
    .string({ error: V.sessionContainer.sessionIdRequired })
    .min(1, V.sessionContainer.sessionIdRequired),
});

const sessionContainerCloseSchema = z.object({
  session_id: z
    .string({ error: V.sessionContainer.sessionIdRequired })
    .min(1, V.sessionContainer.sessionIdRequired),
});

// SET_NOTE: session_id required; note required-as-string but allows '' (original:
// non-string → noteRequired, else length>MAX → noteTooLong; '' is a valid 0-length
// string); side must be exactly 'stylist'|'client' → sideInvalid.
const sessionContainerSetNoteSchema = z.object({
  session_id: z
    .string({ error: V.sessionContainer.sessionIdRequired })
    .min(1, V.sessionContainer.sessionIdRequired),
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

export const sessionContainerValidators = {
  sessionContainerCreate: (data: unknown) =>
    zodValidate(sessionContainerCreateSchema, data),
  sessionContainerAddPhoto: (data: unknown) =>
    zodValidate(sessionContainerAddPhotoSchema, data),
  sessionContainerShare: (data: unknown) =>
    zodValidate(sessionContainerShareSchema, data),
  sessionContainerClose: (data: unknown) =>
    zodValidate(sessionContainerCloseSchema, data),
  // always-valid passthrough: GET_MY REQUEST = `{ cursor?; take? } | undefined`, the
  // original validated NOTHING (returned __isValid:true bez checków). No witness — there
  // is no schema to bind, and forcing zod here would invent constraints the original
  // never enforced.
  sessionContainerGetMy: (_data: unknown) => ({
    __isValid: true,
    __general: '',
  }),
  sessionContainerSetNote: (data: unknown) =>
    zodValidate(sessionContainerSetNoteSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per domain; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
// sessionContainerGetMy is omitted (always-valid passthrough — see note above).
export type SessionContainerRequestSchemaBindings = {
  sessionContainerCreate: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sessionContainerCreateSchema>,
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['REQUEST']
    >
  >;
  sessionContainerAddPhoto: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sessionContainerAddPhotoSchema>,
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['REQUEST']
    >
  >;
  sessionContainerShare: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sessionContainerShareSchema>,
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['REQUEST']
    >
  >;
  sessionContainerClose: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sessionContainerCloseSchema>,
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['REQUEST']
    >
  >;
  sessionContainerSetNote: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof sessionContainerSetNoteSchema>,
      SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SET_NOTE']['REQUEST']
    >
  >;
};
