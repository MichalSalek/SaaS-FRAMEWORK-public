/** @type {import('next').NextConfig} */

const nextConfig = {
  async headers() {
    // UNCONDITIONAL noindex: this is the backend API (api.example.com), JSON + health, never a
    // site to index. Deliberately NOT tied to SEO_INDEXING_ENABLED (that flag drives the public
    // `main` front; if the backend shared the env and the flag went true at launch, the API would
    // leak into the index). Root `/` returns 404, which GSC flagged as a crawled 404; noindex keeps
    // it out of the index at the source, whatever the env. (X-Robots-Tag noindex; not robots.txt.)
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
