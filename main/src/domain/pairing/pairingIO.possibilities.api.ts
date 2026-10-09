import { defineEndpoint, defineQuery } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';

// FDX FAZA 2 (W2.2/W2.3): domena `pairing` zmigrowana na unified promise-first
// front-door (`defineEndpoint`/`defineQuery`). Każda funkcja zwraca `Promise<Res>` —
// hooki wołają ją bezpośrednio (bez `toPromise` przy call-site).
// Stały-only (2026-07-12): klienty issue/claim/revoke sesyjnych kodów usunięte
// razem z UI generowania — backendowe endpointy zostają jako legacy
// (nieeksponowane; ewentualne wycięcie osobną decyzją po becie).
// Patrz DECISION w `application/http/io.ts`.

export const pairingRevokeAccess = defineEndpoint<
  PAIRING_DTO_API_V1['PAIRING_ACCESS_REVOKE']['REQUEST'],
  PAIRING_DTO_API_V1['PAIRING_ACCESS_REVOKE']['RESPONSE'],
  PAIRING_DTO_API_V1['PAIRING_ACCESS_REVOKE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.PAIRING_ACCESS_REVOKE,
  mode: 'post',
});

export const pairingGetAccessStatus = defineQuery<
  PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['REQUEST'],
  PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['RESPONSE'],
  PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.PAIRING_GET_ACCESS_STATUS,
  queryFields: req => ({ stylist_account_id: req.stylist_account_id }),
});

export const pairingGetMyPairs = defineQuery<
  PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['REQUEST'],
  PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE'],
  PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.PAIRING_GET_MY_PAIRS,
  queryFields: req => ({
    cursor: req?.cursor,
    take: req?.take,
  }),
});

// Stały kod QR (2026-07-11): prośba o połączenie z publicznego profilu
// (klientka) + odpowiedź i lista próśb PENDING (stylistka).
export const pairRequestCreate = defineEndpoint<
  PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['REQUEST'],
  PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['RESPONSE'],
  PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.PAIR_REQUEST_CREATE,
  mode: 'post',
});

export const pairRequestRespond = defineEndpoint<
  PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['REQUEST'],
  PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['RESPONSE'],
  PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.PAIR_REQUEST_RESPOND,
  mode: 'post',
});

// O1: klientka wycofuje własną prośbę PENDING.
export const pairRequestCancel = defineEndpoint<
  PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['REQUEST'],
  PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['RESPONSE'],
  PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.PAIR_REQUEST_CANCEL,
  mode: 'post',
});

export const pairingGetPendingRequests = defineQuery<
  PAIRING_DTO_API_V1['PAIRING_GET_PENDING_REQUESTS']['REQUEST'],
  PAIRING_DTO_API_V1['PAIRING_GET_PENDING_REQUESTS']['RESPONSE'],
  PAIRING_DTO_API_V1['PAIRING_GET_PENDING_REQUESTS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.PAIRING_GET_PENDING_REQUESTS,
  queryFields: () => ({}),
});
