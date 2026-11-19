import { defineContracts } from '../../application/contracts/contract.types';
import { QUERY_FIELD } from '../../application/contracts/query-fields';
import {
  messagingOpenSchema,
  messagingContactSchema,
  messagingContactResultSchema,
  messagingConversationsSchema,
  messagingHiddenSchema,
  messagingHideConversationSchema,
  messagingMarkedReadSchema,
  messagingMarkReadSchema,
  messagingSendSchema,
  messagingSentSchema,
  messagingThreadSchema,
  messagingUnhiddenSchema,
  messagingUnhideConversationSchema,
} from './messaging.contract-schemas';

/**
 * Messaging endpoints. Every operation is any logged-in role. Command bodies are the schemas
 * the kernel validators already enforced. GET stays lenient: an empty, missing or repeated
 * pair_id is not a 400 (the handler still passes '' and the operation answers pair-not-found).
 * `hidden` selects the hidden list only when the decoded value is exactly true.
 */

export const MESSAGING_CONTRACTS = defineContracts({
  MESSAGING_END_CONTACT: {
    summary: 'Kończy kontakt, zachowując historię rozmowy.',
    group: 'MESSAGING',
    kind: 'COMMAND',
    path: 'messaging/end-contact',
    method: 'POST',
    body: messagingContactSchema,
    query: null,
    response: messagingContactResultSchema,
    successEvents: ['MESSAGING_CONTACT_ENDED'],
    auditEvents: ['MESSAGING_CONTACT_ENDED'],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  MESSAGING_OPEN: {
    summary: 'Otwiera bezpłatny kontakt ze stylistką bez wysyłania wiadomości.',
    group: 'MESSAGING',
    kind: 'COMMAND',
    path: 'messaging/open',
    method: 'POST',
    body: messagingOpenSchema,
    query: null,
    response: messagingContactResultSchema,
    successEvents: ['MESSAGING_OPENED'],
    auditEvents: ['MESSAGING_OPENED'],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  MESSAGING_SEND: {
    summary: 'Wysyła wiadomość w rozmowie pary i zwraca utworzoną wiadomość.',
    group: 'MESSAGING',
    kind: 'COMMAND',
    path: 'messaging/send',
    method: 'POST',
    body: messagingSendSchema,
    query: null,
    response: messagingSentSchema,
    successEvents: ['MESSAGING_MESSAGE_SENT'],
    auditEvents: ['MESSAGING_MESSAGE_SENT'],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  MESSAGING_MARK_READ: {
    summary:
      'Oznacza wątek pary jako przeczytany po stronie zalogowanej osoby.',
    group: 'MESSAGING',
    kind: 'COMMAND',
    path: 'messaging/mark-read',
    method: 'POST',
    body: messagingMarkReadSchema,
    query: null,
    response: messagingMarkedReadSchema,
    successEvents: ['MESSAGING_MARKED_READ'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  MESSAGING_HIDE_CONVERSATION: {
    summary:
      'Ukrywa rozmowę tylko po stronie zalogowanej osoby i zwraca czas ukrycia.',
    group: 'MESSAGING',
    kind: 'COMMAND',
    path: 'messaging/hide',
    method: 'POST',
    body: messagingHideConversationSchema,
    query: null,
    response: messagingHiddenSchema,
    successEvents: ['MESSAGING_CONVERSATION_HIDDEN'],
    auditEvents: ['MESSAGING_CONVERSATION_HIDDEN'],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  MESSAGING_UNHIDE_CONVERSATION: {
    summary: 'Przywraca ukrytą rozmowę po stronie zalogowanej osoby.',
    group: 'MESSAGING',
    kind: 'COMMAND',
    path: 'messaging/unhide',
    method: 'POST',
    body: messagingUnhideConversationSchema,
    query: null,
    response: messagingUnhiddenSchema,
    successEvents: ['MESSAGING_CONVERSATION_UNHIDDEN'],
    auditEvents: ['MESSAGING_CONVERSATION_UNHIDDEN'],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  MESSAGING_GET_THREAD: {
    summary:
      'Zwraca wiadomości jednego wątku od najstarszej oraz nagłówek rozmowy (query pair_id).',
    group: 'MESSAGING',
    kind: 'QUERY',
    path: 'messaging/thread',
    method: 'GET',
    body: null,
    query: {
      pair_id: QUERY_FIELD.string(),
      cursor: QUERY_FIELD.string(),
    },
    response: messagingThreadSchema,
    successEvents: ['MESSAGING_THREAD_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  MESSAGING_GET_CONVERSATIONS: {
    summary:
      'Zwraca listę rozmów zalogowanej osoby, a parametr hidden równy true pokazuje tylko ukryte.',
    group: 'MESSAGING',
    kind: 'QUERY',
    path: 'messaging/conversations',
    method: 'GET',
    body: null,
    query: {
      cursor: QUERY_FIELD.string(),
      hidden: QUERY_FIELD.bool(),
    },
    response: messagingConversationsSchema,
    successEvents: ['MESSAGING_CONVERSATIONS_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },
});

export type MessagingContracts = typeof MESSAGING_CONTRACTS;
