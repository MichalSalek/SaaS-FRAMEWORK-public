import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import { VALIDATION_LENGTHS } from '../../policies/validation.config';

const V = VALIDATION_MESSAGES;

// Claim measures length on the TRIMMED token, and only after a non-empty raw string.
// '' is required-only. Whitespace-only trims to 0 and is invalidFormat. A padded
// token of TOKEN_MIN still passes. Revoke does not apply TOKEN_MIN/MAX.
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

export const pairingClaimSessionSchema = z.object({
  token: claimTokenField,
});

export const pairingRevokeSessionSchema = z.object({
  token: z.string({ error: V.token.required }).min(1, V.token.required),
});

// Both targets are optional strings. A truthy non-string fails on its own field.
// Both absent or both '' fail on __general (path-less issue). A truthy non-string
// leaves __general clean because the presence guard already passed.
export const pairingRevokeAccessSchema = z
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

// Upper bound: VALIDATION_LENGTHS.ENTITY_ID_MAX. Real ids are cuid/uuid; the cap
// stops an oversized string from reaching a key lookup.
const entityId = z
  .string({ error: V.pairing.idRequired })
  .min(1, V.pairing.idRequired)
  .max(VALIDATION_LENGTHS.ENTITY_ID_MAX, V.pairing.idRequired);

/**
 * Body shape of the unused kernel validator for GET access status. The live route
 * reads `stylist_account_id` from the query and answers `{ stylist_account_id: 'Required' }`
 * when it is missing. Wiring this schema would swap that literal for an i18n token.
 */
export const pairingGetAccessStatusSchema = z.object({
  stylist_account_id: entityId,
});

export const PAIR_REQUEST_PLACE_MAX = 60;
export const PAIR_REQUEST_NOTE_MAX = 140;

const hasControlChar = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
};

/** Optional request text: trim, reject control characters, cap the length. Empty becomes omitted. */
const optionalPairText = (max: number, tooLong: string) =>
  z
    .string({ error: V.general.fieldRequired })
    .nullable()
    .optional()
    .superRefine((value, ctx) => {
      if (value == null) {
        return;
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return;
      }
      if (hasControlChar(trimmed)) {
        ctx.addIssue({
          code: 'custom',
          message: V.general.invalidCharacters,
        });
      }
      if (trimmed.length > max) {
        ctx.addIssue({ code: 'custom', message: tooLong });
      }
    })
    .transform(value => {
      if (value == null) {
        return undefined;
      }
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    });

export const pairRequestCreateSchema = z.object({
  stylist_account_id: entityId,
  place: optionalPairText(PAIR_REQUEST_PLACE_MAX, V.name.tooLong),
  note: optionalPairText(PAIR_REQUEST_NOTE_MAX, V.sessionContainer.noteTooLong),
});

const coordinate = (min: number, max: number) =>
  z
    .number({ error: V.general.fieldRequired })
    .min(min, V.general.fieldRequired)
    .max(max, V.general.fieldRequired);

export const pairingResolvePlaceSchema = z.object({
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
});

export const pairingResolvePlaceResponseSchema = z.object({
  place: z.string().nullable(),
});

export const pairRequestCancelSchema = z.object({
  stylist_account_id: entityId,
});

export const pairRequestRespondSchema = z.object({
  pair_id: entityId,
  action: z.enum(['ACCEPT', 'DECLINE'], { error: V.pairing.idRequired }),
});

/** Command with no fields. A missing body parses as {}. Unknown keys are stripped. */
export const emptyCommandBody = z.object({});

const successFlag = z.object({ success: z.boolean() });

export const issuedSessionSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
  stylist_account_id: z.string(),
});

export const claimedSessionSchema = z.object({
  success: z.boolean(),
  stylist_account_id: z.string(),
  display_name: z.string().nullable(),
  message: z.string(),
});

export const revokedCountSchema = z.object({
  revoked_count: z.number(),
});

export const accessStatusSchema = z.union([
  z.object({
    access: z.literal('PUBLIC'),
    // Absent on this branch. Callers read `pair_id` on the whole union (PUBLIC has none).
    pair_id: z.string().nullable().optional(),
  }),
  z.object({
    access: z.literal('PENDING'),
    pair_id: z.string(),
  }),
  z.object({
    access: z.literal('PAIRED'),
    paired_at: z.string(),
    pair_id: z.string(),
  }),
]);

export const pairRequestCreatedSchema = z.object({
  status: z.enum(['PENDING', 'ALREADY_PAIRED']),
  display_name: z.string().nullable(),
  created: z.boolean(),
  pair_id: z.string().nullable(),
});

export const pairRequestRespondedSchema = z.object({
  success: z.boolean(),
  status: z.enum(['ACTIVE', 'DECLINED']),
});

export const pendingRequestsSchema = z.object({
  requests: z.array(
    z.object({
      pair_id: z.string(),
      name: z.string(),
      requested_at: z.string(),
      avatar_url: z.string().nullable(),
      place: z.string().nullable(),
      note: z.string().nullable(),
    })
  ),
});

export const myPendingRequestsSchema = z.object({
  requests: z.array(
    z.object({
      pair_id: z.string(),
      stylist_account_id: z.string(),
      display_name: z.string().nullable(),
      avatar_url: z.string().nullable(),
      requested_at: z.string(),
    })
  ),
});

const pairSeenByStylist = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  email: z.string(),
  paired_at: z.string(),
  counterpart_inactive: z.boolean(),
});

const pairSeenByClient = z.object({
  id: z.string(),
  account_id: z.string(),
  salon_origin_account_id: z.string().nullable().optional(),
  display_name: z.string().nullable(),
  business_name: z.string().nullable(),
  address_city: z.string().nullable(),
  avatar_url: z.string().nullable(),
  paired_at: z.string(),
  counterpart_inactive: z.boolean(),
});

const salonGroupSchema = z.object({
  account_id: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  members: z.array(
    z.object({
      account_id: z.string(),
      name: z.string(),
      avatar_url: z.string().nullable(),
      pair_id: z.string().nullable(),
    })
  ),
});

export const myPairsSchema = z.object({
  pairs: z.array(z.union([pairSeenByStylist, pairSeenByClient])),
  nextCursor: z.string().nullable(),
  salons: z.array(salonGroupSchema).optional(),
});

export const revokeSuccessSchema = successFlag;
export const cancelRequestSchema = successFlag;
