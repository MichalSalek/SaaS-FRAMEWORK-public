import { contractEndpoint } from '../../application/http/io';
import { MESSAGING_CONTRACTS } from '@kernel/domain/messaging/messaging.contracts';

// Every messaging call is derived from its kernel contract (URL, method, request and response).
// Per-call options (silentBusinessError, abort) stay on the promise function.
// The `_IO` names are kept for the existing hooks.
const C = MESSAGING_CONTRACTS;
export const openContact_IO = contractEndpoint(C.MESSAGING_OPEN, {
  errorFeedbackPolicy: 'background',
  successFeedback: 'silent',
});
export const endContact_IO = contractEndpoint(C.MESSAGING_END_CONTACT);

export const sendMessage_IO = contractEndpoint(C.MESSAGING_SEND);
export const markMessagesRead_IO = contractEndpoint(C.MESSAGING_MARK_READ);
export const getMessageThread_IO = contractEndpoint(C.MESSAGING_GET_THREAD);
export const getConversations_IO = contractEndpoint(
  C.MESSAGING_GET_CONVERSATIONS
);

// Hide / restore a conversation (on the caller's side only). Hiding an already hidden pair keeps
// the original timestamp and writes nothing.
// Test: web-1/src/domain/messaging/operations/messaging-write.operations.hidden.test.ts (covers
// 'hide again' and 'unhide when already null' with a mocked DB, one call after another; not two
// concurrent requests)
export const hideConversation_IO = contractEndpoint(
  C.MESSAGING_HIDE_CONVERSATION
);
export const unhideConversation_IO = contractEndpoint(
  C.MESSAGING_UNHIDE_CONVERSATION
);
