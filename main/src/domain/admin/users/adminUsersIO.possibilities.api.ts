// main/src/domain/admin/users/adminUsersIO.possibilities.api.ts
// IO functions for admin user management (frontend client): delete/disable/enable,
// impersonation (become/switch-back/refresh), pricing-plan change, notes, bulk
// actions, paginated listing, user timeline.
//
// FDX FAZA 2 (W2.2/W2.3): domena `admin` zmigrowana na unified promise-first
// front-door (`defineEndpoint` / `defineQuery`). Każdy `_IO` zwraca teraz
// `Promise<Res>` — hooki wołają go bezpośrednio (bez `toPromise` przy call-site).
// Nazwy `_IO` zachowane (146 call-sites; win = promise-first, nie rename).
//
// SNACKBARY (DECISION — nie usuwaj): poprzednio kilkanaście funkcji wołało
// `pushNewSnackbar(response.event)` w `successCallback`. To DUPLIKAT — event-bus
// interceptor (`http.interceptor` → `pushEventToBus`) JUŻ pushuje snackbar dla
// `response.event` każdej udanej odpowiedzi (chyba że event jest w
// `eventsDisallowedForUI`). Usunięto je z IO; snackbar nadal się pokazuje przez
// interceptor (zweryfikowano, że żaden z tych eventów nie jest disallowed).
// Wyjątek: bulk-akcje miały DODATKOWY, specyficzny snackbar z licznikami
// (`Dezaktywowano: N, pominieto: M`) — to NIE duplikat eventu, więc przeniesiono
// go do `onSuccess` odpowiedniego hooka (useBulkDisable/Enable/ChangePlan/Logout).
//
// WYJĄTKI (load-bearing — raw `callHTTPEndpoint`, NIE front-door): becomeUser_IO
// + switchBackUser_IO — patrz DECISION-comment przy każdej z nich.

import { callHTTPEndpoint } from '../../../application/http/http.possibilities.api';
import { defineEndpoint, defineQuery } from '../../../application/http/io';
import { ENDPOINTS } from '../../../application/http/http.endpoints';
import { requestCancellationService } from '../../../application/http/request-cancellation.service';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  abandonImpersonationToLogin,
  consumeImpersonationReturnUrl,
  reloadIntoIdentity,
  rememberImpersonationReturnUrl,
} from '../../../application/auth/identity-switch';
import {
  REDIRECTIONS_ON_EVENTS,
  ROUTES_FRONT_APP,
} from '@kernel/domain/routing/routing.config';

export const deleteUserAny_IO = defineEndpoint<
  ADMIN_DTO_API_V1['USER_DELETE_ANY']['REQUEST'],
  ADMIN_DTO_API_V1['USER_DELETE_ANY']['RESPONSE'],
  ADMIN_DTO_API_V1['USER_DELETE_ANY']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_DELETE_ANY,
  mode: 'post',
});

export const disableUserAny_IO = defineEndpoint<
  ADMIN_DTO_API_V1['USER_DISABLE_ANY']['REQUEST'],
  ADMIN_DTO_API_V1['USER_DISABLE_ANY']['RESPONSE'],
  ADMIN_DTO_API_V1['USER_DISABLE_ANY']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_DISABLE_ANY,
  mode: 'post',
});

export const enableUserAny_IO = defineEndpoint<
  ADMIN_DTO_API_V1['USER_ENABLE_ANY']['REQUEST'],
  ADMIN_DTO_API_V1['USER_ENABLE_ANY']['RESPONSE'],
  ADMIN_DTO_API_V1['USER_ENABLE_ANY']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.USER_ENABLE_ANY,
  mode: 'post',
});

// DECISION (nie usuwaj tego komentarza) — WYJĄTEK od front-door (io.ts EXCEPTIONS):
// becomeUser_IO + switchBackUser_IO orkiestrują zmianę tożsamości w KONKRETNEJ
// kolejności, niemożliwej do wyrażenia czystym `defineEndpoint`:
//   1. `requestCancellationService.cancelAll()` PRZED requestem — anuluje in-flight
//      zapytania starej tożsamości, zanim interceptor podmieni token.
//   2. Po sukcesie PEŁNE przeładowanie dokumentu (`reloadIntoIdentity`), NIE
//      `Router.push` + `setCurrentUser`. Uzasadnienie w DECISION na górze
//      application/auth/identity-switch.ts: atom sesji Better Auth, cache TQ,
//      AuthContext i Zustand trzymały starą tożsamość, więc panel admina renderował
//      się z tokenem wcielonej osoby (403) albo mieszał obie tożsamości na ekranie.
//      Tokeny są już zapisane przez interceptor nagłówków, zanim ruszy callback.
//   3. becomeUser zapamiętuje ekran panelu (ścieżka + query z filtrami), a
//      switchBack wraca DOKŁADNIE tam; cel wcielenia = REDIRECTIONS_ON_EVENTS
//      (SSOT), dalej rozstrzyga polityka roli i viewportu jak u prawdziwego usera.
// Zostaje raw `callHTTPEndpoint`, bo side-effecty muszą żyć w successCallback
// przed hookowym onSuccess (TQ nie gwarantuje kolejności względem interceptora).
export const becomeUser_IO: ADMIN_DTO_API_V1['BECOME_USER']['IO_CLIENT_FUNCTION'] =
  async (req, successCallback, errorCallback) => {
    requestCancellationService.cancelAll();
    rememberImpersonationReturnUrl();

    await callHTTPEndpoint<
      ADMIN_DTO_API_V1['BECOME_USER']['RESPONSE'],
      ADMIN_DTO_API_V1['BECOME_USER']['RESPONSE_ERROR']
    >({
      config: {
        url: ENDPOINTS.BECOME_USER,
        mode: 'post',
        payload: req,
      },
      successCallback: async response => {
        await successCallback(response);
        reloadIntoIdentity(
          REDIRECTIONS_ON_EVENTS[response.event] ?? ROUTES_FRONT_APP.APP
        );
      },
      errorCallback: async error => {
        await errorCallback(error);
      },
    });
  };

export const switchBackUser_IO: ADMIN_DTO_API_V1['SWITCH_BACK_BECOME_USER']['IO_CLIENT_FUNCTION'] =
  async (req, successCallback, errorCallback) => {
    requestCancellationService.cancelAll();

    await callHTTPEndpoint<
      ADMIN_DTO_API_V1['SWITCH_BACK_BECOME_USER']['RESPONSE'],
      ADMIN_DTO_API_V1['SWITCH_BACK_BECOME_USER']['RESPONSE_ERROR']
    >({
      config: {
        url: ENDPOINTS.SWITCH_BACK_BECOME_USER,
        mode: 'post',
        payload: req,
      },
      successCallback: async response => {
        await successCallback(response);
        reloadIntoIdentity(consumeImpersonationReturnUrl());
      },
      errorCallback: async error => {
        await errorCallback(error);
        // Connectivity failure → retryable, keep everything. Any answer from the
        // server means the admin session cannot be restored (expired backup):
        // leave the impersonated identity instead of trapping the admin in it.
        if (
          error.event !==
          APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM
        ) {
          abandonImpersonationToLogin();
        }
      },
    });
  };

export const refreshBecomeUser_IO = defineEndpoint<
  ADMIN_DTO_API_V1['REFRESH_IMPERSONATION']['REQUEST'],
  ADMIN_DTO_API_V1['REFRESH_IMPERSONATION']['RESPONSE'],
  ADMIN_DTO_API_V1['REFRESH_IMPERSONATION']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.REFRESH_IMPERSONATION,
  mode: 'post',
});

// Snackbar usunięty — interceptor pushuje response.event (CHANGE_PRICING_PLAN
// success event nie jest w eventsDisallowedForUI). 1:1 zachowane.
export const adminChangePricingPlan_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_CHANGE_PRICING_PLAN']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_CHANGE_PRICING_PLAN']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_CHANGE_PRICING_PLAN']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_CHANGE_PRICING_PLAN,
  mode: 'post',
});

export const getNotes_IO = defineQuery<
  ADMIN_DTO_API_V1['GET_NOTES']['REQUEST'],
  ADMIN_DTO_API_V1['GET_NOTES']['RESPONSE'],
  ADMIN_DTO_API_V1['GET_NOTES']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GET_NOTES,
  queryFields: req => ({ id: req?.id }),
});

export const saveNote_IO = defineEndpoint<
  ADMIN_DTO_API_V1['SAVE_NOTE']['REQUEST'],
  ADMIN_DTO_API_V1['SAVE_NOTE']['RESPONSE'],
  ADMIN_DTO_API_V1['SAVE_NOTE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SAVE_NOTE,
  mode: 'post',
});

export const setMainNote_IO = defineEndpoint<
  ADMIN_DTO_API_V1['SET_MAIN_NOTE']['REQUEST'],
  ADMIN_DTO_API_V1['SET_MAIN_NOTE']['RESPONSE'],
  ADMIN_DTO_API_V1['SET_MAIN_NOTE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SET_MAIN_NOTE,
  mode: 'post',
});

// --- Bulk Actions ---
// Snackbar z licznikami (`affected`/`skipped`/`sessionsDeleted`) przeniesiony do
// `onSuccess` odpowiedniego hooka — to DODATKOWY snackbar (nie duplikat eventu),
// więc front-door + hook onSuccess. Interceptor nadal pushuje generyczny
// BULK_*_SUCCESS event; hook dorzuca string z liczbami. 1:1 zachowane.

export const adminBulkDisable_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_BULK_DISABLE']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_BULK_DISABLE']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_BULK_DISABLE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_BULK_DISABLE,
  mode: 'post',
});

export const adminBulkEnable_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_BULK_ENABLE']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_BULK_ENABLE']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_BULK_ENABLE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_BULK_ENABLE,
  mode: 'post',
});

export const adminBulkChangePlan_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_BULK_CHANGE_PLAN']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_BULK_CHANGE_PLAN']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_BULK_CHANGE_PLAN']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_BULK_CHANGE_PLAN,
  mode: 'post',
});

export const adminBulkLogout_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_BULK_LOGOUT']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_BULK_LOGOUT']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_BULK_LOGOUT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_BULK_LOGOUT,
  mode: 'post',
});

export const adminGetUsersPaginated_IO = defineQuery<
  ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_USERS_PAGINATED,
  queryFields: req => ({
    cursor: req.cursor,
    take: req.take,
    search: req.search,
    role: req.role,
    is_active: req.is_active,
    account_status: req.account_status,
    payment_status: req.payment_status,
    pricing_plan: req.pricing_plan,
    onboarding_pending: req.onboarding_pending,
    attention: req.attention,
    sort_by: req.sort_by,
    sort_order: req.sort_order,
  }),
});

export const adminGetUserTimeline_IO = defineQuery<
  ADMIN_DTO_API_V1['ADMIN_GET_USER_TIMELINE']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_USER_TIMELINE']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_USER_TIMELINE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_USER_TIMELINE,
  queryFields: req => ({
    user_id: req.user_id,
    page: req.page,
    limit: req.limit,
    event_type: req.event_type,
  }),
});
