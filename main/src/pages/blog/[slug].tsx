import type { GetStaticPaths, GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../../application/i18n/page-messages.config';
import {
  getAllSlugs,
  getPostBySlug,
  getPostsByCategory,
  resolveBlogTranslationGroup,
} from '../../application/blog/blog.utils';
import { isBlogEnabledServerSide } from '../../application/feature-flags/server-feature-flags';
import { I18N_CONFIG, type LocaleType } from '@kernel/domain/i18n/i18n.config';
import { SEO_CONFIG, getLocaleBcp47 } from '@kernel/policies/seo.policy';
import { resolveMsgKey } from '../../application/i18n/resolve-msg-key';
import { blogIndexUrl, blogPostUrl } from '../../application/blog/blog.urls';
import { buildBlogFaqJsonLd } from '../../application/blog/blog-faq';
import { localeAbsoluteUrl } from '../../application/routing/locale-url';
import { PublicSeoHeadComposition } from '../../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
} from '../../UI/components/JsonLd';
import {
  BlogPostPageComposition,
  type BlogPostPageProps,
} from '../../UI/features/blog/BlogPostPage.composition';

type BlogPostRouteProps = Omit<BlogPostPageProps, 'localePaths'> & {
  /** Languages this post exists in, verified by the reciprocal group resolver. */
  availableLocales: LocaleType[];
  localePaths: Partial<Record<LocaleType, string>> | null;
  /** Localized "Home" crumb for the BreadcrumbList (SEO-only). */
  breadcrumbHome: string;
};

export default function BlogPost({
  availableLocales,
  localePaths,
  breadcrumbHome,
  ...props
}: BlogPostRouteProps) {
  const { post } = props;

  const postJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    inLanguage: getLocaleBcp47(post.locale),
    // Organization, not Person: the author label is the product name because the founder's name
    // appears nowhere on the site (COPY_REGISTERS). Declaring the brand as a person is an error in
    // the structured data Google reads.
    author: { '@type': 'Organization', name: post.author },
    publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': blogPostUrl(post.locale, post.slug),
    },
    ...(post.coverImage
      ? {
          image: post.coverImage.startsWith('http')
            ? post.coverImage
            : `${SEO_CONFIG.domain}${post.coverImage}`,
        }
      : {}),
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: breadcrumbHome,
        item: localeAbsoluteUrl(post.locale, '/'),
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Blog',
        item: blogIndexUrl(post.locale),
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: post.title,
        item: blogPostUrl(post.locale, post.slug),
      },
    ],
  };

  // FAQPage only when the post itself has an FAQ section; built from the
  // post's own question and answer text (rule: application/blog/blog-faq.ts).
  const faqJsonLd = buildBlogFaqJsonLd({
    markdown: post.content,
    postUrl: blogPostUrl(post.locale, post.slug),
    inLanguage: getLocaleBcp47(post.locale),
  });

  return (
    <>
      <PublicSeoHeadComposition
        title={post.title}
        description={post.description}
        path={`/blog/${post.slug}`}
        availableLocales={availableLocales}
        {...(localePaths ? { localePaths } : {})}
        ogType='article'
        articleMeta={{
          publishedTime: post.date,
          modifiedTime: post.updated ?? post.date,
          author: post.author,
        }}
        rssFeed
      />
      <JsonLdComposition
        data={
          faqJsonLd
            ? [ORGANIZATION_JSONLD, postJsonLd, breadcrumbJsonLd, faqJsonLd]
            : [ORGANIZATION_JSONLD, postJsonLd, breadcrumbJsonLd]
        }
        id='blog-post'
      />
      <BlogPostPageComposition
        {...props}
        {...(localePaths ? { localePaths } : {})}
      />
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  const slugs = getAllSlugs();
  const locales = [...I18N_CONFIG.locales];

  const paths = slugs.flatMap(slug =>
    locales.map(locale => ({
      params: { slug },
      locale,
    }))
  );

  return {
    paths,
    fallback: false,
  };
};

export async function getStaticProps({
  params,
  locale,
}: GetStaticPropsContext) {
  const blogEnabled = await isBlogEnabledServerSide();
  if (!blogEnabled) {
    return { notFound: true as const, revalidate: 300 };
  }

  const resolvedLocale = locale ?? 'pl';
  const slug = typeof params?.slug === 'string' ? params.slug : '';

  const { messages, buildMessages } = await getPublicPageMessages(
    resolvedLocale,
    PUBLIC_PAGE_MESSAGES['/blog/[slug]']
  );
  const postFull = getPostBySlug(slug, resolvedLocale);

  if (!postFull) {
    return { notFound: true };
  }

  // DECISION: pass the RAW markdown, not compiled MDX. next-mdx-remote compiles content to code the
  // browser must run through `new Function`, and the production CSP deliberately has no
  // 'unsafe-eval' (proxy.ts). The server then returned the full article but hydration threw
  // EvalError and the ErrorBoundary swallowed the content: the crawler saw the text, the reader a
  // blank page. Posts are plain markdown without JSX, so the MDX machinery was unnecessary anyway.

  // Related posts: same category, up to 3, exclude current slug
  const relatedPosts = getPostsByCategory(postFull.category, resolvedLocale)
    .filter(p => p.slug !== slug)
    .slice(0, 3);

  const group = resolveBlogTranslationGroup(postFull);
  const props: BlogPostRouteProps = {
    post: postFull,
    relatedPosts,
    // Filter on the typed locale tuple instead of casting `postFull.locale`:
    // the frontmatter guard only proves it is a string.
    availableLocales: group
      ? [...I18N_CONFIG.locales]
      : I18N_CONFIG.locales.filter(l => l === postFull.locale),
    localePaths: group
      ? Object.fromEntries(
          I18N_CONFIG.locales.map(l => [l, `/blog/${group.slugs[l]}/`])
        )
      : null,
    breadcrumbHome: resolveMsgKey(buildMessages, 'breadcrumb.home'),
  };

  return {
    props: {
      messages,
      ...props,
    },
    revalidate: 300,
  };
}
