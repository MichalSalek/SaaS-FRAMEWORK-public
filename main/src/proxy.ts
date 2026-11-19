import { NextResponse, type NextRequest } from 'next/server';
import { buildBackendBaseUrl } from './application/environment/backend-url';
import { runAfterResponse } from './application/runtime/run-after-response';
import { shouldTrackCrawlerRequest } from '@kernel/domain/seo/ai-crawler-detection';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { ZERO_FLASH_SCRIPT_CSP_HASH } from './application/client-device-storage/zero-flash-script';
import { CONSENT_DEFAULT_SCRIPT_CSP_HASH } from './application/analytics/consent-default-script';
import { ARE_DEV_ROUTES_ENABLED } from './application/environment/environment.possibilities.api';
import { resolvePlaygroundFramePolicy } from './application/security/playground-frame.policy';
import { trailingSlashTarget } from './application/routing/trailing-slash';

/**
 * Generate a base64-encoded nonce for CSP using Web Crypto API.
 *
 * Uses `crypto.randomUUID()` which is available in the Edge / Node proxy
 * runtime without importing `node:crypto`. Buffer is polyfilled by Next.js
 * in this runtime.
 */
const generateNonce = (): string =>
  Buffer.from(crypto.randomUUID()).toString('base64');

/**
 * Fire-and-forget POST to the backend internal tracking endpoint.
 *
 * Must not throw — proxy.ts runs in Edge runtime and must always return a
 * response quickly. We use AbortSignal.timeout(1500) so a slow/unreachable
 * backend cannot prolong the request beyond ~1.5s in the worst case (where
 * the proxy synchronously awaits; we don't await here).
 *
 * Tracking goes through runAfterResponse(): on Vercel it uses waitUntil() (the platform keeps the
 * instance alive until the promise settles), elsewhere (Render, self-hosted) a floating promise.
 * Best-effort: losing a few events on a cold start outside Vercel is acceptable.
 */
async function fireTrack(payload: {
  user_agent: string;
  path: string;
  ip_address: string | null;
  country: string | null;
}): Promise<void> {
  const backendUrl = buildBackendBaseUrl();
  const secret = process.env.INTERNAL_SHARED_SECRET;
  if (!backendUrl || !secret) {
    return;
  }

  try {
    await fetch(`${backendUrl}${ROUTES_API.INTERNAL_TRACK_CRAWLER}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': secret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Silent fail — tracking is best-effort, never block response
  }
}

/**
 * Trust-aware client-IP extraction for the Edge runtime (analytics only).
 * DECISION: this MIRRORS the backend SSOT resolver (web-1/src/application/http/trust-aware-ip.ts)
 * so one trust strategy applies wherever an IP is derived. It does NOT take the leftmost
 * `x-forwarded-for` and does NOT read `cf-connecting-ip` ungated: a bare front passes
 * client-supplied values through, so a client could set the stored analytics IP arbitrarily. The
 * backend module imports `node:http` and cannot run in the Edge runtime, hence the port. proxy.ts
 * has no socket peer, so with no trust configured it returns null (absent, not spoofable).
 *
 * Trust order (identical to the backend):
 *  1. `TRUSTED_EDGE` edge header (cloudflare -> cf-connecting-ip, vercel -> x-vercel-forwarded-for).
 *  2. `x-forwarded-for` hop at `len - TRUSTED_PROXY_DEPTH` (left-of-boundary hops ignored).
 *  3. `x-real-ip` last-resort hint, only while a trusted chain is configured.
 *  4. Otherwise null. Every step applies only when explicitly configured.
 */
function getTrustedEdgeHeaderName(): string | null {
  const edge = process.env.TRUSTED_EDGE?.trim().toLowerCase();
  if (edge === 'cloudflare') {
    return 'cf-connecting-ip';
  }
  if (edge === 'vercel') {
    return 'x-vercel-forwarded-for';
  }
  return null;
}

function getTrustedProxyDepthOrNull(): number | null {
  const raw = process.env.TRUSTED_PROXY_DEPTH?.trim();
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1; // configured-but-malformed -> single trusted hop (intent is clear)
  }
  return parsed;
}

function extractIpAddress(request: NextRequest): string | null {
  // 1. Trusted edge header (opt-in via TRUSTED_EDGE; overwritten by the edge).
  const edgeHeader = getTrustedEdgeHeaderName();
  if (edgeHeader) {
    const edgeIp = request.headers.get(edgeHeader)?.split(',')[0]?.trim();
    if (edgeIp) {
      return edgeIp;
    }
  }

  // 2. XFF resolved by trusted-proxy depth — only when explicitly configured.
  const depth = getTrustedProxyDepthOrNull();
  if (depth === null) {
    // Unconfigured: no forwarding header is trustworthy and there is no socket
    // peer in the Edge runtime -> store no IP rather than a spoofable one.
    return null;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map(h => h.trim())
      .filter(h => h.length > 0);
    if (hops.length > 0) {
      // index from the right (proxies append right); clamp so an under-length
      // chain degrades to the leftmost AVAILABLE trusted entry, never OOB.
      const hop = hops[Math.max(0, hops.length - depth)];
      if (hop) {
        return hop;
      }
    }
  }

  // 3. Last-resort hint (only reachable while a trusted chain is configured).
  const real = request.headers.get('x-real-ip')?.trim();
  return real && real.length > 0 ? real : null;
}

/**
 * CSP nonce-based proxy (Next.js 16+ `proxy.ts`, formerly `middleware.ts`).
 *
 * Strategy:
 * - A unique nonce per request on the `x-nonce` request header, read by `_document.tsx`.
 * - DEV (every response dynamic): nonce + `'strict-dynamic'` + `'unsafe-eval'` (Fast Refresh/HMR).
 * - PROD-mode (staging/preview/prod): pages are SSG, so `_document` runs at BUILD time and cannot
 *   carry a per-request nonce; nonce + `'strict-dynamic'` would block every un-nonced script
 *   (zero hydration). So: `'self'` + the SHA-256 hashes of the two inline scripts (ZERO_FLASH,
 *   CONSENT_DEFAULT) + `js.stripe.com` + a measured host list (Turnstile, GTM, Clarity). No
 *   `'https:'` (it would turn any markup injection into a remote script load) and no
 *   `'unsafe-inline'`. Detail: the DECISION at `script-src` below.
 * Other security headers (X-Frame-Options, HSTS, etc.) stay in `next.config.mjs`.
 */
export function proxy(request: NextRequest): NextResponse {
  // Canonical trailing slash for page routes (rationale in trailing-slash.ts).
  // First, so a redirect costs neither tracking nor CSP work.
  const slashTarget = trailingSlashTarget(
    request.method,
    request.nextUrl.pathname,
    request.headers.has('x-nextjs-data')
  );
  if (slashTarget !== null) {
    // Built from the RAW request path (it keeps the /en or /de prefix) on the
    // public origin (Host header), as a plain string: NextResponse.redirect()
    // re-formats a NextURL and drops the trailing slash under this config
    // (measured: `/en/get-app` → itself, a loop), and a relative Location is
    // rejected by the middleware runtime (ERR_INVALID_URL).
    const raw = new URL(request.url);
    const location = `${request.nextUrl.origin}${raw.pathname}/${raw.search}`;
    return new NextResponse(null, {
      status: 301,
      headers: { Location: location },
    });
  }

  // AI crawler tracking — fire-and-forget after the response. Machine files
  // (llms*, robots, sitemaps, *.md mirrors) for every caller but our own
  // monitoring; any page only for AI assistants / AI search bots, GPTBot and
  // Bingbot (rule and its cheap path: shouldTrackCrawlerRequest in the kernel).
  // GET/HEAD only: a bot reads, a POST to a page is never a crawl.
  // The decision reads `nextUrl.pathname` (locale prefix stripped, same
  // classification); the STORED path is the raw one, so /en/pricing/ and
  // /pricing/ stay apart in the stats.
  const requestPath = request.nextUrl.pathname;
  const userAgent = request.headers.get('user-agent') ?? '';
  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    shouldTrackCrawlerRequest(requestPath, userAgent)
  ) {
    runAfterResponse(() =>
      fireTrack({
        user_agent: userAgent,
        path: new URL(request.url).pathname,
        ip_address: extractIpAddress(request),
        country: request.headers.get('cf-ipcountry') ?? null,
      })
    );
  }

  const nonce = generateNonce();
  const isDev = process.env.NODE_ENV === 'development';
  const backendUrl = buildBackendBaseUrl();
  const framePolicy = resolvePlaygroundFramePolicy(
    requestPath,
    ARE_DEV_ROUTES_ENABLED()
  );

  const cspDirectives: Array<string> = [
    "default-src 'self'",
    // DECISION: two script-src modes by render style (see the JSDoc of proxy()). DEV is dynamic: nonce
    // + 'strict-dynamic' works, Fast Refresh needs 'unsafe-eval'. PROD-mode is SSG: no per-request
    // nonce exists in the build-time _document, and nonce + 'strict-dynamic' would block ALL chunks
    // ('strict-dynamic' disables 'self'/host allowlists), i.e. zero hydration. So: 'self' (chunks) +
    // hashes of the two inline scripts (ZERO_FLASH, CONSENT_DEFAULT) + js.stripe.com + the measured
    // host list below. No 'unsafe-inline', so arbitrary inline injection stays blocked.
    isDev
      ? [
          "script-src 'self'",
          `'nonce-${nonce}'`,
          "'strict-dynamic'",
          "'unsafe-inline'", // CSP2 fallback (ignored when nonce honored)
          "'unsafe-eval'", // React Fast Refresh / HMR (dev only)
          'https://js.stripe.com',
          // Cloudflare Turnstile (form anti-spam). Listed explicitly even though
          // strict-dynamic/'https:' would let it through: do not rely on broad fallbacks that may
          // go away.
          'https://challenges.cloudflare.com',
          'https:',
        ].join(' ')
      : [
          "script-src 'self'",
          ZERO_FLASH_SCRIPT_CSP_HASH,
          CONSENT_DEFAULT_SCRIPT_CSP_HASH,
          'https://js.stripe.com',
          // Stripe's own CSP guidance lists its versioned script subdomains too.
          'https://*.js.stripe.com',
          'https://challenges.cloudflare.com',

          'https://www.googletagmanager.com',
          'https://*.clarity.ms',
        ].join(' '),
    // Sonner toasts inject runtime <style> tags. Hash-based migration is
    // a separate task; leaving unsafe-inline is acceptable
    // because style injection has lower exploit value than script injection.
    // No Google Fonts in style-src/font-src: next/font self-hosts WOFF2 and injects the CSS inline.
    "style-src 'self' 'unsafe-inline'",
    // GTM + GA4 + Microsoft Clarity pixel/beacon (analytics opt-OUT through GTM).
    "img-src 'self' data: blob: https://res.cloudinary.com https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://region1.google-analytics.com https://www.clarity.ms https://*.clarity.ms",
    "font-src 'self' data:",
    [
      "connect-src 'self'",
      backendUrl,
      'https://api.stripe.com',
      // Stripe Radar/fraud (m.stripe.network/out.js) + metrics beacon (m.stripe.com)
      'https://m.stripe.com',
      'https://m.stripe.network',
      'https://api.cloudinary.com',
      'https://res.cloudinary.com',
      'https://api.ipify.org',
      // GTM + GA4 + Microsoft Clarity ingestion (analytics opt-OUT through GTM).
      // PostHog is not listed: it goes same-origin through /ingest (connect-src 'self').
      'https://www.googletagmanager.com',
      'https://*.google-analytics.com',
      'https://*.analytics.google.com',
      'https://region1.google-analytics.com',
      'https://www.clarity.ms',
      'https://*.clarity.ms',
    ]
      .filter(Boolean)
      .join(' '),
    // js.stripe.com + *.js.stripe.com (the Payment Element loads frames on subdomains, required by
    // Stripe's official CSP) + hooks.stripe.com (3DS) + m.stripe.network (Radar fraud).
    // challenges.cloudflare.com = the Turnstile widget iframe (frame-src has no broad 'https:', so
    // without this entry the widget would be blocked).
    `frame-src ${framePolicy.canEmbedSelf ? "'self' " : ''}https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://m.stripe.network https://www.googletagmanager.com https://challenges.cloudflare.com`,
    // PostHog SDK/replay stay same-origin through /ingest; only a blob worker for replay is needed.
    "worker-src 'self' blob:",
    // DECISION: in production nothing frames this app. On DEVELOPMENT and STAGING the owner-vote
    // playground frames live routes from the same origin (rationale in playground-frame.policy.ts).
    // CSP frame-ancestors takes precedence over the static X-Frame-Options.
    `frame-ancestors ${framePolicy.canBeEmbeddedBySelf ? "'self'" : "'none'"}`,
    "base-uri 'self'",
    "object-src 'none'",
  ];

  const cspHeader = cspDirectives.join('; ');

  // Propagate the nonce to the request so `_document.tsx` `getInitialProps`
  // can read it via `ctx.req.headers['x-nonce']` and attach it to <Head>,
  // <NextScript>, and the inline ZERO_FLASH and CONSENT_DEFAULT scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Also set CSP on the response so the browser enforces it.
  response.headers.set('Content-Security-Policy', cspHeader);

  return response;
}

/**
 * Match all routes except API, Next.js internals, favicon, and the literal root `/`.
 * DECISION: root `/` should get a CSP, but a matcher that catches the literal `/` can return an
 * empty 200 for the homepage in Next 16 dev (blank document; client nav can render home without
 * pageProps.messages, so next-intl shows raw keys). Only the literal root is excluded, via `.+`;
 * the matcher must be a literal (no ConditionalExpression), so one pattern serves dev and prod.
 * next.config.mjs `headers()` sets no fallback CSP, so `/` has none.
 * DECISION: the locale-INDEX routes (`/pl` `/en` `/de`) do NOT pass through this middleware:
 * Next Pages-i18n renders them so that `NextResponse.next()` headers never arrive (the matcher
 * form makes no difference). These 3 roots have NO CSP; a static `source: '/(pl|en|de)'` header
 * does not catch them either (rationale at `headers()` in next.config.mjs). Accepted. (owner)
 */
export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).+)',
};
