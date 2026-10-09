import bundleAnalyzer from '@next/bundle-analyzer';
import path from 'path';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

// DECISION: build-next.mjs creates one stamp before spawning Next. Computing a
// clock here gave server/client bundles different minutes and broke hydration.
const BUILD_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION ?? 'dev';

/**
 * Build backend URL from env vars.
 * Used by API rewrites. CSP `connect-src` reads the same env vars
 * independently in `src/proxy.ts`.
 * @returns URL string or empty string if not configured
 */
const getBackendUrl = () => {
  const protocol = process.env.NEXT_PUBLIC_HTTP_PROTOCOL || 'https://';
  const domain = process.env.NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN;
  const port = process.env.NEXT_PUBLIC_BACKEND_PUBLIC_PORT;
  if (!domain) return '';
  return `${protocol}${domain}${port ? `:${port}` : ''}`;
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  env: {
    NEXT_PUBLIC_BUILD_VERSION: BUILD_VERSION,
  },

  // DECISION (nie usuwaj tego komentarza):
  // Next 15.2+/16 domyślnie BLOKUJE cross-origin requesty do dev-only assets i
  // endpointów (/_next/*, w tym HMR WebSocket /_next/webpack-hmr oraz
  // /__nextjs_original-stack-frames) z Origin spoza allowedDevOrigins — handshake
  // WS kończy się `socket.end('Unauthorized')`, a klient Next (pages/websocket.ts)
  // po WEB_SOCKET_MAX_RECONNECTIONS=12 ponowieniach (= 13 nieudanych handshake'ów;
  // backoff 5×1 s + 7×5 s = 40 s + handshake'i) robi window.location.reload()
  // => strona odświeża się co ~50 s bez zmian plików,
  // Fast Refresh martwy. Przeglądarka na devie używa dwóch originów: LAN IP hosta
  // (http://<lan-ip>:3000) i subdomeny Caddy LE (https://<dev-subdomain>).
  // Lista = ALLOWED_DEV_ORIGINS (CSV) z docker-compose.dev.yml (plik BAZOWY = SSOT;
  // regresja 2026-08-18 wzięła się z recreate'u bez override'a, w którym domena
  // siedziała). localhost/127.0.0.1 zawsze dozwolone — dlatego agenci na localhost
  // NIE widzą objawu: HMR testuj przez domenę. Strażnik: `npm run dev:preflight`
  // (check D). Dotyczy WYŁĄCZNIE dev (ignorowane w build/prod).
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    ...(process.env.ALLOWED_DEV_ORIGINS
      ? process.env.ALLOWED_DEV_ORIGINS.split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : []),
  ],

  // Changed from 'export' to conditional 'standalone' for SSR/SSG hybrid
  // - STAGING/PREVIEW/PRODUCTION: 'standalone' for Node.js deployment
  // - DEVELOPMENT: undefined (default) for dev server
  output:
    process.env.NODE_ENV_MANUAL === 'STAGING' ||
    process.env.NODE_ENV_MANUAL === 'PREVIEW' ||
    process.env.NODE_ENV_MANUAL === 'PRODUCTION'
      ? 'standalone'
      : undefined,

  // DECISION (nie usuwaj tego komentarza):
  // next.config.mjs is a plain ES module — it CANNOT import the TypeScript
  // shared-kernel (I18N_CONFIG in .shared-kernel/domain/i18n/i18n.config.ts).
  // Therefore the locale list is maintained manually here in sync with the kernel.
  //
  // SSOT for locales is I18N_CONFIG.locales in .shared-kernel/domain/i18n/i18n.config.ts.
  // Runtime paths (sitemaps, hreflang, language switcher) all read from I18N_CONFIG.
  //
  // When adding a new locale, update BOTH:
  //   1. .shared-kernel/domain/i18n/i18n.config.ts  (I18N_CONFIG.locales + LOCALE_LABELS)
  //   2. This array below
  //
  // localeDetection: false is intentional — the app uses an explicit locale switcher
  // and Accept-Language auto-redirect would break bookmarked deep links.
  i18n: {
    locales: ['pl', 'en', 'de'],
    defaultLocale: 'pl',
    localeDetection: false,
  },

  compress: true,

  compiler: {
    removeConsole:
      process.env.NODE_ENV !== 'development'
        ? { exclude: ['error', 'warn'] }
        : false,
  },

  devIndicators: false,

  images: {
    // High quality AVIF on the production WASM encoder delayed cold images.
    // WebP q95 keeps the detail with much faster first-view encoding.
    formats: ['image/webp'],
    qualities: [75, 90, 95],
    // Persistent image variants are retained for a year. Refreshed LP asset
    // request URLs use the shared version, so old variants cannot survive a swap.
    localPatterns: [
      // Owned static assets accept the library cache version, including brand icons.
      { pathname: '/**' },
    ],
    minimumCacheTTL: 31536000,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '/**',
      },
      // DECISION (nie usuwaj tego komentarza) — 2026-09-09, przy dowożeniu
      // uploadu avatara: zdjęcie z logowania Google (`user.image`) jest ŚRODKOWYM
      // ogniwem łańcucha avatara (własny upload → obraz z OAuth → inicjały), ale
      // hosta Google nie było na tej liście. Efekt: optymalizator obrazów Next
      // odrzucał adres, `onError` w AvatarAtom cichcem schodził na inicjały i to
      // ogniwo NIE ISTNIAŁO w praktyce — łańcuch miał dwa poziomy zamiast trzech,
      // a nikt tego nie zgłosił, bo degradacja jest bezgłośna. `lh3` to host,
      // którym Google podaje `picture` w tokenie; jedyny włączony dostawca
      // logowania społecznościowego to Google (ENABLED_SOCIAL_PROVIDERS).
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
    ],
  },

  trailingSlash: true,

  // Reverse-proxy PostHog: endpointy capture używają ścieżek z trailing slash;
  // redirect Next zepsułby dostarczanie beaconów do /ingest.
  skipTrailingSlashRedirect: true,

  typedRoutes: true,

  async headers() {
    // Content-Security-Policy is set per-request by src/proxy.ts (nonce-based,
    // Pages Router pattern). Keeping CSP out of static headers ensures the
    // proxy is the single source of truth and avoids two competing policies
    // racing on the same response.
    //
    // The headers below are static (don't depend on per-request state) and
    // remain here so they apply to every response, including API routes and
    // static assets that the proxy matcher excludes.
    //
    // Pre-launch SEO gate: noindex całej witryny dopóki SEO_INDEXING_ENABLED != true
    // (bezpieczny default — brak/false => noindex). X-Robots-Tag jest statyczny, więc
    // jego miejsce jest tu (proxy.ts zostaje SSOT tylko dla per-request CSP z nonce).
    const seoNoindex = ['true', '1'].includes(
      (process.env.SEO_INDEXING_ENABLED ?? '').trim().toLowerCase()
    )
      ? []
      : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];
    return [
      {
        source: '/(.*)',
        headers: [
          ...seoNoindex,
          // DECISION (nie usuwaj tego komentarza): DENY everywhere except
          // DEVELOPMENT/STAGING, where the /dev/playground vote shell frames live
          // routes from the same origin (policy + rationale:
          // src/application/security/playground-frame.policy.ts). This is the static
          // frame header for every route.
          {
            key: 'X-Frame-Options',
            value: ['DEVELOPMENT', 'STAGING'].includes(
              (process.env.NEXT_PUBLIC_NODE_ENV_MANUAL ?? '')
                .trim()
                .toUpperCase()
            )
              ? 'SAMEORIGIN'
              : 'DENY',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=(self)',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
          {
            // Stripe.js (custom Checkout / Payment Element) ładuje cross-origin
            // iframe js.stripe.com bez nagłówka CORP — `credentialless`/`require-corp`
            // blokują go (ERR_BLOCKED_BY_RESPONSE na m-outer). Stripe wymaga
            // `unsafe-none`. Brak SharedArrayBuffer/cross-origin-isolation w main,
            // więc to bezpieczne (nic nie zależy od COEP).
            key: 'Cross-Origin-Embedder-Policy',
            value: 'unsafe-none',
          },
          // Vary: Accept-Encoding only. Locales are path-prefixed (/en, /pl, /de)
          // with localeDetection:false, so content is NOT negotiated via the
          // Accept-Language header — adding it to Vary would fragment the CDN
          // cache by browser language for no correctness benefit.
          { key: 'Vary', value: 'Accept-Encoding' },
        ],
      },
      {
        // Prywatne / PII trasy (galerie userów, konto, panel, admin): ZAWSZE
        // noindex, niezależnie od bramki SEO_INDEXING_ENABLED. robots.txt już
        // Disallow'uje te prefiksy (crawl-block); ten nagłówek = belt-and-braces na
        // wypadek crawlerów ignorujących robots.txt, ale respektujących X-Robots-Tag.
        source: '/(app|user|salon|pairing|email|connection-check|admin)/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        // Native deep-link association (Universal Links). iOS fetches the AASA
        // (extension-less) and is happiest with application/json; force it so the
        // static handler never serves octet-stream/HTML. Must stay reachable at
        // https://<frontend>/.well-known/apple-app-site-association with NO
        // redirect (trailingSlash applies to routes, not /public files) and NO
        // auth/bot wall. Android assetlinks.json already carries its .json type.
        source: '/.well-known/apple-app-site-association',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
    ];
  },

  async rewrites() {
    const backendUrl = getBackendUrl();

    // Reverse-proxy PostHog (anti-adblock, same-origin). EU host. Patrz PostHogProvider.tsx.
    const posthogRewrites = [
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://eu-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/flags',
        destination: 'https://eu.i.posthog.com/flags',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ];

    if (!backendUrl) return posthogRewrites;

    return [
      ...posthogRewrites,
      {
        source: '/api/auth/:path*',
        destination: `${backendUrl}/api/auth/:path*`,
      },
      {
        source: '/api/v1/:path*',
        destination: `${backendUrl}/api/v1/:path*`,
      },
    ];
  },

  async redirects() {
    // Canonical host: www -> apex (SEO: jedna kanoniczna domena). EXCLUDE /api/*
    // (regex negative-lookahead): w Next redirects sa sprawdzane PRZED rewrites,
    // wiec bez wykluczenia /api/auth|/api/v1 na `www` dostawaloby 308 zamiast proxy
    // do web-1 (zerwany fetch, cross-origin po redirect). http->https NIE robimy w
    // Next: HTTPS jest wymuszany na brzegu, a regula na x-forwarded-proto
    // grozi PETLA, gdy proxy forwarduje po HTTP z naglowkiem `http`. Aktywne na PROD
    // (host z naglowka proxy); w dev warunek `has` nie pasuje = no-op.
    return [
      {
        source: '/:path((?!api/).*)',
        has: [{ type: 'host', value: 'www.nailfolio.app' }],
        destination: 'https://nailfolio.app/:path',
        permanent: true,
      },
      // nailfolio.pl (domena defensywna) -> nailfolio.app (canonical .app). 301, EXCLUDE /api/*.
      // Origin: nailfolio.pl trafia do tego samego Node hostingu, wiec request z
      // host=nailfolio.pl dostaje tu 301 do .app (jeden build obsluguje oba).
      {
        source: '/:path((?!api/).*)',
        has: [{ type: 'host', value: 'nailfolio.pl' }],
        destination: 'https://nailfolio.app/:path',
        permanent: true,
      },
      {
        source: '/:path((?!api/).*)',
        has: [{ type: 'host', value: 'www.nailfolio.pl' }],
        destination: 'https://nailfolio.app/:path',
        permanent: true,
      },
    ];
  },

  // webVitalsAttribution: ['CLS', 'LCP'],

  outputFileTracingRoot: path.join(
    new URL('.', import.meta.url).pathname,
    '../'
  ),

  // DECISION (nie usuwaj tego komentarza):
  // /api/og/* renderuje branded OG PNG przez `next/dist/compiled/@vercel/og`
  // (unstable_createNodejsStream), które ŁADUJE DYNAMICZNIE resvg.wasm + yoga.wasm
  // + Geist-Regular.ttf w runtime. outputFileTracing NIE wykrywa tych plików (brak
  // statycznego importu), więc standalone-bundle na Node hostingu ich nie miał →
  // KAŻDY /api/og/* zwracał 500 (satori nie wyrenderuje bez WASM/fontu; dev OK bo
  // node_modules pełne).
  // Jawny include kopiuje je do standalone dla tej trasy.
  outputFileTracingIncludes: {
    // sharp na Node hostingu bez natywnych binarek dla platformy odpala fallback
    // WASM (@img/sharp-wasm32). Node-file-trace NIE śledzi
    // dynamicznego require wariantów platformowych sharpa i kopiował z pakietu
    // tylko package.json (bez lib/*.node.wasm) → /_next/image serwował ORYGINAŁ
    // bez resize (w=256 i w=640 = identyczne bajty co oryginał). Wymuszamy pełny pakiet w standalone; deploy-frontend
    // ma ensure-step (dogrywa @img/sharp-wasm32 przed buildem) + guard
    // hard-abort na brak binarki w standalone.
    '*': ['node_modules/@img/sharp-wasm32/**/*'],
    '/api/og/stylist/[identifier]': [
      'node_modules/next/dist/compiled/@vercel/og/**',
    ],
  },

  transpilePackages: ['@base-ui-components/react'],

  // React Compiler (FQC W2.1) — auto-memoizes components/hooks at build time.
  // Top-level key in Next 16 (was experimental.reactCompiler in Next 15).
  // Default compilationMode 'infer'; bails out safely on components that opt out
  // of the Rules of React (those carry a documented react-compiler eslint-disable).
  // Requires babel-plugin-react-compiler (devDependency).
  reactCompiler: true,

  // Bundle optimization
  // CWV (render-blocking CSS) — optimizeCss/critters ODRZUCONE 2026-07-08 (próba +
  // walidacja prod-build). critters inline'uje critical + async-uje resztę, ALE
  // prerender <html> nie ma data-theme (motyw ustawia runtime ZERO_FLASH przed
  // paintem) → critters wyrzuca `[data-theme=dark]` override'y z critical → dark-mode
  // user dostaje light-FOUC do doładowania async-CSS = regresja ZERO_FLASH. Render-
  // blocking CSS trzeba zdjąć theme-aware (inline pełnej palety motywu), nie
  // generycznym critters. Pierwotny LCP-lever i tak = TTFB (edge-cache SSG).
  experimental: {
    optimizePackageImports: [
      '@phosphor-icons/react',
      '@tanstack/react-query',
      'better-auth',
      'clsx',
      'dayjs',
      'next-intl',
      'sonner',
    ],
  },
};

export default withBundleAnalyzer(nextConfig);
