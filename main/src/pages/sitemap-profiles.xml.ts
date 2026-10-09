import type { GetServerSideProps } from 'next';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';
import { ENV_VARS } from '../application/environment/environment.config';

const DOMAIN = SEO_CONFIG.domain;
const LOCALES = I18N_CONFIG.locales;

type SitemapProfile = {
  identifier: string;
  updated_at: string;
};

function getBackendUrl(): string {
  const port = ENV_VARS.NEXT_PUBLIC_BACKEND_PUBLIC_PORT;
  return `${ENV_VARS.NEXT_PUBLIC_HTTP_PROTOCOL}${ENV_VARS.NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN}${port ? `:${port}` : ''}`;
}

function generateProfilesSitemap(profiles: SitemapProfile[]) {
  const urls = profiles.map(profile => {
    // next.config.mjs sets `trailingSlash: true` — sitemap URLs must match.
    const profilePath = `/stylist/${profile.identifier}/`;

    // Profile pages have the same content for all locales — use x-default + all locales point to same URL structure
    const alternates = LOCALES.map(locale => {
      const prefix = locale === 'pl' ? '' : `/${locale}`;
      const altUrl = `${DOMAIN}${prefix}${profilePath}`;
      return `      <xhtml:link rel="alternate" hreflang="${locale}" href="${altUrl}" />`;
    }).join('\n');

    return `  <url>
    <loc>${DOMAIN}${profilePath}</loc>
    <lastmod>${profile.updated_at}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
${alternates}
      <xhtml:link rel="alternate" hreflang="x-default" href="${DOMAIN}${profilePath}" />
  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>`;
}

function SitemapProfiles() {
  // getServerSideProps will handle response
  return null;
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  let profiles: SitemapProfile[] = [];

  try {
    const backendUrl = getBackendUrl();
    const apiUrl = `${backendUrl}${ROUTES_API.PUBLIC_GET_SITEMAP_PROFILES}`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const json = (await response.json()) as {
        data: { profiles: SitemapProfile[] };
      };
      profiles = json.data?.profiles ?? [];
    }
  } catch {
    // Graceful fallback — if backend is unavailable, generate empty sitemap
    // This prevents build failures when backend is down
  }

  const sitemap = generateProfilesSitemap(profiles);

  res.setHeader('Content-Type', 'text/xml');
  res.setHeader(
    'Cache-Control',
    'public, s-maxage=3600, stale-while-revalidate=1800'
  );
  res.write(sitemap);
  res.end();

  return {
    props: {},
  };
};

export default SitemapProfiles;
