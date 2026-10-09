import { NextResponse, type NextRequest } from 'next/server';
import { buildBackendBaseUrl } from './application/environment/backend-url';
import { runAfterResponse } from './application/runtime/run-after-response';
import {
  isTrackedPath,
  type TrackedPath,
} from '@kernel/domain/seo/ai-crawler-detection';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { ZERO_FLASH_SCRIPT_CSP_HASH } from './application/client-device-storage/zero-flash-script';
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
 * DECISION (nie usuwaj tego komentarza):
 * Tracking jest CALLED przez runAfterResponse() — na Vercel używa waitUntil()
 * (platforma trzyma function instance dopóki promise się nie rozwiąże), na
 * pozostałych runtime (Render, self-hosted) fall back na floating promise.
 * Best-effort tracking — utrata kilku zdarzeń przy cold start poza Vercel
 * jest akceptowalna (analytics nie-mission-critical).
 */
async function fireTrack(payload: {
  user_agent: string;
  path: TrackedPath;
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
 *
 * DECISION (nie usuwaj tego komentarza):
 * This MIRRORS the backend SSOT resolver (web-1/src/application/http/trust-aware-ip.ts)
 * so there is ONE trust strategy everywhere an IP is derived. It deliberately does
 * NOT take leftmost `x-forwarded-for` and does NOT read `cf-connecting-ip` ungated —
 * that was the exact spoof the backend was hardened against: a bare/non-overwriting
 * front passes client-supplied XFF / cf-connecting-ip through verbatim, so trusting
 * them on an unconfigured deployment lets a crawler/client set the stored analytics
 * IP arbitrarily. The backend module imports `node:http` and runs Node-only, so it
 * cannot be imported here (proxy.ts runs in the Edge runtime); the gated strategy is
 * ported instead. proxy.ts (Edge) has no socket peer, so when no trust is configured
 * we return null — the analytics IP is simply absent rather than spoofable. Tracking
 * is best-effort, so an absent IP on unconfigured deployments is acceptable.
 *
 * Trust order (identical to the backend):
 *  1. `TRUSTED_EDGE` edge header (cloudflare -> cf-connecting-ip,
 *     vercel -> x-vercel-forwarded-for) — only when explicitly configured.
 *  2. `x-forwarded-for` hop at `len - TRUSTED_PROXY_DEPTH` — only when
 *     `TRUSTED_PROXY_DEPTH` is explicitly set; left-of-boundary hops are ignored.
 *  3. `x-real-ip` last-resort hint — only while a trusted chain is configured.
 *  4. Otherwise null (unconfigured = trust no forwarding header).
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
 * - Generate a unique nonce per request, set on `x-nonce` request header so
 *   `_document.tsx` `getInitialProps` can read it and propagate to `<Head>`
 *   and `<NextScript>` (Pages Router pattern).
 * - DEV (every response dynamic): nonce + `'strict-dynamic'` (lets nonce-trusted
 *   scripts pull their own deps) + `'unsafe-eval'` (React Fast Refresh / HMR).
 * - PROD-mode (staging/preview/prod): pages are SSG, so `_document` runs at BUILD
 *   time and cannot carry a per-request nonce. nonce + `'strict-dynamic'` would
 *   then block EVERY un-nonced script — `'strict-dynamic'` disables `'self'`/host
 *   allowlists — i.e. zero hydration. So prod uses `'self'` (same-origin chunks) +
 *   the SHA-256 hash of the single inline script (ZERO_FLASH) + an explicit list of
 *   script hosts (`'strict-dynamic'` is impossible on SSG).
 *   No `'unsafe-inline'` → arbitrary inline injection stays blocked. Detail: the
 *   inline DECISION at `script-src` below.
 *
 * Other security headers (X-Frame-Options, HSTS, etc.) remain in
 * `next.config.mjs` because they don't need per-request values.
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

  // AI crawler tracking — fire-and-forget for tracked static SEO paths.
  // Runs BEFORE CSP header construction so we don't add latency to the
  // tracking decision; the fetch itself is non-awaited.
  const requestPath = request.nextUrl.pathname;
  if (isTrackedPath(requestPath)) {
    runAfterResponse(() =>
      fireTrack({
        user_agent: request.headers.get('user-agent') ?? '',
        path: requestPath,
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
    // DECISION (nie usuwaj tego komentarza):
    // Dwa tryby script-src wg sposobu renderu (patrz JSDoc proxy() wyzej):
    //  - DEV: dynamiczny render → nonce + 'strict-dynamic' dziala; Fast Refresh
    //    wymaga 'unsafe-eval'.
    //  - PROD-mode (SSG): brak per-request nonce'a w build-time _document. nonce +
    //    'strict-dynamic' zablokowalby WSZYSTKIE chunki (bez nonce'a, a
    //    strict-dynamic wylacza 'self'/host-allowlist) → zero hydracji. Dlatego:
    //    'self' (chunki) + hash jedynego inline'a (ZERO_FLASH) + js.stripe.com +
    //    zmierzona lista hostów (GTM, Clarity; patrz DECISION przy liście). BEZ
    //    'unsafe-inline' → arbitralny inline nadal zablokowany.
    isDev
      ? [
          "script-src 'self'",
          `'nonce-${nonce}'`,
          "'strict-dynamic'",
          "'unsafe-inline'", // CSP2 fallback (ignored when nonce honored)
          "'unsafe-eval'", // React Fast Refresh / HMR (dev only)
          'https://js.stripe.com',
          // Cloudflare Turnstile (anty-spam formularzy). Jawnie, mimo że
          // strict-dynamic/'https:' by przepuściły — nie polegamy na szerokich
          // fallbackach, które mogą kiedyś zniknąć.
          'https://challenges.cloudflare.com',
          'https:',
        ].join(' ')
      : [
          "script-src 'self'",
          ZERO_FLASH_SCRIPT_CSP_HASH,
          'https://js.stripe.com',
          // Stripe's own CSP guidance lists its versioned script subdomains too.
          'https://*.js.stripe.com',
          'https://challenges.cloudflare.com',
          // DECISION (nie usuwaj tego komentarza) — explicit host list, NOT 'https:':
          // script-src names every origin a script may load from. Scripts come only
          // from our origin, www.googletagmanager.com and www/scripts.clarity.ms.
          // ADDING A VENDOR IN GTM THAT LOADS A SCRIPT = ADD ITS HOST HERE, or it is
          // silently blocked. PostHog is same-origin (/ingest).
          'https://www.googletagmanager.com',
          'https://*.clarity.ms',
        ].join(' '),
    // Sonner toasts inject runtime <style> tags. Hash-based migration is
    // a separate task (LC-future); leaving unsafe-inline is acceptable
    // because style injection has lower exploit value than script injection.
    // DECISION (nie usuwaj tego komentarza):
    // Google Fonts removed from style-src and font-src (DD3-F11): next/font
    // self-hosts WOFF2 + injects CSS inline — no runtime fetch to Google.
    // Keeping allowances was dead CSP surface area.
    "style-src 'self' 'unsafe-inline'",
    // GTM + GA4 + Microsoft Clarity pixel/beacon (analityka przez GTM).
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
      // GTM + GA4 + Microsoft Clarity ingestion (analityka przez GTM).
      // PostHog NIE tu — jedzie same-origin przez /ingest (connect-src 'self').
      'https://www.googletagmanager.com',
      'https://*.google-analytics.com',
      'https://*.analytics.google.com',
      'https://region1.google-analytics.com',
      'https://www.clarity.ms',
      'https://*.clarity.ms',
    ]
      .filter(Boolean)
      .join(' '),
    // js.stripe.com + *.js.stripe.com (Payment Element ładuje ramki na subdomenach,
    // wymóg oficjalnego CSP Stripe) + hooks.stripe.com (3DS) + m.stripe.network (Radar fraud)
    // challenges.cloudflare.com = iframe widgetu Turnstile (frame-src NIE ma
    // szerokiego 'https:' — bez tego wpisu widget byłby zablokowany).
    `frame-src ${framePolicy.canEmbedSelf ? "'self' " : ''}https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://m.stripe.network https://www.googletagmanager.com https://challenges.cloudflare.com`,
    // PostHog SDK/replay zostają same-origin przez /ingest; potrzebny tylko blob-worker pod replay.
    "worker-src 'self' blob:",
    // DECISION (nie usuwaj tego komentarza): in production nothing frames this
    // app. On DEVELOPMENT and STAGING the owner-vote playground frames live
    // routes from the same origin (rationale in playground-frame.policy.ts).
    // CSP frame-ancestors takes precedence over static X-Frame-Options.
    `frame-ancestors ${framePolicy.canBeEmbeddedBySelf ? "'self'" : "'none'"}`,
    "base-uri 'self'",
    "object-src 'none'",
  ];

  const cspHeader = cspDirectives.join('; ');

  // Propagate the nonce to the request so `_document.tsx` `getInitialProps`
  // can read it via `ctx.req.headers['x-nonce']` and attach it to <Head>,
  // <NextScript>, and the inline ZERO_FLASH_SCRIPT.
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
 * Match all routes except API, Next.js internals, favicon, and the literal
 * root `/`.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Next 16 dev ma twardą regresję: matcher łapiący literalny `/` potrafi zwrócić
 * puste 200 dla
 * homepage. Objaw użytkowy: F5 na `/` = biały dokument, a client-side nav może
 * zrenderować home bez pageProps.messages, więc next-intl pokazuje surowe klucze.
 * Do czasu obejścia upstream wykluczamy tylko literalny root przez `.+`
 * (one-or-more). Wszystkie subpages i `/_next/data/...` nadal przechodzą przez
 * proxy.
 *
 * Matcher MUSI być literałem (Next 16 nie wspiera ConditionalExpression w
 * `config.matcher` — statyczna analiza), więc jeden wzorzec dla dev i prod.
 *
 * Prefetch responses (Next.js client-side router prefetch) są nadal proxowane
 * — regeneracja CSP to mikrosekundy i nic nie tracimy włączając je.
 *
 * Matcher standardowy Next (`/((?!...).+)`, path-to-regexp bez named-param).
 */
export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).+)',
};
