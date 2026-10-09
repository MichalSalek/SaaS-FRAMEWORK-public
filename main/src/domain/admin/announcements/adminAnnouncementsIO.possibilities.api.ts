// main/src/domain/admin/announcements/adminAnnouncementsIO.possibilities.api.ts
// IO functions for admin announcements (frontend client): list/create/update/delete
// + public active-announcements banner fetch.
//
// FDX FAZA 2 (W2.2/W2.3): domena `admin` zmigrowana na unified promise-first
// front-door (`defineEndpoint`). Każdy `_IO` zwraca teraz `Promise<Res>` — hooki
// wołają go bezpośrednio (bez `toPromise` przy call-site). Nazwy `_IO` zachowane.
//
// SNACKBARY (DECISION — nie usuwaj): poprzednio create/update/delete wołały
// `pushNewSnackbar(response.event)` w `successCallback`. To DUPLIKAT — event-bus
// interceptor (`http.interceptor` → `pushEventToBus`) JUŻ pushuje snackbar dla
// `response.event` każdej udanej odpowiedzi (chyba że event jest w
// `eventsDisallowedForUI`). Usunięto je z IO; snackbar nadal się pokazuje przez
// interceptor (zweryfikowano, że żaden z tych eventów nie jest disallowed).

import { defineEndpoint } from '../../../application/http/io';
import { ENDPOINTS } from '../../../application/http/http.endpoints';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

// Announcements
export const adminGetAnnouncements_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_GET_ANNOUNCEMENTS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_ANNOUNCEMENTS']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_ANNOUNCEMENTS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_ANNOUNCEMENTS,
  mode: 'get',
});

// Snackbar usunięty — interceptor pushuje response.event. 1:1 zachowane.
export const adminCreateAnnouncement_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_CREATE_ANNOUNCEMENT']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_CREATE_ANNOUNCEMENT']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_CREATE_ANNOUNCEMENT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_CREATE_ANNOUNCEMENT,
  mode: 'post',
});

// Snackbar usunięty — interceptor pushuje response.event. 1:1 zachowane.
export const adminUpdateAnnouncement_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_UPDATE_ANNOUNCEMENT']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_ANNOUNCEMENT']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_ANNOUNCEMENT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_UPDATE_ANNOUNCEMENT,
  mode: 'post',
});

// Snackbar usunięty — interceptor pushuje response.event. 1:1 zachowane.
export const adminDeleteAnnouncement_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_DELETE_ANNOUNCEMENT']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_DELETE_ANNOUNCEMENT']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_DELETE_ANNOUNCEMENT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_DELETE_ANNOUNCEMENT,
  mode: 'post',
});

export const getActiveAnnouncements_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ANNOUNCEMENTS_GET_ACTIVE']['REQUEST'],
  ADMIN_DTO_API_V1['ANNOUNCEMENTS_GET_ACTIVE']['RESPONSE'],
  ADMIN_DTO_API_V1['ANNOUNCEMENTS_GET_ACTIVE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ANNOUNCEMENTS_GET_ACTIVE,
  mode: 'get',
  // Public banner GET — background outage errors settle/log without a per-XHR
  // snackbar; the banner remains empty and 401/403 safety events still surface.
  errorFeedbackPolicy: 'background',
});
