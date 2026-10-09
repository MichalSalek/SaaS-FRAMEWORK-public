import { z } from 'zod';
import { VALIDATION_MESSAGES } from '../../domain/i18n/validation.i18n';
import type { MESSAGING_DTO_API_V1 } from '../../models/messaging/messaging.dto';
import { MESSAGING_LENGTHS } from '../validation.config';
import { countCodePoints, hasUnpairedSurrogate } from './validation.utils';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

const V = VALIDATION_MESSAGES;

// Treść wiadomości: niepusta po trim (MIN=1 → blank == required, brak osobnego
// "tooShort"), długość w PUNKTACH KODOWYCH <= MAX (D5, DECISION przy
// countCodePoints), osierocony surogat ODRZUCANY (nie zamieniany po cichu na
// U+FFFD). Jeden komunikat na pole (superRefine + return).
const messageContent = z
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

const messagingSendSchema = z.object({
  pair_id: pairId,
  content: messageContent,
});

const messagingMarkReadSchema = z.object({
  pair_id: pairId,
});

// D2: ukryj / przywróć rozmowę — ten sam kształt co mark-read (pair_id).
const messagingHideConversationSchema = z.object({
  pair_id: pairId,
});

const messagingUnhideConversationSchema = z.object({
  pair_id: pairId,
});

// DECISION (nie usuwaj tego komentarza):
// MESSAGING_GET_THREAD celowo NIE ma walidatora zod — to GET, którego pair_id/
// cursor są w query-stringu, nie w body (dla GET body = {} po coalesce w
// middleware). Realny walidator na body dawał 400 na KAŻDY request (closing-
// review HIGH). Handler używa passthrough `() => ({__isValid:true})`; pair_id
// gejtowany downstream (qStr + resolvePairSide → MESSAGING_PAIR_NOT_FOUND).

export const messagingValidators = {
  messagingSend: (data: unknown) => zodValidate(messagingSendSchema, data),
  messagingMarkRead: (data: unknown) =>
    zodValidate(messagingMarkReadSchema, data),
  messagingHideConversation: (data: unknown) =>
    zodValidate(messagingHideConversationSchema, data),
  messagingUnhideConversation: (data: unknown) =>
    zodValidate(messagingUnhideConversationSchema, data),
} as const;

// ── Compile-time REQUEST-DTO ↔ schema binding (drift stops compilation) ──
export type MessagingRequestSchemaBindings = {
  messagingSend: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof messagingSendSchema>,
      MESSAGING_DTO_API_V1['MESSAGING_SEND']['REQUEST']
    >
  >;
  messagingMarkRead: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof messagingMarkReadSchema>,
      MESSAGING_DTO_API_V1['MESSAGING_MARK_READ']['REQUEST']
    >
  >;
  messagingHideConversation: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof messagingHideConversationSchema>,
      MESSAGING_DTO_API_V1['MESSAGING_HIDE_CONVERSATION']['REQUEST']
    >
  >;
  messagingUnhideConversation: AssertTrue<
    SchemaMatchesDto<
      z.infer<typeof messagingUnhideConversationSchema>,
      MESSAGING_DTO_API_V1['MESSAGING_UNHIDE_CONVERSATION']['REQUEST']
    >
  >;
};
