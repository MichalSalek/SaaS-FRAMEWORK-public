// domain/session-container/sessionContainerIO.possibilities.api.ts
// IO functions for Session Container API (R8).
// Stack: unified promise-first front-door (`defineEndpoint` / `defineQuery`) +
// CQRS ENDPOINTS.
//
// FDX FAZA 2 (W2.2/W2.3): domena `session-container` zmigrowana — każdy `_IO`
// zwraca teraz `Promise<Res>`, hooki wołają go bezpośrednio (bez `toPromise`).
// Nazwy `_IO` zachowane. Patrz DECISION w `application/http/io.ts`.

import { defineEndpoint, defineQuery } from '../../application/http/io';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import { ENDPOINTS } from '../../application/http/http.endpoints';

export const getMySessionContainers_IO = defineQuery<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_MY']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_MY']['RESPONSE'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_MY']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SESSION_CONTAINER_GET_MY,
  queryFields: req => ({
    cursor: req?.cursor,
    take: req?.take,
  }),
});

export const createSessionContainer_IO = defineEndpoint<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['RESPONSE'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SESSION_CONTAINER_CREATE,
  mode: 'post',
});

export const getSessionContainerById_IO = defineQuery<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_BY_ID']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_BY_ID']['RESPONSE'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_BY_ID']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SESSION_CONTAINER_GET_BY_ID,
  queryFields: req => ({ session_id: req.session_id }),
});

export const shareSessionContainer_IO = defineEndpoint<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['RESPONSE'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SESSION_CONTAINER_SHARE,
  mode: 'post',
});

export const closeSessionContainer_IO = defineEndpoint<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['RESPONSE'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SESSION_CONTAINER_CLOSE,
  mode: 'post',
});

export const setSessionContainerNote_IO = defineEndpoint<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SET_NOTE']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SET_NOTE']['RESPONSE'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SET_NOTE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SESSION_CONTAINER_SET_NOTE,
  mode: 'post',
});

export const addPhotoToSessionContainer_IO = defineEndpoint<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['RESPONSE'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SESSION_CONTAINER_ADD_PHOTO,
  mode: 'post',
});
