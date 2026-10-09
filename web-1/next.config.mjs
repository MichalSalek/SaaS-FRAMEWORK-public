/** @type {import('next').NextConfig} */

const nextConfig = {
  async headers() {
    // noindex BEZWARUNKOWY: to backend API (api.nailfolio.app) — JSON + health,
    // NIGDY witryna do indeksu. Świadomie NIE wiążemy tego z SEO_INDEXING_ENABLED
    // (ten flag steruje publicznym frontem `main`; gdyby backend współdzielił env
    // i flaga poszła na true przy launchu, API wyciekłoby do indeksu). Root `/`
    // zwraca 404, co GSC flagował jako crawlowany 404 — noindex trzyma to poza
    // indeksem u źródła, niezależnie od env. (X-Robots-Tag = noindex; nie robots.txt.)
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          { key: 'X-XSS-Protection', value: '0' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'",
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },

  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // !! WARN !!
    // ignoreBuildErrors: true,
  },

  reactStrictMode: true,

  output:
    process.env.NODE_ENV_MANUAL === 'STAGING' ||
    process.env.NODE_ENV_MANUAL === 'DEVELOPMENT'
      ? 'standalone'
      : undefined,

  compress: true,

  typedRoutes: true,
};

export default nextConfig;
