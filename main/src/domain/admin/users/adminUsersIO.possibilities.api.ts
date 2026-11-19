// main/src/domain/admin/users/adminUsersIO.possibilities.api.ts
// IO functions for admin user management (frontend client): delete/disable/enable,
// impersonation (become/switch-back/refresh), pricing-plan change, notes, bulk
// actions, paginated listing, user timeline.
//
// The `admin` domain uses the promise-first front door (`defineEndpoint` / `defineQuery`): every
// `_IO` returns `Promise<Res>` and hooks call it directly (no `toPromise` at the call site).
//
// Snackbars: no `pushNewSnackbar(response.event)` here; the event-bus interceptor already pushes
// one for every successful `response.event` (unless it is in `eventsDisallowedForUI`). The bulk
// actions' extra counter snackbar (`Dezaktywowano: N, pominieto: M`) is not a duplicate and lives
// in the matching hook's `onSuccess`.
// EXCEPTIONS (raw `callHTTPEndpoint`, not the front door): becomeUser_IO + switchBackUser_IO; see
// the DECISION above becomeUser_IO.

import { callHTTPEndpoint } from '../../../application/http/http.possibilities.api';
import { contractEndpoint } from '../../../application/http/io';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
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

export const deleteUserAny_IO = contractEndpoint(
  USER_CONTRACTS.USER_DELETE_ANY
);
export const disableUserAny_IO = contractEndpoint(
  USER_CONTRACTS.USER_DISABLE_ANY
);
export const enableUserAny_IO = contractEndpoint(
  USER_CONTRACTS.USER_ENABLE_ANY
);

// DECISION: exception to the front door (io.ts EXCEPTIONS). becomeUser_IO + switchBackUser_IO
// orchestrate an identity change in a specific order that a plain `defineEndpoint` cannot express:
//   1. `requestCancellationService.cancelAll()` BEFORE the request cancels in-flight queries of the
//      old identity before the interceptor swaps the token.
//   2. On success a FULL document reload (`reloadIntoIdentity`), NOT `Router.push` +
//      `setCurrentUser` (rationale: DECISION at the top of application/auth/identity-switch.ts).
//      Tokens are already saved by the headers interceptor before the callback runs.
//   3. becomeUser remembers the admin screen (path + query with filters) and switchBack returns
//      EXACTLY there; the impersonation target is REDIRECTIONS_ON_EVENTS (SSOT), then role and
//      viewport policy decide as for a real user.
// Stays raw `callHTTPEndpoint` because the side effects must live in successCallback, before the
// hook's onSuccess (TQ gives no ordering guarantee relative to the interceptor).
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
          await abandonImpersonationToLogin();
        }
      },
    });
  };

const C = ADMIN_CONTRACTS;

export const refreshBecomeUser_IO = contractEndpoint(C.REFRESH_IMPERSONATION);
export const adminChangePricingPlan_IO = contractEndpoint(
  C.ADMIN_CHANGE_PRICING_PLAN
);
export const getNotes_IO = contractEndpoint(C.GET_NOTES);
export const saveNote_IO = contractEndpoint(C.SAVE_NOTE);
export const setMainNote_IO = contractEndpoint(C.SET_MAIN_NOTE);

// --- Bulk Actions ---
// The counter snackbar (`affected`/`skipped`/`sessionsDeleted`) lives in the matching hook's
// `onSuccess`: it is an extra snackbar, not a duplicate of the event. The interceptor still pushes
// the generic BULK_*_SUCCESS event; the hook adds the string with the numbers.

export const adminBulkDisable_IO = contractEndpoint(C.ADMIN_BULK_DISABLE);
export const adminBulkEnable_IO = contractEndpoint(C.ADMIN_BULK_ENABLE);
export const adminBulkChangePlan_IO = contractEndpoint(
  C.ADMIN_BULK_CHANGE_PLAN
);
export const adminBulkLogout_IO = contractEndpoint(C.ADMIN_BULK_LOGOUT);
export const adminGetUsersPaginated_IO = contractEndpoint(
  C.ADMIN_GET_USERS_PAGINATED
);
export const adminGetUserTimeline_IO = contractEndpoint(
  C.ADMIN_GET_USER_TIMELINE
);
