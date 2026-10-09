import { resolveDefaultOgAsset } from '../../assets/brandAssets';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { getLocaleOg, SEO_CONFIG } from '@kernel/policies/seo.policy';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { I18N_CONFIG, type LocaleType } from '@kernel/domain/i18n/i18n.config';
import { blogRssPath } from '../../../application/blog/blog.urls';

/**
 * PublicSeoHead — SEO meta block for public marketing pages.
 *
 * Renders <title>, description, canonical, hreflang (pl/en/de + x-default),
 * Open Graph, and Twitter Card tags. Single source of truth for public-page
 * SEO infrastructure — pages pass title/description, this component handles
 * URL construction off SEO_CONFIG.domain and current `router.asPath`.
 *
 * Default locale (pl) URLs have no prefix; en/de use `/en` and `/de`.
 *
 * Default OG cards are localized PL/EN/DE brand images (1200x630).
 * Their paths and release version live in brandAssets.ts. Pages may override
 * with a per-page asset
 * (e.g. `/og-pricing.png`) once those exist; until then every page falls
 * back to the shared default, so link previews always resolve.
 */

interface ArticleMeta {
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
  section?: string;
  tags?: string[];
}

interface ProfileMeta {
  firstName?: string;
  lastName?: string;
  username?: string;
}

type OgType = 'website' | 'article' | 'profile';

export interface PublicSeoHeadProps {
  /** Page title; component appends " | Nailfolio". */
  title: string;
  /** Meta description (150-160 chars recommended). */
  description: string;
  /** Current path (e.g. '/pricing'). Defaults to router.asPath stripped of query/trailing slash. */
  path?: string;
  /** Relative path to OG image (e.g. '/og-pricing.png'); absolutized off SEO_CONFIG.domain. */
  ogImage?: string;
  /** Accessible description of the OG image — defaults to site name. */
  imageAlt?: string;
  /** When true, adds <meta name="robots" content="noindex"> — for stubs / non-public pages. */
  noindex?: boolean;
  /** Open Graph object type. Defaults to 'website'. Use 'article' for blog posts, 'profile' for stylist pages. */
  ogType?: OgType;
  /** Article metadata — emitted only when ogType === 'article'. */
  articleMeta?: ArticleMeta;
  /** Profile metadata — emitted only when ogType === 'profile'. */
  profileMeta?: ProfileMeta;
  /**
   * When true, emits the blog RSS `<link rel="alternate" type="application/rss+xml">`.
   * Only blog pages set this — RSS feed is gated behind the BLOG_ENABLED flag, so
   * advertising it sitewide (e.g. in _document) produces a 404 on /rss.xml when the
   * blog is parked. Keep the link scoped to pages where the feed actually exists.
   */
  rssFeed?: boolean;
  /**
   * Locales in which THIS page exists. Defaults to all of them, so the ordinary
   * translated pages are unaffected. Pages whose content is authored in one
   * language (blog posts are Polish-only) must narrow it: every hreflang
   * alternate here is a promise that the URL returns 200, and a promise that
   * 404s makes Google flag the cluster as broken.
   */
  availableLocales?: readonly LocaleType[];
}

/**
 * hreflang alternates for one page: only the locales in which it exists, each
 * pointing at its locale variant; x-default = PL whenever the page exists in
 * PL (DECISION below), otherwise the first locale it exists in.
 *
 * Pure on purpose — `next/head` does not render in a unit test, and this is the
 * logic that shipped broken: every blog post advertised /en/ and /de/ variants
 * that return 404 (PublicSeoHead.hreflang.test.ts locks it).
 */
export function resolveHreflangAlternates(
  domain: string,
  pathWithSlash: string,
  availableLocales: readonly LocaleType[]
): {
  alternates: { code: LocaleType; href: string }[];
  xDefaultUrl: string;
} {
  const localeUrl = (code: LocaleType) =>
    code === I18N_CONFIG.defaultLocale
      ? `${domain}${pathWithSlash}`
      : `${domain}/${code}${pathWithSlash}`;
  const codes = I18N_CONFIG.locales.filter(code =>
    availableLocales.includes(code)
  );
  const xDefaultCode = codes.includes(I18N_CONFIG.defaultLocale)
    ? I18N_CONFIG.defaultLocale
    : (codes[0] ?? I18N_CONFIG.defaultLocale);
  return {
    alternates: codes.map(code => ({ code, href: localeUrl(code) })),
    xDefaultUrl: localeUrl(xDefaultCode),
  };
}

const TWITTER_HANDLE = BRAND_CONFIG.social.twitterHandle;
const TWITTER_DOMAIN = BRAND_CONFIG.domain;

function normalizePath(rawPath: string): string {
  // Strip query and hash, then trailing slash (except for root '/').
  const noQuery = rawPath.split('?')[0]?.split('#')[0] ?? '/';
  if (noQuery === '/' || noQuery === '') {
    return '/';
  }
  return noQuery.replace(/\/$/, '');
}

export function PublicSeoHeadComposition({
  title,
  description,
  path,
  ogImage,
  imageAlt,
  noindex = false,
  ogType = 'website',
  articleMeta,
  profileMeta,
  rssFeed = false,
  availableLocales = I18N_CONFIG.locales,
}: PublicSeoHeadProps) {
  const router = useRouter();
  const currentPath = path ?? normalizePath(router.asPath);
  const domain = SEO_CONFIG.domain;
  const currentLocale = router.locale ?? 'pl';

  // Default locale (pl) URLs have no prefix; en/de get an explicit `/en`/`/de` prefix.
  // For root path, suffix is '/' to keep canonical clean.
  // DECISION (nie usuwaj tego komentarza):
  // 1. next.config.mjs sets `trailingSlash: true` — canonical/hreflang MUST match
  //    the served URL form, otherwise Google treats /pricing and /pricing/ as
  //    duplicate URLs (canonical mismatch = SEO penalty).
  // 2. canonicalUrl MUST include the current locale prefix. A bare PL URL on
  //    /en/* or /de/* pages = cross-locale canonical → Google folds EN/DE into PL
  //    and drops them from the index (fix MR360 1D-F1). The three hreflang URLs
  //    (`localeUrl` per alternate) are built independently of canonicalUrl so reciprocity
  //    holds on every locale variant.
  const pathWithSlash = currentPath === '/' ? '/' : `${currentPath}/`;
  const localePrefix = currentLocale === 'pl' ? '' : `/${currentLocale}`;
  const canonicalUrl = `${domain}${localePrefix}${pathWithSlash}`;
  const { alternates, xDefaultUrl } = resolveHreflangAlternates(
    domain,
    pathWithSlash,
    availableLocales
  );

  const resolvedOgImage = ogImage ?? resolveDefaultOgAsset(currentLocale);
  const fullOgImage = resolvedOgImage.startsWith('http')
    ? resolvedOgImage
    : `${domain}${resolvedOgImage}`;
  const fullTitle = `${title} | Nailfolio`;
  // Locale-aware default og/twitter image alt — a hardcoded PL fallback leaked
  // Polish alt text onto EN/DE OG/Twitter previews on every page lacking an
  // explicit imageAlt. Keyed by currentLocale, PL fallback for any unknown code.
  const defaultImageAltByLocale: Record<string, string> = {
    pl: 'Nailfolio: portfolio paznokci online',
    en: 'Nailfolio: online nail portfolio',
    de: 'Nailfolio: Online-Nagelportfolio',
  };
  const resolvedAlt =
    imageAlt ??
    defaultImageAltByLocale[currentLocale] ??
    defaultImageAltByLocale.pl;
  const ogLocaleCurrent = getLocaleOg(currentLocale);
  const ogLocaleAlternates: string[] = alternates
    .filter(({ code }) => code !== currentLocale)
    .map(({ code }) => getLocaleOg(code));

  return (
    <Head>
      <title>{fullTitle}</title>
      <meta name='description' content={description} />
      <link rel='canonical' href={canonicalUrl} />
      {alternates.map(({ code, href }) => (
        <link key={code} rel='alternate' hrefLang={code} href={href} />
      ))}
      {/* DECISION (nie usuwaj tego komentarza):
          x-default → PL (defaultLocale, primary launch market). MUST match the
          sitemap x-default (sitemap-static.xml.ts emits the bare/PL URL too) —
          Google treats HTML-head vs sitemap x-default mismatch as a hreflang
          conflict (fix MR360 1D-F3). */}
      <link rel='alternate' hrefLang='x-default' href={xDefaultUrl} />
      <meta property='og:title' content={fullTitle} />
      <meta property='og:description' content={description} />
      <meta property='og:image' content={fullOgImage} />
      <meta property='og:image:secure_url' content={fullOgImage} />
      <meta property='og:image:width' content='1200' />
      <meta property='og:image:height' content='630' />
      <meta property='og:image:type' content='image/png' />
      <meta property='og:image:alt' content={resolvedAlt} />
      <meta property='og:url' content={canonicalUrl} />
      <meta property='og:type' content={ogType} />
      <meta property='og:site_name' content='Nailfolio' />
      <meta property='og:locale' content={ogLocaleCurrent} />
      {ogLocaleAlternates.map(alt => (
        <meta key={alt} property='og:locale:alternate' content={alt} />
      ))}
      {ogType === 'article' && articleMeta && (
        <>
          {articleMeta.publishedTime && (
            <meta
              property='article:published_time'
              content={articleMeta.publishedTime}
            />
          )}
          {articleMeta.modifiedTime && (
            <meta
              property='article:modified_time'
              content={articleMeta.modifiedTime}
            />
          )}
          {articleMeta.author && (
            <meta property='article:author' content={articleMeta.author} />
          )}
          {articleMeta.section && (
            <meta property='article:section' content={articleMeta.section} />
          )}
          {articleMeta.tags?.map(tag => (
            <meta key={tag} property='article:tag' content={tag} />
          ))}
        </>
      )}
      {ogType === 'profile' && profileMeta && (
        <>
          {profileMeta.firstName && (
            <meta
              property='profile:first_name'
              content={profileMeta.firstName}
            />
          )}
          {profileMeta.lastName && (
            <meta property='profile:last_name' content={profileMeta.lastName} />
          )}
          {profileMeta.username && (
            <meta property='profile:username' content={profileMeta.username} />
          )}
        </>
      )}
      <meta name='twitter:card' content='summary_large_image' />
      <meta name='twitter:site' content={TWITTER_HANDLE} />
      <meta name='twitter:domain' content={TWITTER_DOMAIN} />
      <meta name='twitter:url' content={canonicalUrl} />
      <meta name='twitter:title' content={fullTitle} />
      <meta name='twitter:description' content={description} />
      <meta name='twitter:image' content={fullOgImage} />
      <meta name='twitter:image:alt' content={resolvedAlt} />
      {noindex ? (
        <meta name='robots' content='noindex,nofollow' />
      ) : (
        <>
          <meta
            name='robots'
            content='max-image-preview:large, max-snippet:-1, max-video-preview:-1'
          />
          <meta
            name='googlebot'
            content='max-image-preview:large, max-snippet:-1'
          />
        </>
      )}
      {rssFeed && (
        <link
          rel='alternate'
          type='application/rss+xml'
          title='Nailfolio Blog RSS'
          href={blogRssPath(currentLocale)}
        />
      )}
    </Head>
  );
}
