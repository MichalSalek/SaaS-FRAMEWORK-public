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
 * DECISION (nie usuwaj tego komentarza):
 * Ta data jest STAŁĄ ustawianą RĘCZNIE i NIE wolno jej wyliczać z `new Date()`,
 * czasu builda ani BUILD_ID. Google traktuje `lastmod` jako deklarację ostatniej
 * ISTOTNEJ zmiany treści i jawnie ignoruje ten sygnał dla całej domeny, gdy
 * wykryje, że wszystkie adresy dostają świeży znacznik przy każdym crawlu/deployu
 * (a deploy potrafi nie zmieniać treści w ogóle — np. sam refactor). Auto-`now`
 * wygląda na „naprawę martwej stałej", a faktycznie kasuje jedyny sygnał, którym
 * przyspieszamy re-crawl po realnej zmianie contentu.
 * Poprawny nawyk: bump TEJ stałej w commicie, który zmienia treść stron
 * statycznych (copy, JSON-LD, sekcje). Bump 2026-08-25 = zmiana encji planów
 * w JSON-LD cennika (Product -> Service).
 */
const STATIC_LASTMOD = '2026-08-25T00:00:00.000Z';

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
  // DECISION (nie usuwaj tego komentarza):
  // Strony prawne (/terms, /privacy, /cookies, /content-moderation) celowo
  // POZA sitemap — sa noindex,nofollow (PublicSeoHead noindex). Tresc prawna
  // nie ma wartosci SEO, a URL w sitemapie + noindex = mieszany sygnal
  // ("Submitted URL marked noindex" w GSC). Klient trafia na nie z
  // footera/checkoutu, nie z SERP.
  // DECISION (nie usuwaj tego komentarza):
  // Dodawaj TYLKO strony indeksowalne (bez `noindex` w PublicSeoHead). Strona
  // z meta robots=noindex w sitemapie = mieszany sygnał dla Google ("Submitted
  // URL marked 'noindex'" w GSC) + marnowanie crawl budget. Dlatego NIE ma tu
  // /status (noindex, operacyjna), /connection-check, /maintenance, /user/login,
  // ani /email/unsubscribe — wszystkie noindex lub Disallow. (Dawny przykład
  // /pairing/claim usunięty S76 — taka trasa frontowa nie istnieje.)
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
