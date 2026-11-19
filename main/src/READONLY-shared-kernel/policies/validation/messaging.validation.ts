import type { z } from 'zod';
import type { MESSAGING_DTO_API_V1 } from '../../models/messaging/messaging.dto';
import {
  messageContent,
  messagingHideConversationSchema,
  messagingMarkReadSchema,
  messagingSendSchema,
  messagingUnhideConversationSchema,
} from '../../domain/messaging/messaging.contract-schemas';
import {
  zodValidate,
  type AssertTrue,
  type SchemaMatchesDto,
} from './validation.zod';

export { messageContent };

// DECISION: MESSAGING_GET_THREAD has no body schema. pair_id and cursor are query fields on
// the contract; a body validator 400ed every GET because the body is {}. An empty pair_id is
// still passed as '' and the operation answers MESSAGING_PAIR_NOT_FOUND.
// Test: web-1/src/test-utils/integration/messaging-contract.test.ts (empty or repeated
// pair_id is not a 400; a foreign id is the operation's 404, not covered here).

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
