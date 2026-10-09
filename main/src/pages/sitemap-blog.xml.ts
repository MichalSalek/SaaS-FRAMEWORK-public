import type { GetServerSideProps } from 'next';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import {
  blogCategoryUrl,
  blogIndexUrl,
  blogPostUrl,
} from '../application/blog/blog.urls';
import { localeAbsoluteUrl } from '../application/routing/locale-url';
import { getAllPosts } from '../application/blog/blog.utils';
import { isBlogEnabledServerSide } from '../application/feature-flags/server-feature-flags';
import { BLOG_CATEGORIES } from '../content/blog/categories.config';

const LOCALES = I18N_CONFIG.locales;

function generateBlogSitemap() {
  // Build per-locale post inventory once — drives all sitemap entries.
  // Locales without posts get NO sitemap entries (no listing, no categories)
  // because pointing crawlers at empty pages hurts crawl budget and hreflang.
  const postsByLocale = new Map(
    LOCALES.map(locale => [locale, getAllPosts(locale)] as const)
  );
  const localesWithPosts = LOCALES.filter(
    locale => (postsByLocale.get(locale) ?? []).length > 0
  );

  // Categories per locale: a category only appears if THAT locale has at least
  // one post in it (otherwise its listing renders empty).
  const categoriesByLocale = new Map(
    localesWithPosts.map(locale => {
      const posts = postsByLocale.get(locale) ?? [];
      const cats = new Set(posts.map(p => p.category));
      return [locale, BLOG_CATEGORIES.filter(c => cats.has(c))] as const;
    })
  );

  function buildAlternates(
    pathSuffix: string,
    locales: ReadonlyArray<string>
  ): string {
    const alts = locales.map(altLocale => {
      return `      <xhtml:link rel="alternate" hreflang="${altLocale}" href="${localeAbsoluteUrl(altLocale, pathSuffix)}" />`;
    });
    // x-default points to the default locale when available, else the first
    // locale with content.
    const xDefaultLocale = locales.includes(I18N_CONFIG.defaultLocale)
      ? I18N_CONFIG.defaultLocale
      : (locales[0] ?? I18N_CONFIG.defaultLocale);
    alts.push(
      `      <xhtml:link rel="alternate" hreflang="x-default" href="${localeAbsoluteUrl(xDefaultLocale, pathSuffix)}" />`
    );
    return alts.join('\n');
  }

  // Blog listing page — only locales with posts
  // next.config.mjs sets `trailingSlash: true` — all URLs must end with /.
  const blogListingUrls = localesWithPosts.map(locale => {
    const url = blogIndexUrl(locale);
    const posts = postsByLocale.get(locale) ?? [];
    const lastmod = new Date(
      Math.max(...posts.map(p => new Date(p.updated ?? p.date).getTime()))
    ).toISOString();

    return `  <url>
    <loc>${url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
${buildAlternates('/blog/', localesWithPosts)}
  </url>`;
  });

  // Category pages — emit only (locale, category) pairs that actually have posts
  const categoryUrls = localesWithPosts.flatMap(locale => {
    const cats = categoriesByLocale.get(locale) ?? [];
    return cats.map(category => {
      const url = blogCategoryUrl(locale, category);
      // Alternates point only to locales whose own category list contains this category
      const localesForCategory = localesWithPosts.filter(loc =>
        (categoriesByLocale.get(loc) ?? []).includes(category)
      );

      return `  <url>
    <loc>${url}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
${buildAlternates(`/blog/category/${category}/`, localesForCategory)}
  </url>`;
    });
  });

  // Individual blog posts — emit only for the locale of the post
  const postUrls: string[] = [];
  for (const locale of localesWithPosts) {
    const posts = postsByLocale.get(locale) ?? [];
    for (const post of posts) {
      const url = blogPostUrl(locale, post.slug);

      postUrls.push(`  <url>
    <loc>${url}</loc>
    <lastmod>${new Date(post.updated ?? post.date).toISOString()}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);
    }
  }

  const allUrls = [...blogListingUrls, ...categoryUrls, ...postUrls];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${allUrls.join('\n')}
</urlset>`;
}

function SitemapBlog() {
  // getServerSideProps will handle response
  return null;
}

function generateEmptySitemap(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
</urlset>`;
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  // Gate via BLOG_ENABLED flag — when disabled, emit empty urlset so crawlers
  // don't request URLs that return 404 (blog pages gate via the same flag).
  const blogEnabled = await isBlogEnabledServerSide();
  const sitemap = blogEnabled ? generateBlogSitemap() : generateEmptySitemap();

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

export default SitemapBlog;
