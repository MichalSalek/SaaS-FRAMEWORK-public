// main/src/domain/auth/authIO.possibilities.api.ts
// Auth transport IO — variant-C post-login token bridge (exchange-code).
//
// Flow: after magic-link verify / OAuth callback, the backend mints a one-time code (60s TTL,
// single-use) and 302-redirects to the FRONTEND with `?authCode=<64hex>`. The frontend posts it here.
// DECISION: the token is NEVER in the response body, only in the `authorization` header. Other
// calls let `http.interceptor.ts` persist that header to localStorage['authorization']; THIS call
// opts out (captureResponseAuthorization) and RETURNS the token. An exchanged code does not prove
// this browser asked for the login (login-CSRF), so AuthContext persists it only after the user
// confirms (application/auth/login-confirmation.ts); storage is live at once for every open tab.
//
// LOGIN_TOKEN_EXCHANGED / LOGIN_TOKEN_EXCHANGE_FAILED are INFO transport signals: suppressed in
// cqrs.config and absent from REDIRECTIONS_ON_EVENTS, so no snackbar and no redirect. Failure
// (HTTP 404, no header) resolves `null` and the caller continues as if no authCode were present.

import { callHTTPEndpoint } from '../../application/http/http.possibilities.api';
import { AUTH_ENDPOINTS } from '../../application/http/http.endpoints';
import { trackFlowStep } from '../../application/analytics/flow-events';

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
      // The named trace of the step (DECISION in flow-events.ts): this is the
      // moment a login link turns into a session, or does not.
      successCallback: async () => {
        trackFlowStep(
          'auth',
          token !== null ? 'code_exchanged' : 'code_exchange_failed'
        );
        resolve(token);
      },
      errorCallback: async () => {
        trackFlowStep('auth', 'code_exchange_failed');
        resolve(null);
      },
    });
  });
};
