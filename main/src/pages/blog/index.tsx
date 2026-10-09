import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import {
  getAllPosts,
  getLocalesWithPosts,
} from '../../application/blog/blog.utils';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { isBlogEnabledServerSide } from '../../application/feature-flags/server-feature-flags';
import { resolveMsgKey } from '../../application/i18n/resolve-msg-key';
import { SEO_CONFIG, getLocaleBcp47 } from '@kernel/policies/seo.policy';
import { blogIndexUrl, blogPostUrl } from '../../application/blog/blog.urls';
import { PublicSeoHeadComposition } from '../../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../../UI/components/JsonLd';
import {
  BlogListPageComposition,
  type BlogListPageProps,
} from '../../UI/features/blog/BlogListPage.composition';

type BlogIndexProps = BlogListPageProps & {
  seoTitle: string;
  seoDescription: string;
  locale: string;
  /** Languages with at least one post — the only valid hreflang targets. */
  availableLocales: LocaleType[];
};

export default function BlogIndex({
  seoTitle,
  seoDescription,
  locale,
  availableLocales,
  ...listProps
}: BlogIndexProps) {
  const blogJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Blog Nailfolio',
    description: seoDescription,
    url: blogIndexUrl(locale),
    inLanguage: getLocaleBcp47(locale),
    publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
    blogPost: listProps.posts.slice(0, 10).map(p => ({
      '@type': 'BlogPosting',
      headline: p.title,
      description: p.description,
      datePublished: p.date,
      url: blogPostUrl(p.locale, p.slug),
      // Organization, nie Person — patrz blog/[slug].tsx.
      author: { '@type': 'Organization', name: p.author },
    })),
  };

  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/blog'
        availableLocales={availableLocales}
        // Empty in this language (posts are Polish-only today): the page stays
        // reachable from the EN/DE footer and says „coming soon", but it is not
        // content worth indexing.
        noindex={listProps.posts.length === 0}
        rssFeed
      />
      <JsonLdComposition
        data={[WEBSITE_JSONLD, ORGANIZATION_JSONLD, blogJsonLd]}
        id='blog'
      />
      <BlogListPageComposition {...listProps} />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const blogEnabled = await isBlogEnabledServerSide();
  if (!blogEnabled) {
    return { notFound: true as const, revalidate: 300 };
  }

  const resolvedLocale = locale ?? 'pl';
  const messages = await getI18nMessages(resolvedLocale, ['blog', 'seo']);
  const posts = getAllPosts(resolvedLocale);

  return {
    props: {
      messages,
      posts,
      locale: resolvedLocale,
      availableLocales: getLocalesWithPosts(),
      seoTitle: resolveMsgKey(messages, 'seo.blog.title'),
      seoDescription: resolveMsgKey(messages, 'seo.blog.description'),
    },
    revalidate: 300,
  };
}
