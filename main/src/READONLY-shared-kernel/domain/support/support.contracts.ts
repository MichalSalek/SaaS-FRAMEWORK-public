import { defineContracts } from '../../application/contracts/contract.types';
import { QUERY_FIELD } from '../../application/contracts/query-fields';
import {
  adminSupportReplySchema,
  adminThreadMessagesSchema,
  adminThreadPageSchema,
  addSupportMessageSchema,
  changeSupportStatusSchema,
  createSupportThreadSchema,
  markSupportThreadReadSchema,
  messageIdSchema,
  statusChangedSchema,
  supportCategoryFilterValues,
  supportStatusValues,
  threadIdSchema,
  unreadCountSchema,
  userThreadMessagesSchema,
  userThreadPageSchema,
} from './support.contract-schemas';

/**
 * Support endpoints. User operations are any logged-in role; admin operations are the admin
 * wildcard (no role-layer grant). Request bodies are the schemas the kernel validators already
 * enforced. GET filters stay lenient: a bad value is dropped or falls back, it is not a 400,
 * except a missing thread id, which the handler still rejects with `{ thread_id: 'Required' }`.
 */

const page = (take: number) => ({
  cursor: QUERY_FIELD.string(),
  take: QUERY_FIELD.int(take),
});

const threadIdQuery = {
  thread_id: QUERY_FIELD.requiredString(),
};

export const SUPPORT_CONTRACTS = defineContracts({
  SUPPORT_CREATE_THREAD: {
    summary:
      'Zgłoszenie wsparcia (kategoria i pierwsza wiadomość). Temat wątku wylicza serwer. Zwraca thread_id.',
    group: 'SUPPORT',
    kind: 'COMMAND',
    path: 'support/create-thread',
    method: 'POST',
    body: createSupportThreadSchema,
    query: null,
    response: threadIdSchema,
    successEvents: ['SUPPORT_THREAD_CREATED'],
    auditEvents: ['SUPPORT_THREAD_CREATED'],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  SUPPORT_ADD_MESSAGE: {
    summary:
      'Dopisuje wiadomość zalogowanej osoby do jej wątku. Zwraca message_id.',
    group: 'SUPPORT',
    kind: 'COMMAND',
    path: 'support/add-message',
    method: 'POST',
    body: addSupportMessageSchema,
    query: null,
    response: messageIdSchema,
    successEvents: ['SUPPORT_MESSAGE_SENT'],
    auditEvents: ['SUPPORT_MESSAGE_SENT'],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  SUPPORT_GET_MY_THREADS: {
    summary:
      'Wątki wsparcia zalogowanej osoby, stronicowane (cursor, take; domyślnie 20).',
    group: 'SUPPORT',
    kind: 'QUERY',
    path: 'support/my-threads',
    method: 'GET',
    body: null,
    query: page(20),
    response: userThreadPageSchema,
    successEvents: ['SUPPORT_THREADS_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  SUPPORT_GET_THREAD_MESSAGES: {
    summary:
      'Wiadomości i nagłówek jednego wątku zalogowanej osoby (query thread_id).',
    group: 'SUPPORT',
    kind: 'QUERY',
    path: 'support/thread-messages',
    method: 'GET',
    body: null,
    query: threadIdQuery,
    response: userThreadMessagesSchema,
    successEvents: ['SUPPORT_MESSAGES_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  SUPPORT_GET_UNREAD_COUNT: {
    summary:
      'Liczba własnych wątków z odpowiedzią, której właścicielka jeszcze nie otworzyła.',
    group: 'SUPPORT',
    kind: 'QUERY',
    path: 'support/unread-count',
    method: 'GET',
    body: null,
    query: null,
    response: unreadCountSchema,
    successEvents: ['SUPPORT_UNREAD_COUNT_FETCHED'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  SUPPORT_MARK_THREAD_READ: {
    summary:
      'Oznacza własny wątek jako przeczytany. Cudzy lub nieistniejący wątek to 404.',
    group: 'SUPPORT',
    kind: 'COMMAND',
    path: 'support/mark-thread-read',
    method: 'POST',
    body: markSupportThreadReadSchema,
    query: null,
    response: threadIdSchema,
    successEvents: ['SUPPORT_THREAD_MARKED_READ'],
    auditEvents: [],
    access: 'LOGGED_IN',
    authCheck: true,
    limiterTier: 'default',
  },

  SUPPORT_ADMIN_GET_ALL_THREADS: {
    summary:
      'Lista wątków dla admina (status, kategoria, „czeka na odpowiedź”, cursor, take).',
    group: 'SUPPORT',
    kind: 'QUERY',
    path: 'admin/support/threads',
    method: 'GET',
    body: null,
    query: {
      status: QUERY_FIELD.oneOf(supportStatusValues),
      category: QUERY_FIELD.oneOf(supportCategoryFilterValues),
      awaiting_reply: QUERY_FIELD.bool(),
      cursor: QUERY_FIELD.string(),
      take: QUERY_FIELD.int(50),
    },
    response: adminThreadPageSchema,
    successEvents: ['SUPPORT_ADMIN_THREADS_FETCHED'],
    auditEvents: [],
    access: 'ADMIN',
    authCheck: true,
    limiterTier: 'default',
  },

  SUPPORT_ADMIN_GET_THREAD_MESSAGES: {
    summary:
      'Wiadomości wątku dla admina, z tokenem updated_at i danymi autorki.',
    group: 'SUPPORT',
    kind: 'QUERY',
    path: 'admin/support/thread-messages',
    method: 'GET',
    body: null,
    query: threadIdQuery,
    response: adminThreadMessagesSchema,
    successEvents: ['SUPPORT_ADMIN_MESSAGES_FETCHED'],
    auditEvents: [],
    access: 'ADMIN',
    authCheck: true,
    limiterTier: 'default',
  },

  SUPPORT_ADMIN_REPLY: {
    summary:
      'Odpowiedź admina w wątku. Informuje właścicielkę. Zwraca message_id.',
    group: 'SUPPORT',
    kind: 'COMMAND',
    path: 'admin/support/reply',
    method: 'POST',
    body: adminSupportReplySchema,
    query: null,
    response: messageIdSchema,
    successEvents: ['SUPPORT_ADMIN_REPLIED'],
    auditEvents: ['SUPPORT_ADMIN_REPLIED'],
    access: 'ADMIN',
    authCheck: true,
    limiterTier: 'default',
  },

  SUPPORT_CHANGE_STATUS: {
    summary:
      'Zmiana statusu wątku. expected_updated_at odrzuca zamknięcie po świeżej odpowiedzi (409).',
    group: 'SUPPORT',
    kind: 'COMMAND',
    path: 'admin/support/change-status',
    method: 'POST',
    body: changeSupportStatusSchema,
    query: null,
    response: statusChangedSchema,
    successEvents: ['SUPPORT_STATUS_CHANGED'],
    auditEvents: ['SUPPORT_STATUS_CHANGED'],
    access: 'ADMIN',
    authCheck: true,
    limiterTier: 'default',
  },
});

export type SupportContracts = typeof SUPPORT_CONTRACTS;
