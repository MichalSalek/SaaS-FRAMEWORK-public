import type { NextApiResponse } from 'next';
import {
  detectAiCrawler,
  shouldTrackCrawlerRequest,
} from '@kernel/domain/seo/ai-crawler-detection';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { withRawSecretHandler } from '@app/http/define-raw-handler';
import { ENV_VARS } from '@app/environment/environment.config';
import { IS_PRODUCTION_ENV } from '@app/environment/environment.utils.api';

/**
 * DECISION: body size cap `sizeLimit: '4kb'` against payload-flood DoS. A realistic crawler payload is
 * ~512B (user_agent <= 2000B + path + IP + country), so 4 KiB is a 2x margin without rejecting legit
 * traffic.
 */
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4kb',
    },
  },
};

// Every field is `unknown`: the raw S2S body has no validator in front of it, so the handler
// narrows each field with `typeof` below (nf/no-body-cast accepts only a cast that asserts nothing).
interface TrackCrawlerBody {
  user_agent?: unknown;
  path?: unknown;
  ip_address?: unknown;
  country?: unknown;
}

/**
 * Opaque rejection for unauthenticated / non-existent-route masking.
 *
 * DECISION: a bare, bodiless 404 (no JSON envelope, no bespoke Cache-Control), to minimize the response
 * fingerprint that tells this endpoint from the framework 404 of an unmatched Next.js route. The pre-auth
 * branches used to return `{"event":"NOT_FOUND"}` (application/json) plus `Cache-Control: no-store,
 * private`, trivially distinguishable from the default 404. The guarantee is deliberately not 100%: full
 * indistinguishability is unreachable from inside the handler (upstream withTimingNextHandlerMiddleware
 * already sets x-request-id, which an unmatched route lacks, and the default 404 body/cache headers are
 * version- and env-dependent). What IS protected is the SECRET (length pre-check + crypto.timingSafeEqual,
 * constant time: no oracle to crack). Leaking the route's existence has ~zero impact (the path is in the
 * kernel routing.config and called from proxy.ts; without the secret it is always 404, no insert/read).
 */
const respondOpaqueNotFound = (res: NextApiResponse): void => {
  res.status(404).end();
};

// Applied only to authenticated S2S responses — never on the pre-auth 404 branch
// (would re-introduce the existence-leaking fingerprint).
const setNoStore = (res: NextApiResponse): void => {
  res.setHeader('Cache-Control', 'no-store, private');
};

// Module-level flag — boot-time misconfiguration is reported once, not per request.
// In production this guards against log flooding when INTERNAL_SHARED_SECRET is missing.
let _missingSecretReported = false;

// No-secret-configured policy (failClosedMode opaque-404 → onMissingSecret):
// prod = 503 operational fail-closed signal (NIE maskowany jako 404), dev = silent 204.
const handleMissingSecret = (res: NextApiResponse): void => {
  if (IS_PRODUCTION_ENV()) {
    // DECISION: a missing secret env in PRODUCTION is a critical deploy misconfiguration. It returns 503
    // (not the opaque 404) because it is an operational fail-closed signal; masking it as 404 would hide
    // the misconfiguration. In production the secret is a deploy invariant, so this branch is not a real
    // probing surface (route existence is in the kernel anyway).
    if (!_missingSecretReported) {
      _missingSecretReported = true;
      reportIssueBackend({
        namespace: 'AI_CRAWLER_TRACK',
        message:
          'INTERNAL_SHARED_SECRET not configured — track-crawler endpoint disabled (returns 503).',
        payload: { env: ENV_VARS.NODE_ENV_MANUAL },
        mode: 'error',
      });
    }
    setNoStore(res);
    // GENERAL_ERROR replaces a raw 'SERVICE_UNAVAILABLE' string (APP_EVENTS SSOT).
    // Canonical server-fault marker (pl/en/de keys). Deploy misconfiguration,
    // S2S only, never shown to an end user.
    res.status(503).json({ event: APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR });
    return;
  }
  // Development: silent 204 — keeps proxy.ts fire-and-forget noise-free.
  setNoStore(res);
  res.status(204).end();
};

export default withRawSecretHandler({
  allowedMethods: ['POST'],
  failClosedMode: 'opaque-404',
  onMissingSecret: handleMissingSecret,
  onBadSecret: respondOpaqueNotFound,
  handle: async (req, res) => {
    // DECISION: Cache-Control: no-store is set only AFTER auth (helper setNoStore), not at the top of the
    // handler: a bespoke header on the pre-auth branch is a fingerprint that distinguishes the rejection
    // from the framework 404 (see respondOpaqueNotFound). Authenticated S2S responses (204/400/405/500)
    // still get no-store so no proxy/CDN caches them; `private` is defense in depth for browser caches.

    // The method gate is the wrapper's and runs AFTER the secret gate: an authenticated caller on
    // a non-POST method gets 405 + Allow (no-store), an outsider only ever the opaque 404.

    // Rate limit AFTER auth/method but BEFORE parsing body — protects against
    // INSERT flood from authenticated-but-compromised proxy or shared-secret leak.
    if (!withRateLimitCheck(req, res)) {
      return;
    }

    const body = (req.body ?? {}) as TrackCrawlerBody;
    const { user_agent, path, ip_address, country } = body;

    // DECISION: the payload is re-validated with the SAME kernel rule the proxy uses
    // (shouldTrackCrawlerRequest): a caller holding the secret still cannot store a human page view, a
    // monitoring probe or a path over the column cap. Only bot page reads are sent, so the existing STRICT
    // bucket (50 per 10 s, one S2S caller) stays far above this site's crawl rate; a burst over it loses
    // analytics rows only, the intended trade (tracking is best-effort).
    if (
      typeof user_agent !== 'string' ||
      user_agent.length === 0 ||
      typeof path !== 'string' ||
      !shouldTrackCrawlerRequest(path, user_agent)
    ) {
      setNoStore(res);
      // VALIDATION_FAILED replaces a raw 'INVALID_PAYLOAD' string (APP_EVENTS SSOT).
      // Canonical 400 payload-rejection event (pl/en/de keys).
      res
        .status(400)
        .json({ event: APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED });
      return;
    }

    const detected = detectAiCrawler(user_agent);

    const rawIp =
      typeof ip_address === 'string' ? ip_address.slice(0, 100) : null;

    try {
      await DB_CLIENT.use.aiCrawlerEvent.create({
        data: {
          user_agent: user_agent.slice(0, 2000), // safety cap
          path,
          ip_address: rawIp,
          country: typeof country === 'string' ? country.slice(0, 10) : null,
          bot_name: detected?.bot_name ?? null,
          bot_category: detected?.bot_category ?? null,
        },
      });
      setNoStore(res);
      res.status(204).end();
    } catch (err) {
      reportIssueBackend({
        namespace: 'AI_CRAWLER_TRACK',
        message: 'AiCrawlerEvent insert failed',
        payload: err,
        mode: 'error',
      });
      // Generic 500 — fire-and-forget caller does not inspect body; specific reason
      // already logged via reportIssueBackend (avoid leaking internal failure mode).
      setNoStore(res);
      res.status(500).end();
    }
  },
});
