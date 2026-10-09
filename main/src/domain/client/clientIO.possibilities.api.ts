import type { CLIENT_DTO_API_V1 } from '@kernel/models/client/client.dto';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import { defineEndpoint, defineQuery } from '../../application/http/io';

// FDX FAZA 2 (W2.2): domena `client` zmigrowana na unified promise-first
// front-door (`defineEndpoint` / `defineQuery`). Każdy `_IO` zwraca teraz
// `Promise<Res>` — hooki wołają go bezpośrednio (bez `toPromise` przy
// call-site). Side-effecty po odpowiedzi (cache-patch) w TanStack Query
// callbacks w hookach — patrz DECISION w `application/http/io.ts`. Nazwy `_IO` zachowane.

/**
 * Update client contact information
 */
export const updateClientContact_IO = defineEndpoint<
  CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['REQUEST'],
  CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['RESPONSE'],
  CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.CLIENT_UPDATE_CONTACT,
  mode: 'post',
});

/**
 * Get client profile (own profile) — GET, no body
 */
export const getClientProfile_IO = defineQuery<
  CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['REQUEST'],
  CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE'],
  CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.CLIENT_GET_PROFILE,
  queryFields: () => ({}),
});

/**
 * Get client contact for stylist (privacy-checked)
 */
export const getClientContactForStylist_IO = defineQuery<
  CLIENT_DTO_API_V1['CLIENT_GET_CONTACT_FOR_STYLIST']['REQUEST'],
  CLIENT_DTO_API_V1['CLIENT_GET_CONTACT_FOR_STYLIST']['RESPONSE'],
  CLIENT_DTO_API_V1['CLIENT_GET_CONTACT_FOR_STYLIST']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.CLIENT_GET_CONTACT_FOR_STYLIST,
  queryFields: req => ({ client_user_id: req.client_user_id }),
});
