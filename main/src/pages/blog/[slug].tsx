import type { GetStaticPaths, GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import {
  getAllSlugs,
  getPostBySlug,
  getPostsByCategory,
} from '../../application/blog/blog.utils';
import { isBlogEnabledServerSide } from '../../application/feature-flags/server-feature-flags';
import { I18N_CONFIG, type LocaleType } from '@kernel/domain/i18n/i18n.config';
import { SEO_CONFIG, getLocaleBcp47 } from '@kernel/policies/seo.policy';
import { resolveMsgKey } from '../../application/i18n/resolve-msg-key';
import { blogIndexUrl, blogPostUrl } from '../../application/blog/blog.urls';
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

type BlogPostRouteProps = BlogPostPageProps & {
  /** Languages this post exists in — SEO-only, never passed to the UI composition. */
  availableLocales: LocaleType[];
  /** Localized "Home" crumb for the BreadcrumbList (SEO-only). */
  breadcrumbHome: string;
};

export default function BlogPost({
  availableLocales,
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
    // Organization, nie Person: etykietą autora jest nazwa produktu, bo imię
    // założyciela nie pada nigdzie w serwisie (COPY_REGISTERS). Deklarowanie
    // marki jako osoby to błąd w danych strukturalnych, który Google czyta.
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

  return (
    <>
      <PublicSeoHeadComposition
        title={post.title}
        description={post.description}
        path={`/blog/${post.slug}`}
        // Wpis istnieje w jednym języku (locale z frontmattera; getPostBySlug
        // zwraca 404 dla pozostałych), więc tylko ten jeden wolno ogłosić.
        availableLocales={availableLocales}
        ogType='article'
        articleMeta={{
          publishedTime: post.date,
          modifiedTime: post.updated ?? post.date,
          author: post.author,
        }}
        rssFeed
      />
      <JsonLdComposition
        data={[ORGANIZATION_JSONLD, postJsonLd, breadcrumbJsonLd]}
        id='blog-post'
      />
      <BlogPostPageComposition {...props} />
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

  const messages = await getI18nMessages(resolvedLocale, [
    'blog',
    'account.plan',
    'breadcrumb',
  ]);
  const postFull = getPostBySlug(slug, resolvedLocale);

  if (!postFull) {
    return { notFound: true };
  }

  // DECISION (nie usuwaj tego komentarza):
  // Przekazujemy SUROWY markdown, nie skompilowany MDX. next-mdx-remote
  // kompiluje treść do kodu, który przeglądarka musi wykonać przez
  // `new Function` — a produkcyjne CSP świadomie nie ma 'unsafe-eval'
  // (patrz proxy.ts). Skutek był taki, że serwer oddawał pełny artykuł, ale
  // hydracja rzucała EvalError i ErrorBoundary zjadał całą treść: crawler
  // widział tekst, czytelniczka pustą stronę. Wpisy to czysty markdown bez
  // JSX, więc cała maszyneria MDX była tu i tak zbędna.

  // Related posts: same category, up to 3, exclude current slug
  const relatedPosts = getPostsByCategory(postFull.category, resolvedLocale)
    .filter(p => p.slug !== slug)
    .slice(0, 3);

  const props: BlogPostRouteProps = {
    post: postFull,
    relatedPosts,
    // Filter on the typed locale tuple instead of casting `postFull.locale`:
    // the frontmatter guard only proves it is a string.
    availableLocales: I18N_CONFIG.locales.filter(l => l === postFull.locale),
    breadcrumbHome: resolveMsgKey(messages, 'breadcrumb.home'),
  };

  return {
    props: {
      messages,
      ...props,
    },
    revalidate: 300,
  };
}
