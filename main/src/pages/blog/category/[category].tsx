import type { GetStaticPaths, GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../../application/i18n/i18n.loader';
import { resolveMsgKey } from '../../../application/i18n/resolve-msg-key';
import type { BlogCategory } from '../../../content/blog/categories.config';
import { BLOG_CATEGORIES } from '../../../content/blog/categories.config';
import {
  getLocalesWithPosts,
  getPostsByCategory,
} from '../../../application/blog/blog.utils';
import { isBlogEnabledServerSide } from '../../../application/feature-flags/server-feature-flags';
import { I18N_CONFIG, type LocaleType } from '@kernel/domain/i18n/i18n.config';
import { SEO_CONFIG, getLocaleBcp47 } from '@kernel/policies/seo.policy';
import {
  blogCategoryUrl,
  blogIndexUrl,
  blogPostUrl,
} from '../../../application/blog/blog.urls';
import { PublicSeoHeadComposition } from '../../../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
} from '../../../UI/components/JsonLd';
import {
  BlogCategoryPageComposition,
  type BlogCategoryPageProps,
} from '../../../UI/features/blog/BlogCategoryPage.composition';

interface CategoryPageProps extends BlogCategoryPageProps {
  locale: string;
  seoTitle: string;
  seoDescription: string;
  /** Category name in the page's language, for JSON-LD. */
  categoryLabel: string;
  /** "Category: {name}" and its description in the page's language. */
  collectionName: string;
  collectionDescription: string;
  /** Languages with at least one post in this category — the only valid hreflang targets. */
  availableLocales: LocaleType[];
}

export default function CategoryPage(props: CategoryPageProps) {
  const {
    category,
    posts,
    locale,
    seoTitle,
    seoDescription,
    collectionName,
    collectionDescription,
    availableLocales,
  } = props;
  const categoryUrl = blogCategoryUrl(locale, category);

  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${categoryUrl}#collection`,
    name: collectionName,
    description: collectionDescription,
    url: categoryUrl,
    inLanguage: getLocaleBcp47(locale),
    publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
    isPartOf: {
      '@type': 'Blog',
      name: 'Blog Nailfolio',
      url: blogIndexUrl(locale),
    },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: posts.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: blogPostUrl(p.locale, p.slug),
        name: p.title,
      })),
    },
  };

  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path={`/blog/category/${category}`}
        availableLocales={availableLocales}
        // A category with no posts in this language is an empty shell (every
        // EN/DE category today, and any PL category before its first post).
        noindex={posts.length === 0}
        rssFeed
      />
      <JsonLdComposition
        data={[ORGANIZATION_JSONLD, collectionPageJsonLd]}
        id='blog-category'
      />
      <BlogCategoryPageComposition {...props} />
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  const locales = [...I18N_CONFIG.locales];

  const paths = BLOG_CATEGORIES.flatMap(category =>
    locales.map(locale => ({
      params: { category },
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
  // Runtime-narrow instead of a bare cast: `getStaticPaths` uses `fallback: false`
  // and exhausts BLOG_CATEGORIES, so this is provably safe today — but the narrow
  // keeps it correct even if a future change adds `fallback: 'blocking'`.
  const rawCategory = params?.category;
  const category: BlogCategory = BLOG_CATEGORIES.includes(
    rawCategory as BlogCategory
  )
    ? (rawCategory as BlogCategory)
    : 'inspiration';

  const messages = await getI18nMessages(resolvedLocale, ['blog', 'seo']);
  const posts = getPostsByCategory(category, resolvedLocale);

  // resolveMsgKey returns a raw string (no ICU runtime); interpolate category label manually.
  // blog.category.labels[category] is the SSOT for translated category names (×3 locales).
  const categoryLabel = resolveMsgKey(
    messages,
    `blog.category.labels.${category}`
  );
  const seoTitle = resolveMsgKey(messages, 'seo.blogCategory.title').replace(
    '{category}',
    categoryLabel
  );
  const seoDescription = resolveMsgKey(
    messages,
    'seo.blogCategory.description'
  ).replace('{category}', categoryLabel);

  const blogCategoryProps: BlogCategoryPageProps = {
    category,
    posts,
  };

  return {
    props: {
      messages,
      ...blogCategoryProps,
      locale: resolvedLocale,
      seoTitle,
      seoDescription,
      categoryLabel,
      collectionName: seoTitle,
      collectionDescription: seoDescription,
      availableLocales: getLocalesWithPosts(category),
    },
    revalidate: 300,
  };
}
