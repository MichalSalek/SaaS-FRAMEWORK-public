import { SEO_CONFIG } from '@kernel/policies/seo.policy';
import { localeAbsoluteUrl, localePathPrefix } from '../routing/locale-url';

// Every blog URL (JSON-LD, RSS, sitemap, head links) comes from here. A post
// lives in exactly one locale, so the locale passed in is the post's own.
// Guard: audit:blog-url-construction.

export const blogIndexUrl = (locale: string): string =>
  localeAbsoluteUrl(locale, '/blog');

export const blogPostUrl = (locale: string, slug: string): string =>
  localeAbsoluteUrl(locale, `/blog/${slug}`);

export const blogCategoryUrl = (locale: string, category: string): string =>
  localeAbsoluteUrl(locale, `/blog/category/${category}`);

/** Site-relative path of the locale's RSS feed (for `<link rel=alternate>`). */
export const blogRssPath = (locale: string): string =>
  `${localePathPrefix(locale)}/rss.xml`;

export const blogRssUrl = (locale: string): string =>
  `${SEO_CONFIG.domain}${blogRssPath(locale)}`;
