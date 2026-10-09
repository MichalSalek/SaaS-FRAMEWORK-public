// main/src/domain/admin/config/adminConfigIO.possibilities.api.ts
// IO functions for admin configuration (frontend client): permissions, feature
// flags, app configs, policies.
//
// FDX FAZA 2 (W2.2/W2.3): domena `admin` zmigrowana na unified promise-first
// front-door (`defineEndpoint`). Każdy `_IO` zwraca teraz `Promise<Res>` — hooki
// wołają go bezpośrednio (bez `toPromise` przy call-site). Nazwy `_IO` zachowane.
//
// SNACKBARY (DECISION — nie usuwaj): poprzednio kilka funkcji wołało
// `pushNewSnackbar(response.event)` w `successCallback`. To DUPLIKAT — event-bus
// interceptor (`http.interceptor` → `pushEventToBus`) JUŻ pushuje snackbar dla
// `response.event` każdej udanej odpowiedzi (chyba że event jest w
// `eventsDisallowedForUI`). Usunięto je z IO; snackbar nadal się pokazuje przez
// interceptor (zweryfikowano, że żaden z tych eventów nie jest disallowed).

import { defineEndpoint } from '../../../application/http/io';
import { ENDPOINTS } from '../../../application/http/http.endpoints';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

// Permissions management
export const adminGetPermissions_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_GET_PERMISSIONS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_PERMISSIONS']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_PERMISSIONS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_PERMISSIONS,
  mode: 'get',
});

// Snackbar usunięty — backend zwraca event ADMIN_PERMISSIONS_UPDATED (ten sam,
// który IO pushowało jawnie), więc interceptor go pokrywa. Nie jest disallowed.
export const adminUpdatePermissions_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_UPDATE_PERMISSIONS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_PERMISSIONS']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_PERMISSIONS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_UPDATE_PERMISSIONS,
  mode: 'post',
});

// Feature Flags
export const adminGetFeatureFlags_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_GET_FEATURE_FLAGS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_FEATURE_FLAGS']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_FEATURE_FLAGS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_FEATURE_FLAGS,
  mode: 'get',
});

// Snackbar usunięty — interceptor pushuje response.event (toggle success event
// nie jest w eventsDisallowedForUI). 1:1 zachowane.
export const adminToggleFeatureFlag_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_TOGGLE_FEATURE_FLAG']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_TOGGLE_FEATURE_FLAG']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_TOGGLE_FEATURE_FLAG']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_TOGGLE_FEATURE_FLAG,
  mode: 'post',
});

// FDX FAZA 2 (W2.4): usunięto martwy duplikat `getFeatureFlagsPublic_IO` (0
// konsumentów). Kanon publicznego odczytu feature-flag żyje w
// `application/feature-flags/client-feature-flags.ts` (generic-tech client
// gating, zgodne z warstwami) — to jedyny żywy fetcher GET_FEATURE_FLAGS_PUBLIC.

// Policies
export const adminGetPolicies_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_GET_POLICIES']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_POLICIES']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_POLICIES']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_POLICIES,
  mode: 'get',
});

export const adminSavePolicy_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_SAVE_POLICY']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_SAVE_POLICY']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_SAVE_POLICY']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_SAVE_POLICY,
  mode: 'post',
});

export const adminDeletePolicy_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_DELETE_POLICY']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_DELETE_POLICY']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_DELETE_POLICY']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_DELETE_POLICY,
  mode: 'post',
});

export const adminSetMainPolicy_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_SET_MAIN_POLICY']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_SET_MAIN_POLICY']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_SET_MAIN_POLICY']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_SET_MAIN_POLICY,
  mode: 'post',
});

export const adminGetConfigs_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_GET_CONFIGS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_CONFIGS']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_CONFIGS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_CONFIGS,
  mode: 'get',
});

// Snackbar usunięty — interceptor pushuje response.event. 1:1 zachowane.
export const adminUpdateConfig_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_UPDATE_CONFIG']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_CONFIG']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_CONFIG']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_UPDATE_CONFIG,
  mode: 'post',
});
