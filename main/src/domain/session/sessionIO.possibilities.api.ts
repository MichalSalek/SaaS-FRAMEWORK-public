import { contractEndpoint, defineEndpoint } from '../../application/http/io';
import { DEV_ENDPOINTS } from '../../application/http/http.endpoints';
import { SESSION_CONTRACTS } from '@kernel/domain/session/session.contracts';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';

// The `session` domain calls go through the kernel contract, except dev login,
// which is not in this contract set. Every `_IO` returns `Promise<Res>`.

// cursor and take are the contract query fields, so both reach the query string.
export const getAllSessions_IO = contractEndpoint(
  SESSION_CONTRACTS.SESSION_GET_ALL
);

// GET /session/get-current — pure transport for the shared current-user query.
// Side effects (cache stamp) live in the caller: `UI/shared/hooks/currentUser.query.ts` reads via
// TanStack Query and gates on `hasSessionToken()`.
export const getCurrentUser_IO = contractEndpoint(
  SESSION_CONTRACTS.SESSION_GET_CURRENT,
  {
    // DECISION: get-current is a BACKGROUND identity poll (every shell mount and refetch), not a
    // user action. On lost connectivity (NETWORK/TIMEOUT: backend cold start, real offline, dev CORS
    // drift) every failed attempt pushed the global INTERNET_CONNECTION_PROBLEM snackbar, a toast
    // flood. The `background` policy makes the poll fail SOFT: the query settles as a handled error
    // (isError, the consumer shows connection state/retry) with ZERO snackbar. Same pattern as
    // publicIO / feature-flags / announcements. Real 401/403 (re-auth/account-state/permission)
    // still trigger the pipeline.
    errorFeedbackPolicy: 'background',
  }
);

export const deleteSessionExactly_IO = contractEndpoint(
  SESSION_CONTRACTS.SESSION_DELETE_EXACTLY
);

export const deleteSessionAll_IO = contractEndpoint(
  SESSION_CONTRACTS.SESSION_DELETE_ALL
);

// Dev login - bypasses magic link in non-production environments.
// DECISION: the response is typed USER_DTO_API_V1['DEV_LOGIN']['RESPONSE'] (= SafeCurrentUser):
// the backend strips session.token + session.userId via toSafeCurrentUser before serialising. The
// bearer token reaches the client ONLY via the Authorization response header and is persisted by
// http.interceptor.ts, NEVER from the response body (SafeCurrentUser is a structural subset of
// CurrentUser, so reading `response.data.session.token` would still type-check).
//
// The `setCurrentUser(response.data)` cache stamp lives in the caller (LoginPage handleQuickLogin),
// BEFORE refetchSession()/router.push, so the cache is stamped before navigation.
export const devLogin_IO = defineEndpoint<
  USER_DTO_API_V1['DEV_LOGIN']['REQUEST'],
  USER_DTO_API_V1['DEV_LOGIN']['RESPONSE'],
  USER_DTO_API_V1['DEV_LOGIN']['RESPONSE_ERROR']
>({
  url: DEV_ENDPOINTS.DEV_LOGIN,
  mode: 'post',
});
