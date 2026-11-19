import { z } from 'zod';
import { wireInstant } from '../../application/contracts/wire-values';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import {
  PairingStatusValue,
  StylistClientMessageSenderValue,
} from '../../models/db_models.generated.dto';
import { MESSAGING_LENGTHS } from '../../policies/validation.config';
import {
  countCodePoints,
  hasUnpairedSurrogate,
  parsePgSafeDate,
} from '../../policies/validation/validation.utils';

const V = VALIDATION_MESSAGES;

// Message content: non-empty after trim (MIN=1, so blank == required, no separate
// "tooShort"), length in CODE POINTS <= MAX (see the DECISION at countCodePoints), an
// unpaired surrogate is REJECTED (not silently replaced with U+FFFD). One message per field
// (superRefine + return).
export const messageContent = z
  .string({ error: V.messaging.contentRequired })
  .superRefine((value, ctx) => {
    if (value.trim().length < MESSAGING_LENGTHS.CONTENT_MIN) {
      ctx.addIssue({ code: 'custom', message: V.messaging.contentRequired });
      return;
    }
    if (hasUnpairedSurrogate(value)) {
      ctx.addIssue({ code: 'custom', message: V.general.invalidCharacters });
      return;
    }
    if (countCodePoints(value) > MESSAGING_LENGTHS.CONTENT_MAX) {
      ctx.addIssue({ code: 'custom', message: V.messaging.contentTooLong });
    }
  });

const pairId = z
  .string({ error: V.messaging.pairIdRequired })
  .min(1, V.messaging.pairIdRequired);

export const messagingSendSchema = z.object({
  pair_id: pairId,
  content: messageContent,
});

export const messagingMarkReadSchema = z.object({
  pair_id: pairId,
  read_through: wireInstant
    .refine(value => parsePgSafeDate(value) !== null, {
      message: V.messaging.readThroughInvalid,
    })
    .optional(),
});

export const messagingOpenSchema = z.object({
  stylist_account_id: z.string().min(1),
});
export const messagingContactSchema = z.object({ pair_id: pairId });
export const messagingContactResultSchema = z.object({ pair_id: z.string() });

// Hide / restore a conversation: the same shape as mark-read (pair_id).
export const messagingHideConversationSchema = z.object({
  pair_id: pairId,
});

export const messagingUnhideConversationSchema = z.object({
  pair_id: pairId,
});

const pairingStatus = z.enum(PairingStatusValue);
const messageSender = z.enum(StylistClientMessageSenderValue);

export const messagingMessageSchema = z.object({
  id: z.string(),
  sender_type: messageSender,
  content: z.string(),
  created_at: wireInstant,
  kind: z
    .enum(['TEXT', 'SESSION_SUBMITTED', 'SESSION_ACCEPTED', 'SESSION_CHANGED'])
    .optional(),
  session_id: z.string().nullable().optional(),
  change_scope: z
    .enum(['PHOTOS', 'NOTE', 'PHOTOS_AND_NOTE'])
    .nullable()
    .optional(),
  event_key: z.string().nullable().optional(),
  activity_at: wireInstant.optional(),
  revision: z.number().int().positive().optional(),
  session_preview: z
    .object({ thumbnails: z.array(z.string()), remaining_count: z.number() })
    .nullable()
    .optional(),
});

const threadMetaSchema = z.object({
  pair_id: z.string(),
  status: pairingStatus,
  relationship_state: pairingStatus.optional(),
  counterpart_name: z.string(),
  counterpart_avatar_url: z.string().nullable(),
  viewer_side: messageSender,
  counterpart_stylist_id: z.string().nullable().optional(),
  can_send: z.boolean(),
  hidden_at: wireInstant.nullable(),
});

export const messagingThreadSchema = z.object({
  meta: threadMetaSchema,
  messages: z.array(messagingMessageSchema),
  next_cursor: z.string().nullable(),
  read_through: wireInstant.nullable().optional(),
});

export const messagingConversationsSchema = z.object({
  unread_count: z.number().int().nonnegative().optional(),
  unread_conversation_count: z.number().int().nonnegative().optional(),
  conversations: z.array(
    z.object({
      pair_id: z.string(),
      status: pairingStatus,
      relationship_state: pairingStatus.optional(),
      viewer_side: messageSender.optional(),
      counterpart_name: z.string(),
      counterpart_avatar_url: z.string().nullable(),
      last_message_preview: z.string().nullable(),
      last_message_at: wireInstant.nullable(),
      unread_count: z.number(),
      can_send: z.boolean(),
      hidden_at: wireInstant.nullable(),
    })
  ),
  next_cursor: z.string().nullable(),
});

export const messagingSentSchema = z.object({
  message: messagingMessageSchema,
});

export const messagingMarkedReadSchema = z.object({
  pair_id: z.string(),
  read_at: wireInstant,
});

export const messagingHiddenSchema = z.object({
  pair_id: z.string(),
  hidden_at: wireInstant,
});

export const messagingUnhiddenSchema = z.object({
  pair_id: z.string(),
});
