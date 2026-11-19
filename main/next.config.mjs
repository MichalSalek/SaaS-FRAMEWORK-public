import bundleAnalyzer from '@next/bundle-analyzer';
import { readFileSync } from 'fs';
import path from 'path';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

// DECISION: build-next.mjs creates one stamp before spawning Next. Computing a
// clock here gave server/client bundles different minutes and broke hydration.
const BUILD_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION ?? 'dev';

// Shared `?v=` of owned static assets (written by `npm run assets:sync`; the
// same file feeds `refreshedAsset` in src/UI/assets/brandAssets.ts).
const ASSET_LIBRARY_VERSION = JSON.parse(
  readFileSync(
    new URL('./src/UI/assets/lp-assets.config.json', import.meta.url),
    'utf8'
  )
).version;

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

  // DECISION: Next 16 blocks cross-origin requests to dev-only endpoints (/_next/*, including the
  // HMR WebSocket) from any Origin outside allowedDevOrigins. The handshake is rejected and the Next
  // client reloads the page about every 50 s, so Fast Refresh is dead. The list is ALLOWED_DEV_ORIGINS
  // (CSV) from the BASE docker-compose.dev.yml (SSOT): the LAN IP and the Caddy domain. localhost is
  // always allowed, so the symptom never shows there; test HMR through the domain. Guard:
  // `npm run dev:preflight` (check D). Dev only.
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

  // DECISION: next.config.mjs is a plain ES module and cannot import the TypeScript kernel, so this
  // locale list is a manual mirror of I18N_CONFIG.locales (.shared-kernel/domain/i18n/i18n.config.ts,
  // the SSOT). A new locale goes in both places. localeDetection: false is intentional: the app has an
  // explicit switcher and an Accept-Language redirect would break bookmarked deep links.
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
    // Next's default widths jump from 384 straight to 640. A 230px phone
    // screenshot (the home hero, the LCP) on a 1.75x phone needs ~400px and
    // got 640, 2.5x the pixels; 448 and 512 close that gap.
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384, 448, 512],
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
      // DECISION: the Google host must stay here. The OAuth photo (`user.image`) is the middle link of
      // the avatar chain (own upload, OAuth image, initials); without the host the Next optimizer
      // rejects it and AvatarAtom silently falls back to initials. `lh3` is the host Google uses for
      // the token's `picture`; Google is the only enabled social provider (ENABLED_SOCIAL_PROVIDERS).
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
    ],
  },

  trailingSlash: true,

  // PostHog reverse proxy: Next's trailing-slash redirect must not touch the capture endpoints; a
  // redirect would break beacon delivery to /ingest.
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
    // Pre-launch SEO gate: the whole site is noindex until SEO_INDEXING_ENABLED is true (safe
    // default: unset or false means noindex). X-Robots-Tag is static, so it lives here (proxy.ts
    // stays the SSOT only for the per-request nonce CSP).
    const seoNoindex = ['true', '1'].includes(
      (process.env.SEO_INDEXING_ENABLED ?? '').trim().toLowerCase()
    )
      ? []
      : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];
    // The locale INDEX pages (`/pl` `/en` `/de`) bypass headers() and proxy.ts entirely (Next Pages
    // i18n limitation): they carry neither CSP nor X-Frame-Options. A matcher and a static CSP
    // were both tried and failed; a real fix needs SSR locale roots (LCP trade-off) or a meta CSP
    // (covers script-src, not frame-ancestors).
    // DECISION: accepted as is. Three marketing pages with no user input or forms are no realistic
    // XSS or clickjacking vector; every app, checkout and form route has CSP. A meta-CSP for
    // script-src is a post-launch option (owner).
    return [
      {
        source: '/(.*)',
        headers: [
          ...seoNoindex,
          // DECISION: DENY everywhere except
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
            // Stripe.js (custom Checkout / Payment Element) loads a cross-origin js.stripe.com
            // iframe without a CORP header; `credentialless` / `require-corp` block it
            // (ERR_BLOCKED_BY_RESPONSE on m-outer), so Stripe needs `unsafe-none`. Nothing in
            // main uses SharedArrayBuffer or cross-origin isolation, so nothing depends on COEP.
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
        // Private / PII routes (user galleries, account, panel, admin): ALWAYS noindex,
        // whatever SEO_INDEXING_ENABLED says. robots.txt already disallows these prefixes; this
        // header is a second layer for crawlers that ignore robots.txt but honour X-Robots-Tag.
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


      {
        source:
          '/:path((?!_next/|api/).*\\.(?:png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf))',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, stale-while-revalidate=86400',
          },
        ],
      },
      // VIDEO-KOD distribution files live under a SHA-256 directory. Working renders never enter
      // public/. A new picture, audio or caption gets a new digest, so this narrow path is immutable.
      {
        source: '/media/kod-na-blacie/:digest([a-f0-9]{64})/:file*',
        locale: false,
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // A request that carries the CURRENT library version (`?v=` from
      // lp-assets.config.json, exact match) names one immutable revision of
      // the file: `assets:sync` bumps the version whenever it publishes a
      // derivative, so a swapped file is always requested under a new URL.
      // Those URLs are cached for a year; the same path without the version,
      // or with an old one, keeps the 1 h tier above (Next applies the last
      // matching rule for a header key). A file swapped by hand WITHOUT
      // `assets:sync` must bump the version too, or browsers keep the old one.
      {
        source:
          '/:path((?!_next/|api/).*\\.(?:png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf))',
        has: [
          {
            type: 'query',
            key: 'v',
            // Next anchors `has.value` itself (^…$); escape it as a literal.
            value: ASSET_LIBRARY_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          },
        ],
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source:
          '/:path(analytics-bootstrap\\.js|sw\\.js|site\\.webmanifest|robots\\.txt|llms(?:-[a-z-]+)?\\.txt|(?!_next/|api/).*\\.md)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=300, stale-while-revalidate=3600',
          },
        ],
      },
      {
        source: '/.well-known/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }],
      },
    ];
  },

  async rewrites() {
    const backendUrl = getBackendUrl();

    // PostHog reverse proxy (anti-adblock, same-origin). EU host. See PostHogProvider.tsx.
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
    // Canonical host: www -> apex (SEO: one canonical domain). EXCLUDE /api/* (regex negative
    // lookahead): Next checks redirects BEFORE rewrites, so without the exclusion /api/auth and
    // /api/v1 on `www` would get a 308 instead of being proxied to web-1 (a broken fetch,
    // cross-origin after the redirect). http->https is NOT done in Next: Render/Cloudflare enforce
    // HTTPS at the edge, and a rule on x-forwarded-proto risks a LOOP when a proxy forwards over
    // HTTP with an `http` header. Active on PROD (host from the proxy header); in dev the `has`
    // condition does not match, so it is a no-op.
    return [
      {
        source: '/:path((?!api/).*)',
        has: [{ type: 'host', value: 'www.nailfolio.app' }],
        destination: 'https://nailfolio.app/:path',
        permanent: true,
      },


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

  // DECISION: /api/og/* loads `next/dist/compiled/@vercel/og` with a native import (see the DECISION
  // in pages/api/og/stylist/[identifier].ts), which file tracing cannot see. This include copies the
  // module, its wasm and font files, plus the card's Schibsted Grotesk TTFs (server-assets/og-fonts),
  // into standalone. The include alone does not prevent the 500: webpack rewrites
  // `new URL('./...', import.meta.url)` into an empty-protocol object, so only the native import works.
  outputFileTracingIncludes: {


    '*': ['node_modules/@img/sharp-wasm32/**/*'],
    '/api/og/stylist/[identifier]': [
      'node_modules/next/dist/compiled/@vercel/og/**',
      // Brand face of the card, read from disk at request time (see the DECISION in
      // pages/api/og/stylist/[identifier].ts).
      'server-assets/og-fonts/**',
    ],
  },

  // Local review media can exist in a developer's tree during a production build.
  // Keep those files out of every standalone trace as well as out of public/ and git.
  outputFileTracingExcludes: {
    '/*': ['src/.dev-films/**/*'],
  },

  transpilePackages: ['@base-ui-components/react'],

  // DECISION: Next's client entry always requires `build/polyfills/polyfill-module` (Array
  // at/flat/flatMap, Object.fromEntries/hasOwn, trimStart/trimEnd, Promise.finally,
  // Symbol.description, URL.canParse) whatever the browserslist says; PageSpeed flags it as legacy
  // JavaScript. Our syntax target (Next's default: chrome/edge/firefox 111, safari 16.4) has all of
  // them natively except URL.canParse (Chrome 120 / Safari 17); nothing of ours calls it and zod
  // feature-detects it, so the module is swapped for an empty file in the client build only. If a
  // dependency starts calling URL.canParse unguarded, restore the module or add that polyfill.
  // `turbopack: {}` must stay next to it: `next dev` defaults to Turbopack and EXITS when it finds
  // a `webpack` key without a `turbopack` one.
  turbopack: {},
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]build[\\/]polyfills[\\/]polyfill-module(?:\.js)?$/,
          path.join(
            new URL('.', import.meta.url).pathname,
            'scripts/build/no-legacy-polyfills.cjs'
          )
        )
      );
    }
    return config;
  },

  // React Compiler — auto-memoizes components/hooks at build time.
  // Top-level key in Next 16 (was experimental.reactCompiler in Next 15).
  // Default compilationMode 'infer'; bails out safely on components that opt out
  // of the Rules of React (those start with a documented 'use no memo' directive; inline lint
  // suppressions are disabled by noInlineConfig in eslint.config.mjs).
  // Requires babel-plugin-react-compiler (devDependency).
  reactCompiler: true,

  // Bundle optimization
  // CWV (render-blocking CSS): optimizeCss/critters was tried and rejected. It inlines the
  // critical CSS and loads the rest async, but the prerendered <html> has no data-theme (the
  // ZERO_FLASH runtime sets it before paint), so critters drops the `[data-theme=dark]` overrides
  // from the critical CSS and a dark-mode user gets a light flash until the async CSS arrives.
  // Render-blocking CSS has to be removed theme-aware (inline the full theme palette). The main LCP
  // lever is TTFB anyway (edge-cached SSG).
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
