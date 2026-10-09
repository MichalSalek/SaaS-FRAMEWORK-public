import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { resolveMsgKey } from '../../application/i18n/resolve-msg-key';
import { ContentModerationPageComposition } from '../../UI/features/static/ContentModerationPage.composition';
import { PublicSeoHeadComposition } from '../../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../../UI/components/JsonLd';
import { getLocaleBcp47, SEO_CONFIG } from '@kernel/policies/seo.policy';
import { buildBreadcrumbJsonLd } from '../../UI/features/static/breadcrumb.jsonld';
import type { IntlMessages } from '../../types/i18n';

const CONTENT_MODERATION_LAST_MODIFIED = '2026-02-11';

interface ContentModerationProps {
  webPageJsonLd: Record<string, unknown>;
  faqJsonLd: Record<string, unknown>;
  breadcrumbJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
}

// Name/description w JSON-LD są zlokalizowane
// (seo.contentModeration.jsonLd.*) per locale — builder wołany
// w getStaticProps, wynik trafia do props.
function buildContentModerationJsonLd(messages: IntlMessages, locale: string) {
  return {
    '@context': 'https://schema.org',
    '@type': ['WebPage', 'PolicyDocument'],
    '@id': `${SEO_CONFIG.domain}/content-moderation/#webpage`,
    name: resolveMsgKey(messages, 'seo.contentModeration.jsonLd.name'),
    description: resolveMsgKey(
      messages,
      'seo.contentModeration.jsonLd.description'
    ),
    url: `${SEO_CONFIG.domain}/content-moderation/`,
    inLanguage: getLocaleBcp47(locale),
    dateModified: CONTENT_MODERATION_LAST_MODIFIED,
    isPartOf: { '@id': `${SEO_CONFIG.domain}/#website` },
    publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
    breadcrumb: {
      '@id': `${SEO_CONFIG.domain}/content-moderation/#breadcrumb`,
    },
  };
}

export default function ContentModeration({
  webPageJsonLd,
  faqJsonLd,
  breadcrumbJsonLd,
  seoTitle,
  seoDescription,
}: ContentModerationProps) {
  const jsonLdItems: ReadonlyArray<Record<string, unknown>> = [
    WEBSITE_JSONLD,
    ORGANIZATION_JSONLD,
    webPageJsonLd,
    breadcrumbJsonLd,
    faqJsonLd,
  ];
  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/content-moderation'
        noindex
      />
      <JsonLdComposition data={jsonLdItems} />
      <ContentModerationPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolvedLocale = locale ?? 'pl';
  const messages = await getI18nMessages(resolvedLocale, [
    'pages.contentModeration',
    'seo',
  ]);

  const prefix = 'pages.contentModeration.faq.';
  const faqJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SEO_CONFIG.domain}/content-moderation/#faq`,
    inLanguage: getLocaleBcp47(resolvedLocale),
    mainEntity: ['q1', 'q2', 'q3', 'q4'].map((qKey, idx) => ({
      '@type': 'Question',
      name: resolveMsgKey(messages, prefix + qKey),
      acceptedAnswer: {
        '@type': 'Answer',
        text: resolveMsgKey(messages, prefix + `a${idx + 1}`),
      },
    })),
  };

  return {
    props: {
      messages,
      webPageJsonLd: buildContentModerationJsonLd(messages, resolvedLocale),
      faqJsonLd,
      breadcrumbJsonLd: buildBreadcrumbJsonLd(
        messages,
        resolvedLocale,
        [
          { labelKey: 'home', path: '/' },
          { labelKey: 'contentModeration', path: '/content-moderation' },
        ],
        `${SEO_CONFIG.domain}/content-moderation/#breadcrumb`
      ),
      seoTitle: resolveMsgKey(messages, 'seo.contentModeration.title'),
      seoDescription: resolveMsgKey(
        messages,
        'seo.contentModeration.description'
      ),
    },
    revalidate: 3600,
  };
}
