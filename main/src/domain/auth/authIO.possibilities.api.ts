// main/src/domain/auth/authIO.possibilities.api.ts
// Auth transport IO — variant-C post-login token bridge (exchange-code).
//
// Flow: after magic-link verify / OAuth callback, the backend mints a one-time
// code (60s TTL, single-use) and 302-redirects to the FRONTEND origin with
// `?authCode=<64hex>` appended to the original callbackURL. The frontend posts
// that code here and receives the bearer token in the `authorization` response
// header.
//
// DECISION (nie usuwaj tego komentarza):
// The bearer token is NEVER in the response body — it arrives ONLY via the
// `authorization` response header. Every other call lets `http.interceptor.ts`
// persist such a header to localStorage['authorization']; THIS call opts out
// (captureResponseAuthorization) and RETURNS the token instead. Since s34
// (login-CSRF) an exchanged code is not proof that this browser asked for the
// login, so AuthContext decides whether to persist it now or only after the
// user confirms the account (application/auth/login-confirmation.ts). A token in
// storage is live at once for a reload and for every other open tab, so
// persisting before that decision reopened the hole.
//
// The success/failure events (LOGIN_TOKEN_EXCHANGED / LOGIN_TOKEN_EXCHANGE_FAILED)
// are INFO transport signals: backend registered them in the snackbar-suppression
// list (cqrs.config) and neither is in REDIRECTIONS_ON_EVENTS, so the event-bus
// raises no snackbar and no redirect for them. Failure (HTTP 404, no header) is
// handled here by resolving `null` — the caller continues exactly as if no
// authCode were present (the guard then bounces to login gracefully).

import { callHTTPEndpoint } from '../../application/http/http.possibilities.api';
import { AUTH_ENDPOINTS } from '../../application/http/http.endpoints';

interface ExchangeCodeRequest {
  authCode: string;
}

interface ExchangeCodeResponse {
  event: string;
}

/**
 * Exchange a one-time auth code for a bearer session token.
 *
 * Resolves the RAW token on HTTP 200 (NOT written to storage — the caller owns
 * that decision), `null` on any failure (404, network, timeout, or a 200 that
 * carried no token). Never throws — the bootstrap timing gate awaits this and
 * proceeds in both cases.
 */
export const exchangeAuthCode_IO = async (
  authCode: string
): Promise<string | null> => {
  let token: string | null = null;
  return new Promise<string | null>(resolve => {
    void callHTTPEndpoint<ExchangeCodeResponse, ExchangeCodeResponse>({
      config: {
        url: AUTH_ENDPOINTS.EXCHANGE_CODE,
        mode: 'post',
        payload: { authCode } satisfies ExchangeCodeRequest,
        captureResponseAuthorization: value => {
          token = value;
        },
      },
      // The headers interceptor runs before this callback, so the token (if
      // any) has already been captured.
      successCallback: async () => resolve(token),
      errorCallback: async () => resolve(null),
    });
  });
};
