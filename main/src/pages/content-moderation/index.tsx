import type { GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../../application/i18n/page-messages.config';
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

const CONTENT_MODERATION_LAST_MODIFIED = '2026-10-30';

interface ContentModerationProps {
  webPageJsonLd: Record<string, unknown>;
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
  breadcrumbJsonLd,
  seoTitle,
  seoDescription,
}: ContentModerationProps) {
  const jsonLdItems: ReadonlyArray<Record<string, unknown>> = [
    WEBSITE_JSONLD,
    ORGANIZATION_JSONLD,
    webPageJsonLd,
    breadcrumbJsonLd,
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
  const { messages, buildMessages } = await getPublicPageMessages(
    resolvedLocale,
    PUBLIC_PAGE_MESSAGES['/content-moderation']
  );

  return {
    props: {
      messages,
      webPageJsonLd: buildContentModerationJsonLd(
        buildMessages,
        resolvedLocale
      ),
      breadcrumbJsonLd: buildBreadcrumbJsonLd(
        buildMessages,
        resolvedLocale,
        [
          { labelKey: 'home', path: '/' },
          { labelKey: 'contentModeration', path: '/content-moderation' },
        ],
        `${SEO_CONFIG.domain}/content-moderation/#breadcrumb`
      ),
      seoTitle: resolveMsgKey(buildMessages, 'seo.contentModeration.title'),
      seoDescription: resolveMsgKey(
        buildMessages,
        'seo.contentModeration.description'
      ),
    },
    revalidate: 3600,
  };
}
