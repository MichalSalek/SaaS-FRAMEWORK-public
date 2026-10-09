import { defineEndpoint, defineQuery } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';

// FDX FAZA 2 (W2.2/W2.3): domena `support` zmigrowana na unified promise-first
// front-door (`defineEndpoint` / `defineQuery`). Każdy `_IO` zwraca teraz
// `Promise<Res>` — hooki wołają go bezpośrednio (bez `toPromise` przy call-site).
// Side-effecty po odpowiedzi (cache-patch, invalidacje) przeniesione do TanStack
// Query callbacks w hookach — patrz DECISION w `application/http/io.ts`.
// Nazwy `_IO` zachowane.

// ── User: Create Thread ──

export const createSupportThread_IO = defineEndpoint<
  SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['RESPONSE'],
  SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SUPPORT_CREATE_THREAD,
  mode: 'post',
});

// ── User: Add Message ──

export const addSupportMessage_IO = defineEndpoint<
  SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['RESPONSE'],
  SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SUPPORT_ADD_MESSAGE,
  mode: 'post',
});

// ── User: Get My Threads (GET with optional cursor pagination) ──

export const getSupportThreads_IO = defineQuery<
  SUPPORT_DTO_API_V1['SUPPORT_GET_MY_THREADS']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_GET_MY_THREADS']['RESPONSE'],
  SUPPORT_DTO_API_V1['SUPPORT_GET_MY_THREADS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SUPPORT_GET_MY_THREADS,
  queryFields: req => ({
    cursor: 'cursor' in req ? req.cursor : undefined,
    take: 'take' in req ? req.take : undefined,
  }),
});

// ── User: Get Thread Messages (GET ?thread_id=) ──

export const getSupportThreadMessages_IO = defineQuery<
  SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['RESPONSE'],
  SUPPORT_DTO_API_V1['SUPPORT_GET_THREAD_MESSAGES']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SUPPORT_GET_THREAD_MESSAGES,
  queryFields: req => ({ thread_id: req.thread_id }),
});

// ── User: Unread Count (GET, no request) ──

export const getSupportUnreadCount_IO = defineEndpoint<
  SUPPORT_DTO_API_V1['SUPPORT_GET_UNREAD_COUNT']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_GET_UNREAD_COUNT']['RESPONSE'],
  SUPPORT_DTO_API_V1['SUPPORT_GET_UNREAD_COUNT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SUPPORT_GET_UNREAD_COUNT,
  mode: 'get',
});

// ── User: Mark Thread Read ──

export const markSupportThreadRead_IO = defineEndpoint<
  SUPPORT_DTO_API_V1['SUPPORT_MARK_THREAD_READ']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_MARK_THREAD_READ']['RESPONSE'],
  SUPPORT_DTO_API_V1['SUPPORT_MARK_THREAD_READ']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SUPPORT_MARK_THREAD_READ,
  mode: 'post',
});

// ── Admin: Get All Threads (GET with optional status filter + cursor pagination) ──

export const adminGetSupportThreads_IO = defineQuery<
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['RESPONSE'],
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SUPPORT_ADMIN_GET_ALL_THREADS,
  queryFields: req => ({
    status: req.status,
    category: req.category,
    awaiting_reply: req.awaiting_reply,
    cursor: req.cursor,
    take: req.take,
  }),
});

// ── Admin: Get Thread Messages (GET ?thread_id=) ──

export const adminGetSupportThreadMessages_IO = defineQuery<
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_THREAD_MESSAGES']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_THREAD_MESSAGES']['RESPONSE'],
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_THREAD_MESSAGES']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SUPPORT_ADMIN_GET_THREAD_MESSAGES,
  queryFields: req => ({ thread_id: req.thread_id }),
});

// ── Admin: Reply to Thread ──

export const adminReplyToSupportThread_IO = defineEndpoint<
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_REPLY']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_REPLY']['RESPONSE'],
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_REPLY']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SUPPORT_ADMIN_REPLY,
  mode: 'post',
});

// ── Change Thread Status ──

export const changeSupportThreadStatus_IO = defineEndpoint<
  SUPPORT_DTO_API_V1['SUPPORT_CHANGE_STATUS']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_CHANGE_STATUS']['RESPONSE'],
  SUPPORT_DTO_API_V1['SUPPORT_CHANGE_STATUS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SUPPORT_CHANGE_STATUS,
  mode: 'post',
});
