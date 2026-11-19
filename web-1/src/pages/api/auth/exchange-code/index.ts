import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

import { auth } from '@app/auth/better-auth/better-auth.config';
import { redeemExchangeCode } from '@app/auth/better-auth/auth-token-bridge';
import { SESSION_HEADER_NAME } from '@app/auth/session/session.utils.api';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { setClientHeader } from '@app/headers/headers.utils';
import { withPublicHandler } from '@app/http/define-raw-handler';
import {
  respondGeneralError,
  respondNotAcceptable,
  respondNotFound,
  respondSuccess,
} from '@app/http/http.responses.utils';

export default withPublicHandler({
  allowedMethods: ['POST'],
  // CORS on (browser-facing SPA XHR), strict rate-limit via /api/auth/ bucket
  // (RATE_LIMIT_CONFIG.STRICT_ENDPOINTS) — both moved to the wrapper, byte-identical
  // to the former inline prelude. Brute-force of a 256-bit single-use code is
  // infeasible, but the limit caps abuse/DoS.
  // A non-POST method gets 406 ACCESS_DENIED_INFO, not the wrapper's 405: part of the
  // pre-auth contract (enforced by the wrapper through this emitter).
  onMethodNotAllowed: res =>
    respondNotAcceptable(
      res,
      APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
      undefined
    ),
  handle: async (req, res) => {
    const body = (req.body ?? {}) as { authCode?: unknown };
    const authCode = typeof body.authCode === 'string' ? body.authCode : '';
    if (!authCode) {
      // Same opaque 404 as an unknown code — never reveal whether a code existed.
      respondNotFound(
        res,
        APP_EVENTS.INFO.USER.LOGIN_TOKEN_EXCHANGE_FAILED,
        undefined
      );
      return;
    }

    try {
      const authContext = await auth.$context;
      const sessionToken = await redeemExchangeCode(
        authContext.internalAdapter,
        authCode
      );

      if (!sessionToken) {
        respondNotFound(
          res,
          APP_EVENTS.INFO.USER.LOGIN_TOKEN_EXCHANGE_FAILED,
          undefined
        );
        return;
      }

      // Stamp the bearer token out-of-band (response header), never in the body.
      setClientHeader({
        req,
        res,
        payload: { name: SESSION_HEADER_NAME, value: sessionToken },
      });

      respondSuccess(
        res,
        undefined,
        APP_EVENTS.INFO.USER.LOGIN_TOKEN_EXCHANGED
      );
    } catch (error) {
      reportIssueBackend({
        namespace: 'AUTH_EXCHANGE_CODE',
        message: 'Failed to exchange auth code',
        payload: error,
        mode: 'error',
      });
      respondGeneralError(res, undefined);
    }
  },
});
