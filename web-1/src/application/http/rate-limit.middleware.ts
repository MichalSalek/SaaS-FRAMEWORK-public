import type { NextApiRequest, NextApiResponse } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { HEALTH_ROUTE_ALIASES } from '@app/health/health-route-aliases';
import { asStatusCode } from './http.utils.api';
import { extractIpFromNodeHeaders } from './extract-client-info';

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
    '/api/auth/', // Better Auth prefix — no ROUTES_API constant (external library)
    ROUTES_API.CLIENT_GET_CONTACT_FOR_STYLIST, // Client contact access - prevent scraping
    ROUTES_API.NEWSLETTER_SUBSCRIBE, // Newsletter subscribe - prevent abuse
    ROUTES_API.PAIR_REQUEST_CANCEL, // Pair-request cancel: mutacja pairingu bez dodatkowej frykcji — STRICT domyka wektor spam-cancel (parytet z resztą wrażliwych mutacji pairingowych)
    // DD-M2: public GET token oracle + DB write. The kernel constant carries a `[token]`
    // dynamic segment (`.../newsletter-confirm/[token]`); the live request URL substitutes
    // the real token, so we strip the segment and match on the prefix (isStrictEndpoint
    // uses url.startsWith). Prefix derived from SSOT — stays in sync with API_VER changes.
    ROUTES_API.NEWSLETTER_CONFIRM.split('[token]')[0], // Confirm token brute-force + write abuse
    ROUTES_API.NEWSLETTER_UNSUBSCRIBE, // DD-L2: public unauthenticated — parity with EMAIL_UNSUBSCRIBE
    ROUTES_API.USER_CHECK_RECOVERY, // Public unauthenticated — user-enumeration oracle (leaks deleted_at); strict IP limit slows enumeration
    ROUTES_API.USER_EXPORT_DATA, // GDPR data export - rate limited to 1/24h via EventLog, strict IP limit as defense-in-depth
    ROUTES_API.PAIRING_SESSION_CLAIM, // QR token brute-force prevention
    ROUTES_API.PAIRING_SESSION_ISSUE, // Resource creation abuse prevention
    ROUTES_API.PAIR_REQUEST_CREATE, // Stały QR: spam prośbami o połączenie (publiczny profil = znany cel)
    ROUTES_API.PAIR_REQUEST_RESPOND, // Stały QR: mutacja pary (accept/decline) — parytet z claim
    ROUTES_API.PAIRING_GET_PENDING_REQUESTS, // Stały QR: lista próśb (imiona klientek) — anty-scraping, parytet z CLIENT_GET_CONTACT
    ROUTES_API.USER_REQUEST_EMAIL_CHANGE, // Account takeover vector
    ROUTES_API.USER_EMAIL_CHANGE_CONFIRM, // Public GET token-confirm — flips email + purges sessions; brute/abuse of single-use token (parity with request side)
    ROUTES_API.USER_DELETE_CONFIRM, // Public GET token-confirm — soft-deletes account; brute/abuse of single-use token
    ROUTES_API.EMAIL_UNSUBSCRIBE, // Public unauthenticated endpoint — prevent abuse
    ROUTES_API.REPORT_GALLERY_RECORD, // Content report abuse prevention (also has 5/hour app-level limit)
    ROUTES_API.CONTACT_FORM_SUBMIT, // Triggers real email delivery — prevent spam/flooding
    ROUTES_API.SEND_LOG, // Public log endpoint — prevent DB flooding
    ROUTES_API.INTERNAL_TRACK_CRAWLER, // Internal S2S analytics — prevent INSERT-flood DoS via /llms.txt spam
    ROUTES_API.INTERNAL_HEALTH_PUBLIC, // Public uptime health endpoint — bot DDOS protection (30 req/min = 1 ping/2s OK, scraping blocked)
    ROUTES_API.INTERNAL_SWEEP_TICK, // External sweep clock — one monitor call every few minutes at most; anything faster is abuse
    // DECISION (nie usuwaj tego komentarza):
    // Aliasy health MUSZĄ być w strict-tierze razem z kanonicznym INTERNAL_HEALTH_PUBLIC.
    // Trafiają w ten sam handler (albo w jego bliźniaka), ale pod innym URL-em — bez tych
    // wpisów nieuwierzytelniony skaner omijał strict-cap, hamerował je za darmo i zjadał
    // WSPÓLNY non-strict bucket per-IP, którym płaci realny ruch produktowy. Ścieżki idą
    // ze stałej (`health-route-aliases.ts`), żeby plik trasy i limiter nie mogły się
    // rozjechać. Bucketowanie zostaje per-path, więc każdy alias ma własne okno.
    HEALTH_ROUTE_ALIASES.DATABASE, // Alias pasywnego DB-probe'a Better Stack
    HEALTH_ROUTE_ALIASES.HEALTH_CHECK, // Alias liveness-probe'a deployu
    ROUTES_API.ACCOUNT_VAT_INVOICE_DETAILS, // Fan-out do live-konta Stripe (customer.update + tax_ids.list + create) przy każdym wywołaniu
    ROUTES_API.ACCOUNT_CHECKOUT_SESSION, // Parytet: mint sesji płatności = ruch do live-Stripe
    ROUTES_API.ACCOUNT_PLAN_CHANGE, // Parytet: subscription.update z proracją = ruch do live-Stripe
    ROUTES_API.ACCOUNT_INCREMENT_VIEW, // Unauthenticated DB-write (view counter) — cap write-amplification volume (dedup is primary)
    ROUTES_API.DELETE_MANUAL_VISIT, // Destructive, irreversible delete (visit + cascade photos) — auth-gated, strict as defense-in-depth
    ROUTES_API.CLIENT_DELETE_CRM_NOTE, // Destrukcyjne kasowanie notatki CRM (decyzja D4: w każdym stanie pary) — auth-gated, STRICT jak DELETE_MANUAL_VISIT
    '/api/v1/webhooks/stripe', // Stripe webhook — defense-in-depth (signature check remains primary)
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
 * DECISION (nie usuwaj tego komentarza):
 * A fixed-window counter per key (count + resetTime) is the ACCEPTED design
 * (owner, 2026-06-16), not a stopgap.
 */
const rateLimitStore = new Map<string, RateLimitRecord>();

/**
 * Get client identifier from request (trust-aware IP).
 *
 * DECISION (nie usuwaj tego komentarza):
 * `extractIpFromNodeHeaders` is now TRUST-AWARE (trust-aware-ip.ts) — it returns
 * a platform-edge / trusted-proxy-depth IP, never the leftmost (client-supplied)
 * X-Forwarded-For hop. This closes the rate-limit bypass where rotating XFF minted
 * unlimited fresh buckets. Fallback order: trusted header IP -> direct socket peer
 * -> literal 'unknown'. The 'unknown' bucket is shared (fail-closed: when we cannot
 * trust any source, everyone shares one throttle window rather than each getting a
 * fresh bypass bucket).
 */
const getClientIdentifier = (req: NextApiRequest): string =>
  extractIpFromNodeHeaders(req.headers) ??
  req.socket?.remoteAddress ??
  'unknown';

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
  // DECISION (nie usuwaj tego komentarza):
  // STRICT endpoints są bucketowane PER-PATH (`${clientId}:strict:${pathname}`),
  // nie jednym wspólnym `${clientId}:strict`. Wspólny klucz był wektorem DoS:
  // flood jednego strict endpointu (np. /api/auth/) wyczerpywał okno i blokował
  // WSZYSTKIE pozostałe strict endpointy tego klienta (password-reset, email-change,
  // pairing-claim, contact-form...). Per-path izolacja daje każdemu strict endpointowi
  // własne, niezależne okno licznika. pathname = req.url bez query (?token=... nie
  // rozszczepia bucketu — ten sam endpoint z różnymi tokenami dzieli jedno okno,
  // co jest pożądane dla limitów brute-force na token oracles).
  // Non-strict ruch zostaje przy jednym kluczu per-klient (`clientId`) — bez zmian.
  //
  // DECISION (nie usuwaj tego komentarza):
  // Query-token endpointy collapse'ują przez `split('?')[0]` (token w ?token=… odpada).
  // Ale NEWSLETTER_CONFIRM niesie token jako SEGMENT ŚCIEŻKI (`.../newsletter-confirm/<token>`)
  // — split('?')[0] zostawia token w pathname, więc KAŻDY token mintował świeży bucket
  // (count=1) i twardy cap 50/10s nigdy się nie odpalał (DoS/DB-read-abuse: findUnique per
  // śmieciowy token). Fix: dla path-token endpointów zwiń klucz do ich TOKEN-LESS prefixu
  // (SSOT: ten sam prefix co w STRICT_ENDPOINTS). NIE zwijamy per-prefix uniwersalnie —
  // `/api/auth/` celowo bucketuje per-path (różne auth-endpointy = niezależne okna, patrz
  // wyżej), a prefix-collapse scaliłby je z powrotem w jeden wektor DoS.
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
