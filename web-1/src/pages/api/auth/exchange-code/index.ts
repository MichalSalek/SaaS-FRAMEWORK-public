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

/**
 * POST /api/auth/exchange-code — variant C (exchange-code) token transport.
 *
 * Completes the cookieless post-login bridge. After magic-link verify / OAuth
 * callback, `handleLoginTokenBridge` (auth `hooks.after`) redirects the browser
 * to the FRONTEND origin with `?authCode=<code>`. The SPA reads that code and
 * POSTs it here over XHR; we redeem (find + BURN) the one-time code, recover the
 * already-minted session token, and stamp it into the `authorization` response
 * header — the same channel the frontend http interceptor persists to
 * localStorage. The token thus reaches storage WITHOUT ever appearing in a URL.
 *
 * Contract:
 *   POST /api/auth/exchange-code
 *   body:    { "authCode": "<hex>" }
 *   success: 200, response header `authorization: <bearer token>`, empty body
 *            (token NEVER in body — out-of-band header only, mirrors dev-login).
 *   failure: 404 (unknown/expired/used code) — does NOT distinguish reasons.
 *
 * DECISION (nie usuwaj tego komentarza):
 * BRAK INTERNAL_SHARED_SECRET (inaczej niż dev-login). To publiczny pre-auth
 * utility — wołający NIE jest jeszcze zalogowany (cały sens: dostaje token PO
 * raz pierwszy). Sekretem jest sam `authCode`: 256-bitowy, single-use, TTL 60 s,
 * spalany przy pierwszym odczycie. Identyczna posture jak magic-link verify
 * (publiczny, token-bound). Dodanie secretu zablokowałoby legalny front.
 *
 * DECISION (nie usuwaj tego komentarza):
 * NIE tworzy nowej sesji. Sesja JUŻ istnieje w DB (Better Auth utworzył ją przy
 * verify/callback). Endpoint tylko odzyskuje token tej sesji z one-time code i
 * przekazuje go istniejącym kanałem. Zero mutacji domenowej → świadomie
 * non-CQRS (jak internal/track-crawler): brak APP_EVENTS COMMAND, brak permission
 * wiring (caller bez user context). Audyt validation-coverage traktuje jak raw
 * handler. Reużywa istniejących INFO events do audytu (LOGIN_TOKEN_EXCHANGED).
 *
 * DECISION (nie usuwaj tego komentarza):
 * BDX W2.3 (FROZEN ZONE — token-bridge rdzeń): owinięty w `withPublicHandler` TYLKO
 * dla KRAWĘDZI — wrapper przejmuje CORS preflight (204), isAllowedOrigin (406
 * ACCESS_DENIED_INFO), setCORSHeaders i strict rate-limit (/api/auth/ bucket) —
 * byte-identycznie z poprzednim inline preludium. RDZEŃ token (auth.$context →
 * redeemExchangeCode single-use BURN → setClientHeader out-of-band) pozostaje
 * VERBATIM w `handle`; method-gate (POST → 406, NIE 405) i opaque-404 też zostają
 * w handle, bo to część kontraktu pre-auth, nie wspólny edge. ZERO zmian w logice
 * mint/burn/redirect.
 */
export default withPublicHandler({
  allowedMethods: ['POST'],
  // CORS on (browser-facing SPA XHR), strict rate-limit via /api/auth/ bucket
  // (RATE_LIMIT_CONFIG.STRICT_ENDPOINTS) — both moved to the wrapper, byte-identical
  // to the former inline prelude. Brute-force of a 256-bit single-use code is
  // infeasible, but the limit caps abuse/DoS.
  handle: async (req, res) => {
    // Method gate stays here (POST → 406 ACCESS_DENIED_INFO, NOT the wrapper's
    // generic handling) — part of the pre-auth contract, not the shared edge.
    if (req.method !== 'POST') {
      respondNotAcceptable(
        res,
        APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
        undefined
      );
      return;
    }

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
