import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import type { HTTPMethod } from '@kernel/domain/http/http.config';
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
 * BDX W2.3 — shared wrappers for RAW (non-CQRS) Next.js API handlers.
 *
 * `defineHandler` (W2.1/2.2) collapses the boilerplate for the ~150 CQRS routes
 * that run through `HTTPRequestHandlerMiddleware` (auth + permission + validation +
 * envelope). The 9 RAW handlers — S2S webhooks, internal analytics, public health,
 * the post-login token bridge, dev-login — DELIBERATELY bypass that middleware
 * (no user context, signature/secret auth, bespoke response shapes). They had each
 * re-implemented the same edge prelude inline: CORS preflight, `isAllowedOrigin`,
 * `setCORSHeaders`, `withRateLimitCheck`, a timing/error scaffold.
 *
 * These two wrappers consolidate ONLY that prelude. The `handle` body keeps full
 * control of method gating, body parsing, and the exact response bytes — because the
 * raw contracts are characterized by integration tests (track-crawler.test.ts) and
 * must stay byte-identical (opaque 404 masks, raw `{ event: 'METHOD_NOT_ALLOWED' }`,
 * 204 fire-and-forget, etc.). The wrapper never auto-emits a method/error envelope
 * that a handler's test would not expect.
 *
 * FROZEN ZONE (AuthContext / exchange-code / better-auth token bridge): the
 * token-mint / single-use-burn / redirect-rewrite CORE is untouchable. For
 * `exchange-code` and `dev-login` only the OUTER edge prelude is wrapped; the token
 * recovery / session-mint body is copied 1:1 into `handle`.
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

/** Options for {@link withPublicHandler}. */
export type PublicHandlerConfig = {
  /**
   * Allowed HTTP methods (upper-case). The wrapper does NOT auto-reject other
   * methods — method handling stays in `handle` so each raw handler keeps its
   * exact non-method response (some return bare `405`, some a JSON `{ event }`,
   * some a redirect). This field documents intent and is reserved for the future
   * W2.4 handler-shape ratchet; it has no runtime side effect today.
   */
  allowedMethods: readonly Uppercase<HTTPMethod>[];
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
   * Raw business logic. Owns method gating, body parsing, and the exact response.
   * Runs inside the timing middleware + a try/catch that maps any uncaught throw
   * to a 500 (only if the handler has not already sent a response).
   */
  handle: RawHandle;
};

/**
 * Run the shared raw prelude (CORS + origin + rate-limit) then `handle`.
 * Returns `false` when the prelude already concluded the response (preflight,
 * origin reject, rate-limit) — the caller stops.
 */
const runPrelude = (
  req: NextApiRequest,
  res: NextApiResponse,
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

  if (rateLimit && !withRateLimitCheck(req, res)) {
    return false;
  }

  return true;
};

/**
 * DECISION (nie usuwaj tego komentarza):
 * Null-byte (U+0000) input guard for RAW handlers — defense-in-depth, the same
 * boundary screen `defineHandler` applies (null-byte-guard.helper.ts). RAW
 * handlers bypass the CQRS validation middleware and own their body parsing, so
 * without this a NUL in any body/query string that reaches Prisma throws an
 * unmapped 500. We screen the parsed body + query recursively and reject with a
 * uniform 400 VALIDATION_FAILED. Returns `false` when it has concluded the
 * response (caller stops). Empty/clean input → no-op (returns `true`).
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
 * cors:false). The `handle` body keeps its own method gate + response bytes.
 */
export const withPublicHandler = (
  config: PublicHandlerConfig
): NextApiHandler => {
  const cors = config.cors ?? true;
  const rateLimit = config.rateLimit ?? true;

  return withTimingNextHandlerMiddleware(async (req, res) => {
    if (!runPrelude(req, res, cors, rateLimit)) {
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
  /** Allowed methods (documentation / W2.4 ratchet — no runtime effect, see above). */
  allowedMethods: readonly Uppercase<HTTPMethod>[];
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
 * gate (BDX W1.4 SSOT) on top of the timing/error scaffold.
 *
 * `failClosedMode: 'opaque-404'` (track-crawler): wrapper drives the
 * no-secret-configured branch (`onMissingSecret`) and the bad/missing-header branch
 * (`onBadSecret`), then `handle` runs the method/body logic. The opaque-404 and
 * 503/204 response BYTES live in the caller-supplied emitters so the contract that
 * `track-crawler.test.ts` characterizes stays byte-identical.
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
