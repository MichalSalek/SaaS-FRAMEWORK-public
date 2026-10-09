// main/src/domain/admin/colors-traits/adminColorsTraitsIO.possibilities.api.ts
// IO functions for admin colors & traits management (frontend client).
// FDX FAZA 2 (W2.3): zmigrowane na unified promise-first front-door (`defineEndpoint`).
// Każdy `_IO` zwraca teraz `Promise<Res>` — hooki wołają go bezpośrednio
// (bez `toPromise` przy call-site). Nazwy `_IO` zachowane. Patrz DECISION w `application/http/io.ts`.

import { defineEndpoint } from '../../../application/http/io';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { ENDPOINTS } from '../../../application/http/http.endpoints';

export const createColor_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_CREATE_COLOR']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_CREATE_COLOR']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_CREATE_COLOR']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_CREATE_COLOR,
  mode: 'post',
});

export const updateColor_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_UPDATE_COLOR']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_COLOR']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_COLOR']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_UPDATE_COLOR,
  mode: 'post',
});

export const deleteColor_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_DELETE_COLOR']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_DELETE_COLOR']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_DELETE_COLOR']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_DELETE_COLOR,
  mode: 'post',
});

export const createTrait_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_CREATE_TRAIT']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_CREATE_TRAIT']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_CREATE_TRAIT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_CREATE_TRAIT,
  mode: 'post',
});

export const updateTrait_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_UPDATE_TRAIT']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_TRAIT']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_TRAIT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_UPDATE_TRAIT,
  mode: 'post',
});

export const deleteTrait_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_DELETE_TRAIT']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_DELETE_TRAIT']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_DELETE_TRAIT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_DELETE_TRAIT,
  mode: 'post',
});
