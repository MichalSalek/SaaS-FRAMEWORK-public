import { defineEndpoint, defineQuery } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import type { MESSAGING_DTO_API_V1 } from '@kernel/models/messaging/messaging.dto';

// Komunikator stylistka<->klientka — promise-first front-door (defineEndpoint/
// defineQuery). Nazwy _IO zachowane; hooki wołają bezpośrednio w queryFn/mutationFn.

export const sendMessage_IO = defineEndpoint<
  MESSAGING_DTO_API_V1['MESSAGING_SEND']['REQUEST'],
  MESSAGING_DTO_API_V1['MESSAGING_SEND']['RESPONSE'],
  MESSAGING_DTO_API_V1['MESSAGING_SEND']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.MESSAGING_SEND,
  mode: 'post',
});

export const markMessagesRead_IO = defineEndpoint<
  MESSAGING_DTO_API_V1['MESSAGING_MARK_READ']['REQUEST'],
  MESSAGING_DTO_API_V1['MESSAGING_MARK_READ']['RESPONSE'],
  MESSAGING_DTO_API_V1['MESSAGING_MARK_READ']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.MESSAGING_MARK_READ,
  mode: 'post',
});

export const getMessageThread_IO = defineQuery<
  MESSAGING_DTO_API_V1['MESSAGING_GET_THREAD']['REQUEST'],
  MESSAGING_DTO_API_V1['MESSAGING_GET_THREAD']['RESPONSE'],
  MESSAGING_DTO_API_V1['MESSAGING_GET_THREAD']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.MESSAGING_GET_THREAD,
  queryFields: req => ({
    pair_id: req.pair_id,
    cursor: 'cursor' in req ? req.cursor : undefined,
  }),
});

export const getConversations_IO = defineQuery<
  MESSAGING_DTO_API_V1['MESSAGING_GET_CONVERSATIONS']['REQUEST'],
  MESSAGING_DTO_API_V1['MESSAGING_GET_CONVERSATIONS']['RESPONSE'],
  MESSAGING_DTO_API_V1['MESSAGING_GET_CONVERSATIONS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.MESSAGING_GET_CONVERSATIONS,
  // `hidden` idzie na drut TYLKO jako 'true' (backend qBool czyta 'true'/'false');
  // brak parametru = lista domyślna (widoczne).
  queryFields: req => ({
    cursor: 'cursor' in req ? req.cursor : undefined,
    hidden: req.hidden === true ? 'true' : undefined,
  }),
});

// D2: ukryj / przywróć rozmowę (po stronie wołającego, idempotentne).
export const hideConversation_IO = defineEndpoint<
  MESSAGING_DTO_API_V1['MESSAGING_HIDE_CONVERSATION']['REQUEST'],
  MESSAGING_DTO_API_V1['MESSAGING_HIDE_CONVERSATION']['RESPONSE'],
  MESSAGING_DTO_API_V1['MESSAGING_HIDE_CONVERSATION']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.MESSAGING_HIDE_CONVERSATION,
  mode: 'post',
});

export const unhideConversation_IO = defineEndpoint<
  MESSAGING_DTO_API_V1['MESSAGING_UNHIDE_CONVERSATION']['REQUEST'],
  MESSAGING_DTO_API_V1['MESSAGING_UNHIDE_CONVERSATION']['RESPONSE'],
  MESSAGING_DTO_API_V1['MESSAGING_UNHIDE_CONVERSATION']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.MESSAGING_UNHIDE_CONVERSATION,
  mode: 'post',
});
