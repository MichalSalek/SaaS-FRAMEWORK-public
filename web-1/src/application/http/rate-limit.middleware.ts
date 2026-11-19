import type { NextApiRequest, NextApiResponse } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { HEALTH_ROUTE_ALIASES } from '@app/health/health-route-aliases';
import { asStatusCode } from './http.utils.api';
import { resolveTrustedClientIp, toRateLimitIpKey } from './trust-aware-ip';

/**
 * Rate limiting configuration - SSOT
 *
 * Balanced for production use while allowing reasonable testing.
 * Window: 10s, Max: 100 req/window = 10 req/s average
 * Strict: 50 req/window = 5 req/s for sensitive endpoints
 */
export const RATE_LIMIT_CONFIG = {
  /** Time window in milliseconds (10 seconds) */
  WINDOW_MS: 10 * 1000,
  /** Maximum requests per window (100 req/10s = 10 req/s) */
  MAX_REQUESTS: 100,
  /** Sensitive endpoints with stricter limits */
  STRICT_ENDPOINTS: [
    ROUTES_API.SALON_STAFF, // Invitation email delivery: strict IP bucket plus per-salon database cap.
    '/api/auth/', // Better Auth prefix (no ROUTES_API constant): outer layer of the login limits, see auth/login-abuse/login-abuse.config.ts
    // DD-M2: public GET token oracle + DB write. The kernel constant carries a `[token]`
    // dynamic segment (`.../newsletter-confirm/[token]`); the live request URL substitutes
    // the real token, so we strip the segment and match on the prefix (isStrictEndpoint
    // uses url.startsWith). Prefix derived from SSOT — stays in sync with API_VER changes.
    ROUTES_API.NEWSLETTER_CONFIRM.split('[token]')[0], // Confirm token brute-force + write abuse
    ROUTES_API.NEWSLETTER_UNSUBSCRIBE, // DD-L2: public unauthenticated — parity with EMAIL_UNSUBSCRIBE
    ROUTES_API.EMAIL_UNSUBSCRIBE, // Public unauthenticated endpoint — prevent abuse
    ROUTES_API.INTERNAL_TRACK_CRAWLER, // Internal S2S analytics — prevent INSERT-flood DoS via /llms.txt spam
    ROUTES_API.INTERNAL_HEALTH_PUBLIC, // Public uptime health endpoint: the strict tier (50 req per 10 s per IP) is far above an uptime monitor (one ping every few minutes) and caps scraping
    ROUTES_API.INTERNAL_SWEEP_TICK, // External sweep clock — one monitor call every few minutes at most; anything faster is abuse
    // DECISION: see web-1/src/application/health/health-route-aliases.ts (health aliases belong in
    // the strict tier). Bucketing stays per-path, so each alias has its own window.
    HEALTH_ROUTE_ALIASES.DATABASE, // Alias of the Better Stack passive DB probe
    HEALTH_ROUTE_ALIASES.HEALTH_CHECK, // Alias of the deploy liveness probe
    '/api/v1/webhooks/stripe', // Stripe webhook — defense-in-depth (signature check remains primary)
    // Contract-declared endpoints with `limiterTier: 'strict'` (kernel API contracts).
    // <generated:contracts:strict-routes> from the API contracts by `npm run system:contracts`; do not edit
    ROUTES_API.CLIENT_GET_CONTACT_FOR_STYLIST,
    ROUTES_API.CLIENT_DELETE_CRM_NOTE,
    ROUTES_API.PAIRING_SESSION_ISSUE,
    ROUTES_API.PAIRING_SESSION_CLAIM,
    ROUTES_API.PAIR_REQUEST_CREATE,
    ROUTES_API.PAIR_REQUEST_RESPOND,
    ROUTES_API.PAIR_REQUEST_CANCEL,
    ROUTES_API.PAIRING_RESOLVE_PLACE,
    ROUTES_API.PAIRING_GET_PENDING_REQUESTS,
    ROUTES_API.PAIRING_GET_MY_PENDING_REQUESTS,
    ROUTES_API.NEWSLETTER_SUBSCRIBE,
    ROUTES_API.CONTACT_FORM_SUBMIT,
    ROUTES_API.SEND_LOG,
    ROUTES_API.ADMIN_SEND_ANNOUNCEMENT_NOTIFICATION,
    ROUTES_API.ADMIN_TEST_ANNOUNCEMENT_NOTIFICATION,
    ROUTES_API.USER_CHECK_RECOVERY,
    ROUTES_API.USER_EXPORT_DATA,
    ROUTES_API.USER_REQUEST_EMAIL_CHANGE,
    ROUTES_API.USER_DELETE_CONFIRM,
    ROUTES_API.USER_EMAIL_CHANGE_CONFIRM,
    ROUTES_API.ACCOUNT_CHECKOUT_RESULT,
    ROUTES_API.ACCOUNT_CHECKOUT_SESSION,
    ROUTES_API.ACCOUNT_PLAN_CHANGE_PREVIEW,
    ROUTES_API.ACCOUNT_PLAN_CHANGE,
    ROUTES_API.ACCOUNT_VAT_INVOICE_DETAILS,
    ROUTES_API.ACCOUNT_INCREMENT_VIEW,
    ROUTES_API.REPORT_GALLERY_RECORD,
    ROUTES_API.SALON_GALLERY_PUBLIC_GET,
    ROUTES_API.SALON_PROFILE_SLUG_AVAILABLE,
    ROUTES_API.SALON_PROFILE_PUBLIC_GET,
    ROUTES_API.SALON_STAFF_INVITE,
    ROUTES_API.SALON_STAFF_GET_ALL,
    ROUTES_API.SALON_STAFF_ACCEPT_TOKEN,
    ROUTES_API.DELETE_MANUAL_VISIT,
    // </generated:contracts:strict-routes>
  ] as string[],
  /** Maximum requests for strict endpoints (50 req/10s = 5 req/s) */
  STRICT_MAX_REQUESTS: 50,
  /** Maximum entries in rate limit store (prevents memory leak) */
  MAX_STORE_SIZE: 10000,
  /** Cleanup interval for expired entries (5 minutes) */
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
} as const;

// Strict endpoints whose live URL embeds a single-use token as a PATH segment (not a
// query param). Bucketing on the full path would mint a fresh window per token and
// defeat the strict cap — so the bucket key collapses to this token-less prefix.
// SSOT: same `split('[token]')[0]` prefix as the STRICT_ENDPOINTS entry. Currently only
// NEWSLETTER_CONFIRM carries a path token (the other token-confirm endpoints —
// USER_DELETE_CONFIRM / USER_EMAIL_CHANGE_CONFIRM — take the token in the body/query).
const STRICT_PATH_TOKEN_PREFIXES: string[] = [
  ROUTES_API.NEWSLETTER_CONFIRM.split('[token]')[0] ??
    ROUTES_API.NEWSLETTER_CONFIRM,
];

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

/**
 * Rate limiting store.
 *
 * DECISION: a per-process Map is the ACCEPTED design, not a stopgap: the backend runs as 1-2
 * instances, and a shared store (Redis / DB table) would add a dependency and put every login on
 * the database for no measurable gain. It resets on restart by design. Revisit only when the
 * instance count grows past two; do NOT "fix" this toward Redis. (owner)
 */
const rateLimitStore = new Map<string, RateLimitRecord>();

/**
 * Get client identifier from request (trust-aware IP).
 *
 * DECISION: `resolveTrustedClientIp` is TRUST-AWARE (trust-aware-ip.ts): a proven platform-edge
 * or trusted-proxy-depth IP, never the leftmost (client-supplied) X-Forwarded-For hop, which closes
 * the bypass where rotating XFF minted unlimited fresh buckets; IPv6 is keyed by its /64
 * (`toRateLimitIpKey`, same as Better Auth). Fallback: trusted header IP -> direct socket peer ->
 * literal 'unknown'. The 'unknown' bucket is shared (fail-closed: with no
 * trustworthy source everyone shares one window rather than each getting a fresh bypass bucket).
 */
const getClientIdentifier = (req: NextApiRequest): string => {
  const ip = resolveTrustedClientIp(
    req.headers,
    req.socket?.remoteAddress ?? null
  );
  return ip === null ? 'unknown' : toRateLimitIpKey(ip);
};

/**
 * Check if endpoint is a strict (sensitive) endpoint
 */
const isStrictEndpoint = (url: string | undefined): boolean => {
  if (!url) {
    return false;
  }
  return RATE_LIMIT_CONFIG.STRICT_ENDPOINTS.some(ep => url.startsWith(ep));
};

/**
 * Clean up expired entries periodically
 */
const cleanupExpiredEntries = (): void => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetTime) {
      rateLimitStore.delete(key);
    }
  }
};

/**
 * Enforce max store size by removing oldest entries
 */
const enforceMaxSize = (): void => {
  if (rateLimitStore.size <= RATE_LIMIT_CONFIG.MAX_STORE_SIZE) {
    return;
  }

  // First pass: remove expired entries
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetTime) {
      rateLimitStore.delete(key);
    }
  }

  // Second pass: if still over limit, remove oldest (FIFO)
  if (rateLimitStore.size <= RATE_LIMIT_CONFIG.MAX_STORE_SIZE) {
    return;
  }
  const entries = Array.from(rateLimitStore.entries());
  const toDelete = rateLimitStore.size - RATE_LIMIT_CONFIG.MAX_STORE_SIZE;
  for (let i = 0; i < toDelete; i++) {
    const entry = entries[i];
    if (entry === undefined) {
      break;
    }
    rateLimitStore.delete(entry[0]);
  }
};

// Cleanup every 5 minutes
const RATE_LIMIT_CLEANUP_TIMER = setInterval(
  cleanupExpiredEntries,
  RATE_LIMIT_CONFIG.CLEANUP_INTERVAL_MS
);
RATE_LIMIT_CLEANUP_TIMER.unref?.();

/**
 * Rate limiting result
 */
export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetTime: number;
};

/**
 * Check rate limit for a request
 */
export const checkRateLimit = (req: NextApiRequest): RateLimitResult => {
  const clientId = getClientIdentifier(req);
  const now = Date.now();
  const isStrict = isStrictEndpoint(req.url);
  const maxRequests = isStrict
    ? RATE_LIMIT_CONFIG.STRICT_MAX_REQUESTS
    : RATE_LIMIT_CONFIG.MAX_REQUESTS;
  const windowMs = RATE_LIMIT_CONFIG.WINDOW_MS;

  // Create unique key combining client and endpoint type.
  // DECISION: STRICT endpoints are bucketed PER-PATH (`${clientId}:strict:${pathname}`), not one
  // shared `${clientId}:strict`: a shared key let a flood of one strict endpoint (e.g.
  // /api/auth/) exhaust the window and block all the others of that client (email-change,
  // pairing-claim, contact-form...). pathname = req.url without the query, so `?token=` does not
  // split the bucket (one window per endpoint is desired for brute-force limits on token
  // oracles). Non-strict traffic keeps one key per client.
  //
  // DECISION: path-token endpoints (NEWSLETTER_CONFIRM carries its token as a PATH SEGMENT,
  // `.../newsletter-confirm/<token>`) collapse to their TOKEN-LESS prefix (same prefix as in
  // STRICT_ENDPOINTS). `split('?')[0]` leaves the token in the pathname, so every token minted a
  // fresh bucket and the hard cap 50/10s never fired (DB-read abuse: findUnique per garbage
  // token). Not collapsed per-prefix universally: `/api/auth/` deliberately buckets per-path
  // (independent windows), and prefix-collapse would merge them back into one DoS vector.
  const strictPathname = isStrict ? ((req.url ?? '').split('?')[0] ?? '') : '';
  const pathTokenPrefix = isStrict
    ? STRICT_PATH_TOKEN_PREFIXES.find(prefix =>
        strictPathname.startsWith(prefix)
      )
    : undefined;
  const bucketPath = pathTokenPrefix ?? strictPathname;
  const key = isStrict ? `${clientId}:strict:${bucketPath}` : clientId;

  const record = rateLimitStore.get(key);

  // If no record or window expired, create new one
  if (!record || now > record.resetTime) {
    // Enforce max size before adding new entry
    if (rateLimitStore.size >= RATE_LIMIT_CONFIG.MAX_STORE_SIZE) {
      enforceMaxSize();
    }

    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + windowMs,
    });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: now + windowMs,
    };
  }

  // Increment count
  record.count += 1;

  // Check if over limit
  if (record.count > maxRequests) {
    return { allowed: false, remaining: 0, resetTime: record.resetTime };
  }

  return {
    allowed: true,
    remaining: maxRequests - record.count,
    resetTime: record.resetTime,
  };
};

/**
 * Rate limit middleware for API handlers
 * Can be used as a wrapper or standalone check
 */
export const withRateLimitCheck = (
  req: NextApiRequest,
  res: NextApiResponse
): boolean => {
  const result = checkRateLimit(req);

  // Set rate limit headers
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

  if (!result.allowed) {
    res.setHeader(
      'Retry-After',
      Math.ceil((result.resetTime - Date.now()) / 1000)
    );

    reportIssueBackend({
      namespace: 'RATE_LIMIT',
      message: `Rate limit exceeded for ${getClientIdentifier(req)}`,
      payload: { url: req.url, remaining: result.remaining },
      mode: 'info',
    });

    res.status(asStatusCode(429)).json({
      event: APP_EVENTS.INFO.APPLICATION.RATE_LIMIT_EXCEEDED_INFO,
      data: {
        message: 'Too many requests, please try again later.',
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
      },
    });
    return false;
  }

  return true;
};
