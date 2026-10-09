import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { PAIRING_DTO_API_V1 } from '../../models/pairing/pairing.dto';
import { VALIDATION_LENGTHS } from '../validation.config';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// pairingClaimSession.token — the original gated the length checks behind an `else` to
// a truthy-non-empty-string branch, and measured length on the TRIMMED token:
//   - missing / non-string / '' (falsy)             → token.required
//   - non-empty string, trimmed length < TOKEN_MIN  → token.invalidFormat
//   - non-empty string, trimmed length > TOKEN_MAX  → token.tooLong
// Reproduced 1:1: `z.string(required).min(1, required)` covers the falsy/non-string cases
// (incl. '' → required), and `superRefine` runs the trimmed-length checks ONLY for a
// raw-non-empty string (the `value.length === 0` guard mirrors the original's truthy
// `else`, so '' yields required-only — NOT required+invalidFormat — while whitespace-only
// '   ' still trims to 0 < TOKEN_MIN → invalidFormat, exactly as the hand-written
// validator did). Same trimmed-length idiom as email.validation.ts confirmationTokenField.
const claimTokenField = z
  .string({ error: V.token.required })
  .min(1, V.token.required)
  .superRefine((value, ctx) => {
    if (value.length === 0) {
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length < VALIDATION_LENGTHS.TOKEN_MIN) {
      ctx.addIssue({ code: 'custom', message: V.token.invalidFormat });
    }
    if (trimmed.length > VALIDATION_LENGTHS.TOKEN_MAX) {
      ctx.addIssue({ code: 'custom', message: V.token.tooLong });
    }
  });

const pairingClaimSessionSchema = z.object({
  token: claimTokenField,
});

// pairingRevokeSession.token — presence + string type only (NO TOKEN_MIN/MAX length
// check, unlike claim). Original: `!token || typeof token !== 'string'` → token.required.
// `z.string(required).min(1, required)` covers the falsy ('' incl.) / non-string cases.
const pairingRevokeSessionSchema = z.object({
  token: z.string({ error: V.token.required }).min(1, V.token.required),
});

// pairingRevokeAccess — both targets OPTIONAL strings; the original split the logic:
//   1) cross-field presence: `!target_user_id && !target_account_id` → __general
//      `pairing.targetRequired` (empty-string counts as ABSENT — both are falsy).
//   2) per-field type: a TRUTHY non-string target → `invalidUserId` / `invalidAccountId`
//      on its own field; a falsy target ('' etc.) skips the type check.
// Mapping to zod: each field is `z.string({error}).optional()` — this surfaces the
// per-field type error for a non-string input (truthy non-string → the field's
// invalid*Id message) and binds `z.infer == DTO` (`string | undefined`). The cross-field
// presence rule lives in `.superRefine` on the object, reading the RAW field values
// (when a field fails the type check, `val.<field>` still holds the raw input — same
// idiom as admin-runtime-config.validation.ts), so the truthiness guard matches the
// original exactly: a truthy non-string (e.g. 123) leaves __general clean (the presence
// guard passed), while both-absent / both-empty-string fire targetRequired on __general
// (path-less issue → __general slot in zodValidate).
const pairingRevokeAccessSchema = z
  .object({
    target_user_id: z.string({ error: V.pairing.invalidUserId }).optional(),
    target_account_id: z
      .string({ error: V.pairing.invalidAccountId })
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.target_user_id && !val.target_account_id) {
      ctx.addIssue({ code: 'custom', message: V.pairing.targetRequired });
    }
  });

// pairingGetAccessStatus.stylist_account_id — required string. Original:
// `!stylist_account_id || typeof !== 'string'` → pairing.idRequired (covers falsy '' +
// non-string). `z.string(idRequired).min(1, idRequired)`.
const pairingGetAccessStatusSchema = z.object({
  stylist_account_id: z
    .string({ error: V.pairing.idRequired })
    .min(1, V.pairing.idRequired)
    // Górna granica identyfikatora — patrz WHY przy ENTITY_ID_MAX.
    .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.pairing.idRequired),
});

// pairRequestCreate.stylist_account_id — required string (parytet z
// pairingGetAccessStatus: cel prośby wskazuje konto stylistki z profilu).
const pairRequestCreateSchema = z.object({
  stylist_account_id: z
    .string({ error: V.pairing.idRequired })
    .min(1, V.pairing.idRequired)
    // Górna granica identyfikatora — patrz WHY przy ENTITY_ID_MAX.
    .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.pairing.idRequired),
});

// pairRequestCancel.stylist_account_id — required string (parytet z create:
// klientka wskazuje konto stylistki, której WŁASNĄ prośbę PENDING wycofuje).
const pairRequestCancelSchema = z.object({
  stylist_account_id: z
    .string({ error: V.pairing.idRequired })
    .min(1, V.pairing.idRequired)
    // Górna granica identyfikatora — patrz WHY przy ENTITY_ID_MAX.
    .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.pairing.idRequired),
});

// pairRequestRespond — pair_id (cuid pary PENDING) + action z zamkniętego
// enuma ACCEPT/DECLINE (z.enum → nieznana wartość nie przechodzi).
const pairRequestRespondSchema = z.object({
  pair_id: z
    .string({ error: V.pairing.idRequired })
    .min(1, V.pairing.idRequired)
    // Górna granica identyfikatora — patrz WHY przy ENTITY_ID_MAX.
    .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.pairing.idRequired),
  action: z.enum(['ACCEPT', 'DECLINE'], { error: V.pairing.idRequired }),
});

export const pairingValidators = {
  pairingClaimSession: (data: unknown) =>
    zodValidate(pairingClaimSessionSchema, data),
  pairingRevokeSession: (data: unknown) =>
    zodValidate(pairingRevokeSessionSchema, data),
  pairingRevokeAccess: (data: unknown) =>
    zodValidate(pairingRevokeAccessSchema, data),
  pairingGetAccessStatus: (data: unknown) =>
    zodValidate(pairingGetAccessStatusSchema, data),
  pairRequestCreate: (data: unknown) =>
    zodValidate(pairRequestCreateSchema, data),
  pairRequestRespond: (data: unknown) =>
    zodValidate(pairRequestRespondSchema, data),
  pairRequestCancel: (data: unknown) =>
    zodValidate(pairRequestCancelSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
// One exported witness type per validator; each property fails to compile if the schema's
// inferred output drifts from its REQUEST DTO. Exported so it is never flagged unused.
export type PairingRequestSchemaBindings = {
  pairingClaimSession: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairingClaimSessionSchema>,
      PAIRING_DTO_API_V1['PAIRING_SESSION_CLAIM']['REQUEST']
    >
  >;
  pairingRevokeSession: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairingRevokeSessionSchema>,
      PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE']['REQUEST']
    >
  >;
  pairingRevokeAccess: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairingRevokeAccessSchema>,
      PAIRING_DTO_API_V1['PAIRING_ACCESS_REVOKE']['REQUEST']
    >
  >;
  pairingGetAccessStatus: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairingGetAccessStatusSchema>,
      PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['REQUEST']
    >
  >;
  pairRequestCreate: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairRequestCreateSchema>,
      PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['REQUEST']
    >
  >;
  pairRequestRespond: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairRequestRespondSchema>,
      PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['REQUEST']
    >
  >;
  pairRequestCancel: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof pairRequestCancelSchema>,
      PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['REQUEST']
    >
  >;
};
