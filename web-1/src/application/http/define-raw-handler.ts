import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { isAllowedOrigin, setCORSHeaders } from '@app/cors/cors.middleware';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { withTimingNextHandlerMiddleware } from '@app/http/timing.middleware';
import {
  isInternalSecretConfigured,
  verifyInternalSecret,
} from '@app/auth/verify-internal-secret';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  respondGeneralError,
  respondNotAcceptable,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { containsNullByte } from '@app/http/null-byte-guard.helper';

/**
 * Shared wrappers for RAW (non-CQRS) Next.js API handlers.
 *
 * RAW handlers (S2S webhooks, internal analytics, public health, the post-login token
 * bridge, dev-login) deliberately bypass `HTTPRequestHandlerMiddleware`: no user context,
 * signature/secret auth, bespoke response shapes. These wrappers hold their shared edge
 * prelude (CORS preflight, origin check, rate limit, timing/error scaffold) and the METHOD
 * GATE: a method outside `allowedMethods` gets 405 with `Allow`, unless the handler declares
 * another answer through `onMethodNotAllowed` (an opaque 404, the token bridge's 406).
 * `handle` keeps body parsing and the exact success/error bytes, which the integration tests
 * characterize (track-crawler.test.ts, raw-handler-methods.test.ts).
 *
 * The token-mint / single-use-burn / redirect-rewrite core of exchange-code and dev-login
 * is not wrapped: only the outer edge prelude is, the body lives 1:1 in `handle`.
 */

/**
 * Raw business-logic signature. Mirrors `NextApiHandler`'s return contract
 * (`void | Promise<void> | unknown`) so an existing `NextApiHandler`-typed handler
 * (e.g. dev-login's verbatim FROZEN-zone body) is assignable without re-typing.
 */
export type RawHandle = (
  req: NextApiRequest,
  res: NextApiResponse
) => void | Promise<void> | unknown;

/**
 * Methods a RAW handler may declare. Wider than the kernel `HTTPMethod` (the CQRS verbs): probes
 * answer HEAD, and a handler with its own preflight answers OPTIONS.
 */
export type RawHttpMethod =
  'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/**
 * The default answer to a method outside `allowedMethods`: 405 with `Allow` (RFC 9110 §15.5.6
 * requires it) and the canonical method/access-reject event. `no-store`, because an answer about
 * the method must never be cached in front of the real one.
 */
export const respondMethodNotAllowed = (
  res: NextApiResponse,
  allowed: readonly RawHttpMethod[]
): void => {
  res.setHeader('Allow', allowed.join(', '));
  res.setHeader('Cache-Control', 'no-store');
  res
    .status(405)
    .json({ event: APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO });
};

const isAllowedMethod = (
  method: string | undefined,
  allowed: readonly RawHttpMethod[]
): boolean => allowed.some(candidate => candidate === method);

/**
 * Method gate shared by both wrappers. Returns `false` when it has answered (the caller stops).
 * `advertised` is what `Allow` lists: the declared methods, plus OPTIONS when the wrapper's CORS
 * prelude answers the preflight itself.
 */
const passMethodGate = (
  req: NextApiRequest,
  res: NextApiResponse,
  allowed: readonly RawHttpMethod[],
  advertised: readonly RawHttpMethod[],
  onMethodNotAllowed: ((res: NextApiResponse) => void) | undefined
): boolean => {
  if (isAllowedMethod(req.method, allowed)) {
    return true;
  }
  if (onMethodNotAllowed) {
    onMethodNotAllowed(res);
  } else {
    respondMethodNotAllowed(res, advertised);
  }
  return false;
};

/** Options for {@link withPublicHandler}. */
export type PublicHandlerConfig = {
  /**
   * Allowed HTTP methods, ENFORCED: any other method is answered by the wrapper before `handle`
   * runs (after the CORS preflight and origin check when `cors` is on, before the rate limit).
   * List HEAD explicitly where the handler answers it (probes), and OPTIONS where a `cors: false`
   * handler answers its own preflight.
   */
  allowedMethods: readonly RawHttpMethod[];
  /**
   * A deliberate answer other than 405 for a method outside the list: an opaque 404 where the
   * endpoint must not reveal itself, or a fixed contract status. Omit it to get 405 + `Allow`.
   */
  onMethodNotAllowed?: (res: NextApiResponse) => void;
  /**
   * CORS posture. `true` (default) runs the full browser-facing prelude:
   * answer OPTIONS preflight with 204 + CORS headers, reject disallowed origins
   * with 406, then stamp CORS headers on the response. `false` skips all CORS
   * (S2S-only endpoints: track-crawler, health-public, stripe — never called from
   * a browser, so an Origin allow-list would only add failure modes).
   */
  cors?: boolean;
  /**
   * Rate-limit posture. `true` (default) runs `withRateLimitCheck` (strict-tier
   * bucketing is decided by the SSOT `RATE_LIMIT_CONFIG.STRICT_ENDPOINTS` from the
   * request URL — never a wrapper param). When the limit is hit the wrapper has
   * already sent the 429 envelope and short-circuits before `handle`.
   */
  rateLimit?: boolean;
  /**
   * Raw business logic. Runs only for an allowed method; owns body parsing and the exact response.
   * Runs inside the timing middleware + a try/catch that maps any uncaught throw
   * to a 500 (only if the handler has not already sent a response).
   */
  handle: RawHandle;
};

/**
 * Run the shared raw prelude (CORS + origin + method gate + rate-limit) then `handle`.
 * Returns `false` when the prelude already concluded the response (preflight,
 * origin reject, disallowed method, rate-limit) — the caller stops.
 */
const runPrelude = (
  req: NextApiRequest,
  res: NextApiResponse,
  config: PublicHandlerConfig,
  cors: boolean,
  rateLimit: boolean
): boolean => {
  if (cors) {
    // CORS preflight first — browser OPTIONS carries no custom headers / body.
    if (req.method === 'OPTIONS') {
      setCORSHeaders({ req, res });
      res.status(204).end();
      return false;
    }

    if (!isAllowedOrigin({ req, res })) {
      respondNotAcceptable(
        res,
        APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
        undefined
      );
      return false;
    }
    setCORSHeaders({ req, res });
  }

  const advertised: readonly RawHttpMethod[] =
    cors && !config.allowedMethods.includes('OPTIONS')
      ? [...config.allowedMethods, 'OPTIONS']
      : config.allowedMethods;
  if (
    !passMethodGate(
      req,
      res,
      config.allowedMethods,
      advertised,
      config.onMethodNotAllowed
    )
  ) {
    return false;
  }

  if (rateLimit && !withRateLimitCheck(req, res)) {
    return false;
  }

  return true;
};

/**
 * DECISION: null-byte (U+0000) input guard for RAW handlers, the same boundary screen
 * `defineHandler` applies (null-byte-guard.helper.ts). RAW handlers bypass the CQRS validation
 * middleware and own their body parsing, so a NUL in any body/query string reaching Prisma would
 * throw an unmapped 500. The parsed body + query are screened recursively and rejected with a
 * uniform 400 VALIDATION_FAILED. Returns `false` when it has concluded the response (caller
 * stops).
 */
const screenNullBytes = (
  req: NextApiRequest,
  res: NextApiResponse
): boolean => {
  if (containsNullByte(req.body) || containsNullByte(req.query)) {
    respondValidationFailed(res, { field: 'input', message: 'Invalid input' });
    return false;
  }
  return true;
};

/**
 * Wrap a RAW public (no-auth) Next.js API handler with the shared edge prelude.
 *
 * Used by: exchange-code (public pre-auth token bridge — `authCode` IS the secret),
 * health-check (CORS + rate-limit public probe), health-public (S2S/public uptime,
 * cors:false), sweep-tick, native-oauth-start, the Stripe webhook. The method gate is the
 * wrapper's; the `handle` body keeps its response bytes.
 */
export const withPublicHandler = (
  config: PublicHandlerConfig
): NextApiHandler => {
  const cors = config.cors ?? true;
  const rateLimit = config.rateLimit ?? true;

  return withTimingNextHandlerMiddleware(async (req, res) => {
    if (!runPrelude(req, res, config, cors, rateLimit)) {
      return;
    }
    if (!screenNullBytes(req, res)) {
      return;
    }
    try {
      await config.handle(req, res);
    } catch (error) {
      reportIssueBackend({
        namespace: 'RAW_PUBLIC_HANDLER',
        message: 'Uncaught error in raw public handler',
        payload: error,
        mode: 'error',
      });
      if (!res.headersSent && !res.writableEnded) {
        respondGeneralError(res, undefined);
      }
    }
  });
};

/**
 * Fail-closed policy when no `INTERNAL_SHARED_SECRET` is configured / the header
 * does not match. Each raw secret handler historically encoded its own variant:
 *
 *  - `'opaque-404'` (track-crawler): bad/missing secret → bare bodiless 404 to mask
 *    endpoint existence; no secret configured → 503 in prod (operational fail-closed
 *    signal, NOT masked) / silent 204 in dev. Caller supplies the 503 + 204 emitters
 *    so the exact response bytes + one-shot boot log stay verbatim.
 *  - `'custom'`: the handler owns the entire gate (dev-login: env-aware graceful-allow,
 *    404-mask) — wrapper only provides CORS/timing, the secret check stays in `handle`.
 */
export type RawSecretFailClosedMode = 'opaque-404' | 'custom';

/** Options for {@link withRawSecretHandler}. */
export type RawSecretHandlerConfig = {
  /**
   * Allowed methods. In `'opaque-404'` mode ENFORCED by the wrapper right AFTER the secret gate:
   * an unauthenticated caller only ever sees the opaque 404, an authenticated one gets 405 +
   * `Allow`. In `'custom'` mode the handler owns the existence mask, and a method gate in front
   * of it would reveal the endpoint (405 instead of 404), so the wrapper does NOT enforce it there:
   * the handler must gate the method itself after its mask (dev-login does it through
   * `HTTPRequestHandlerMiddleware` with `contestedHTTPMethod: 'post'`).
   */
  allowedMethods: readonly RawHttpMethod[];
  /** A deliberate answer other than 405 for a method outside the list (opaque-404 mode only). */
  onMethodNotAllowed?: (res: NextApiResponse) => void;
  /**
   * Header carrying the shared secret. Defaults to the canonical
   * `x-internal-secret` (`CUSTOM_HEADERS.xInternalSecret`).
   */
  secretName?: string;
  /** No-secret / bad-secret fail-closed strategy (see {@link RawSecretFailClosedMode}). */
  failClosedMode: RawSecretFailClosedMode;
  /**
   * Invoked when `failClosedMode === 'opaque-404'` AND no secret is configured at all
   * (deploy-config state, not an auth failure). Owns the exact 503-vs-204 response +
   * any one-shot boot-misconfiguration log. Returning ends the request.
   */
  onMissingSecret?: (res: NextApiResponse) => void;
  /**
   * Invoked when `failClosedMode === 'opaque-404'` AND a secret IS configured but the
   * header is missing / wrong (timing-safe `verifyInternalSecret` returned false).
   * Owns the exact opaque rejection (e.g. bare `res.status(404).end()`).
   */
  onBadSecret?: (res: NextApiResponse) => void;
  /** Raw business logic — runs only after the secret gate passes. */
  handle: RawHandle;
};

/**
 * Wrap a RAW secret-gated S2S handler. Adds the timing-safe `verifyInternalSecret`
 * gate on top of the timing/error scaffold.
 *
 * `failClosedMode: 'opaque-404'` (track-crawler): wrapper drives the
 * no-secret-configured branch (`onMissingSecret`) and the bad/missing-header branch
 * (`onBadSecret`), then the method gate (405 + Allow, after auth), then `handle` runs the body
 * logic. The opaque-404 and 503/204 response BYTES live in the caller-supplied emitters so the
 * contract that `track-crawler.test.ts` characterizes stays byte-identical.
 *
 * `failClosedMode: 'custom'` (dev-login, FROZEN-adjacent): wrapper provides ONLY the
 * timing/error scaffold — the env-aware secret policy + 404-mask stay verbatim inside
 * `handle` (touching them risks the auth core).
 */
export const withRawSecretHandler = (
  config: RawSecretHandlerConfig
): NextApiHandler => {
  const secretName = config.secretName ?? CUSTOM_HEADERS.xInternalSecret;

  return withTimingNextHandlerMiddleware(async (req, res) => {
    if (config.failClosedMode === 'opaque-404') {
      // 1. No secret configured AT ALL → deploy-config state, NOT an auth failure.
      //    Owned by the caller (prod 503 operational signal / dev silent 204 + a
      //    one-shot boot-misconfiguration log). Checked FIRST so the config error is
      //    never masked behind the existence-hiding 404 of the bad-secret branch.
      if (!isInternalSecretConfigured()) {
        if (config.onMissingSecret) {
          config.onMissingSecret(res);
          return;
        }
        // Defensive fallthrough — callers in this mode always supply onMissingSecret.
      }
      // 2. Secret configured but header missing / wrong-length / wrong-value →
      //    opaque, bodiless rejection (caller emits the exact bytes, e.g. 404 .end()).
      if (!verifyInternalSecret(req.headers[secretName])) {
        if (config.onBadSecret) {
          config.onBadSecret(res);
          return;
        }
        res.status(404).end();
        return;
      }
      // 3. Method gate AFTER the secret gate, so it reveals nothing to an outsider.
      if (
        !passMethodGate(
          req,
          res,
          config.allowedMethods,
          config.allowedMethods,
          config.onMethodNotAllowed
        )
      ) {
        return;
      }
    }

    try {
      // Null-byte input guard runs AFTER the secret gate (caller already proved
      // secret knowledge → a 400 here leaks nothing) and BEFORE handle/Prisma.
      if (!screenNullBytes(req, res)) {
        return;
      }
      await config.handle(req, res);
    } catch (error) {
      reportIssueBackend({
        namespace: 'RAW_SECRET_HANDLER',
        message: 'Uncaught error in raw secret handler',
        payload: error,
        mode: 'error',
      });
      if (!res.headersSent && !res.writableEnded) {
        respondGeneralError(res, undefined);
      }
    }
  });
};
