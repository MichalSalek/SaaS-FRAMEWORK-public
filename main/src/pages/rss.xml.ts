import type { GetServerSideProps } from 'next';
import { getAllPosts } from '../application/blog/blog.utils';
import { getI18nMessages } from '../application/i18n/i18n.loader';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';
import {
  blogIndexUrl,
  blogPostUrl,
  blogRssUrl,
} from '../application/blog/blog.urls';
import { isBlogEnabledServerSide } from '../application/feature-flags/server-feature-flags';

const MAX_POSTS = 20;

/** Escape CDATA content by replacing ]]> with ]]]]><![CDATA[> (standard CDATA split) */
function escapeCDATA(str: string): string {
  return str.replace(/]]>/g, ']]]]><![CDATA[>');
}

/** Escape XML special characters for non-CDATA text nodes */
function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateRssFeed(locale: string, description: string): string {
  const posts = getAllPosts(locale).slice(0, MAX_POSTS);

  const items = posts
    .map(
      post => `    <item>
      <title><![CDATA[${escapeCDATA(post.title)}]]></title>
      <link>${blogPostUrl(post.locale, post.slug)}</link>
      <guid isPermaLink="true">${blogPostUrl(post.locale, post.slug)}</guid>
      <description><![CDATA[${escapeCDATA(post.description)}]]></description>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
      <category>${escapeXML(post.category)}</category>
      <author>${escapeXML(post.author)}</author>
    </item>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Nailfolio Blog</title>
    <link>${blogIndexUrl(locale)}</link>
    <description><![CDATA[${escapeCDATA(description)}]]></description>
    <language>${locale}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${blogRssUrl(locale)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;
}

function RssFeed() {
  // getServerSideProps will handle response
  return null;
}

export const getServerSideProps: GetServerSideProps = async ({
  res,
  locale,
}) => {
  // Gate via BLOG_ENABLED flag — return 404 when disabled so feed readers stop
  // polling rather than ingesting an empty <channel>.
  const blogEnabled = await isBlogEnabledServerSide();
  if (!blogEnabled) {
    return { notFound: true };
  }

  const resolvedLocale = locale ?? 'pl';
  const messages = await getI18nMessages(resolvedLocale, ['seo']);
  const rss = generateRssFeed(
    resolvedLocale,
    resolveMsgKey(messages, 'seo.blog.description')
  );

  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader(
    'Cache-Control',
    'public, s-maxage=3600, stale-while-revalidate=1800'
  );
  res.write(rss);
  res.end();

  return {
    props: {},
  };
};

export default RssFeed;
