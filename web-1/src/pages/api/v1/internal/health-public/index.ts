import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { getPrimaryDatabaseAvailability } from '@app/db/db-availability.state';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { withPublicHandler } from '@app/http/define-raw-handler';

// DECISION: public no-auth endpoint for the status page and Better Stack's passive DB monitor. Sanitized:
// no vendor names, error details, precise latency, user counts, connection strings or hostnames; returns
// only database up|down, api up|down, uptime_seconds and ts. Rate limited per IP via STRICT_ENDPOINTS (bot
// DDoS protection). It queries no DB or provider: state comes from real use of the main pool, so a read
// never wakes Neon. The admin /health (auth required) has the full diagnostic. The /internal/ namespace is
// kept for consistency with track-crawler although there is no secret auth (see the routing.config.ts
// DECISION).
//
// Wrapped in `withPublicHandler({ cors: false })`: an S2S/public probe is not called from a browser, so an
// Origin allow-list would only add failure modes. The wrapper gives the timing/error scaffold and the
// correlation id (X-Request-Id is set before `handle`); the rate limit stays explicit in `handle`, after
// Cache-Control and the method gate, to keep the exact response order.

/**
 * Public health endpoint for the product status page and Better Stack monitors.
 *
 * Security guarantees:
 * - No auth required (uptime monitors need public access)
 * - Sanitized response: no vendor names, no error messages, no latency precision, no counts
 * - Rate limited (STRICT: 50 req / 10s per IP)
 * - Cache-Control: no-store (state changes must be visible to incident recovery)
 * - GET/HEAD only (HEAD returns the same headers and no body, for uptime monitors)
 * - DB-free: reads only process-local last-observed pool state
 */
export default withPublicHandler({
  // GET/HEAD only; the wrapper answers the rest with 405 + Allow (not 404: nothing to mask here).
  allowedMethods: ['GET', 'HEAD'],
  cors: false,
  // Rate limit stays inside `handle` so it runs AFTER the Cache-Control header +
  // method gate, preserving the exact original response ordering.
  rateLimit: false,
  handle: async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    // DECISION: see web-1/src/pages/api/health-check/index.ts (HEAD handled in the handler).
    // Rate limit — STRICT_ENDPOINTS bucket (50 req / 10s per IP).
    // Legitimate monitor: 1 ping / 1-5 min. Bot scraper would hit limit quickly.
    if (!withRateLimitCheck(req, res)) {
      return;
    }

    // HEAD ends here: same headers as GET, zero body bytes (RFC 9110 §9.3.2).
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).end();
      return;
    }

    const databaseAvailability = getPrimaryDatabaseAvailability();
    const databaseStatus: 'up' | 'down' =
      databaseAvailability.status === 'up' ? 'up' : 'down';

    // API is always 'up' if this code is executing — the request reached the handler.
    const apiStatus: 'up' | 'down' = 'up';

    // Uptime in whole seconds — not a fingerprint risk (no precise timing).
    const uptime_seconds = Math.round(process.uptime());

    res.status(200).json({
      event: APP_EVENTS.QUERIES.APPLICATION.INTERNAL_HEALTH_PUBLIC,
      data: {
        database: databaseStatus,
        api: apiStatus,
        uptime_seconds,
        ts: new Date().toISOString(),
      },
    });
  },
});
