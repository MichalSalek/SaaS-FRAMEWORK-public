import type { GetServerSideProps } from 'next';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import { ROUTES_FRONT_STATIC } from '@kernel/domain/routing/routing.config';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';

const DOMAIN = SEO_CONFIG.domain;
const LOCALES = I18N_CONFIG.locales;

/**
 * Fixed lastmod date for static pages.
 * Updated manually when static content changes significantly.
 *
 * DECISION: this date is a CONSTANT set BY HAND and must NOT be computed from `new Date()`, build
 * time or BUILD_ID. Google treats `lastmod` as a declaration of the last SIGNIFICANT content change
 * and ignores the signal for the whole domain once every URL gets a fresh stamp on each crawl/deploy
 * (a deploy may change no content at all). An auto-`now` looks like fixing a dead constant but
 * removes the only signal that speeds up re-crawl after a real content change. Bump THIS constant
 * in the commit that changes static page content (copy, JSON-LD, sections).
 */
const STATIC_LASTMOD = '2026-10-14T00:00:00.000Z';

type StaticPageConfig = {
  path: string;
  changefreq: 'daily' | 'weekly' | 'monthly';
  priority: string;
};

const STATIC_PAGES: StaticPageConfig[] = [
  { path: ROUTES_FRONT_STATIC.HOME, changefreq: 'daily', priority: '1.0' },
  {
    path: ROUTES_FRONT_STATIC.FOR_STYLISTS,
    changefreq: 'weekly',
    priority: '0.9',
  },
  {
    path: ROUTES_FRONT_STATIC.FOR_CLIENTS,
    changefreq: 'weekly',
    priority: '0.9',
  },
  {
    path: ROUTES_FRONT_STATIC.FOR_STUDIOS,
    changefreq: 'weekly',
    priority: '0.8',
  },
  { path: ROUTES_FRONT_STATIC.PRICING, changefreq: 'weekly', priority: '0.8' },
  { path: ROUTES_FRONT_STATIC.COMPARE, changefreq: 'weekly', priority: '0.8' },
  {
    path: ROUTES_FRONT_STATIC.SITE_MAP,
    changefreq: 'monthly',
    priority: '0.5',
  },
  { path: ROUTES_FRONT_STATIC.ABOUT, changefreq: 'monthly', priority: '0.7' },
  { path: ROUTES_FRONT_STATIC.CONTACT, changefreq: 'monthly', priority: '0.7' },
  {
    path: ROUTES_FRONT_STATIC.HELP_CENTER,
    changefreq: 'weekly',
    priority: '0.7',
  },
  { path: ROUTES_FRONT_STATIC.GET_APP, changefreq: 'weekly', priority: '0.8' },
  // /welcome — publiczna, indeksowalna podstrona (link w stopce, własne copy +
  // per-locale title/canonical/hreflang; PublicSeoHead BEZ noindex). Poprzednio
  // pominięta w sitemapie mimo indeksowalności = niekompletne pokrycie SEO.
  { path: ROUTES_FRONT_STATIC.WELCOME, changefreq: 'monthly', priority: '0.5' },
  // DECISION: list only INDEXABLE pages (no `noindex` in PublicSeoHead). A noindex URL in the
  // sitemap is a mixed signal ("Submitted URL marked noindex" in GSC) and wastes crawl budget. So
  // the legal pages (/terms, /privacy, /cookies, /content-moderation: noindex,nofollow, no SEO
  // value, reached from the footer/checkout) and /status, /connection-check, /maintenance,
  // /user/login, /email/unsubscribe (noindex or Disallow) are deliberately absent.
];

// next.config.mjs sets `trailingSlash: true` — sitemap URLs must match.
function withTrailingSlash(path: string): string {
  if (path === '/' || path === '') {
    return '/';
  }
  return path.endsWith('/') ? path : `${path}/`;
}

function generateStaticSitemap() {
  const urls = STATIC_PAGES.flatMap(page => {
    const pagePath = withTrailingSlash(page.path);
    return LOCALES.map(locale => {
      const prefix = locale === 'pl' ? '' : `/${locale}`;
      const url = `${DOMAIN}${prefix}${pagePath}`;

      // Generate hreflang alternate links for all locales
      const alternates = LOCALES.map(altLocale => {
        const altPrefix = altLocale === 'pl' ? '' : `/${altLocale}`;
        const altUrl = `${DOMAIN}${altPrefix}${pagePath}`;
        return `      <xhtml:link rel="alternate" hreflang="${altLocale}" href="${altUrl}" />`;
      }).join('\n');

      return `  <url>
    <loc>${url}</loc>
    <lastmod>${STATIC_LASTMOD}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
${alternates}
      <xhtml:link rel="alternate" hreflang="x-default" href="${DOMAIN}${pagePath}" />
  </url>`;
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>`;
}

function SitemapStatic() {
  // getServerSideProps will handle response
  return null;
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const sitemap = generateStaticSitemap();

  res.setHeader('Content-Type', 'text/xml');
  res.setHeader(
    'Cache-Control',
    'public, s-maxage=86400, stale-while-revalidate=43200'
  );
  res.write(sitemap);
  res.end();

  return {
    props: {},
  };
};

export default SitemapStatic;
