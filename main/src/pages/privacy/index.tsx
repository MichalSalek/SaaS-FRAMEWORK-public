import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { resolveMsgKey } from '../../application/i18n/resolve-msg-key';
import { PrivacyPageComposition } from '../../UI/features/static/PrivacyPage.composition';
import { PublicSeoHeadComposition } from '../../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../../UI/components/JsonLd';
import { getLocaleBcp47, SEO_CONFIG } from '@kernel/policies/seo.policy';
import { buildBreadcrumbJsonLd } from '../../UI/features/static/breadcrumb.jsonld';
import type { IntlMessages } from '../../types/i18n';

const PRIVACY_LAST_MODIFIED = '2026-02-11';

interface PrivacyProps {
  webPageJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
  breadcrumbJsonLd: Record<string, unknown>;
}

// Name/description w JSON-LD są zlokalizowane (seo.privacy.jsonLd.*) per
// locale — builder wołany w getStaticProps, wynik trafia do props.
function buildPrivacyJsonLd(messages: IntlMessages, locale: string) {
  return {
    '@context': 'https://schema.org',
    '@type': ['WebPage', 'PrivacyPolicy'],
    '@id': `${SEO_CONFIG.domain}/privacy/#webpage`,
    name: resolveMsgKey(messages, 'seo.privacy.jsonLd.name'),
    description: resolveMsgKey(messages, 'seo.privacy.jsonLd.description'),
    url: `${SEO_CONFIG.domain}/privacy/`,
    inLanguage: getLocaleBcp47(locale),
    dateModified: PRIVACY_LAST_MODIFIED,
    isPartOf: { '@id': `${SEO_CONFIG.domain}/#website` },
    publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
    breadcrumb: { '@id': `${SEO_CONFIG.domain}/privacy/#breadcrumb` },
  };
}

export default function Privacy({
  webPageJsonLd,
  seoTitle,
  seoDescription,
  breadcrumbJsonLd,
}: PrivacyProps) {
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
        path='/privacy'
        noindex
      />
      <JsonLdComposition data={jsonLdItems} />
      <PrivacyPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolvedLocale = locale ?? 'pl';
  const messages = await getI18nMessages(resolvedLocale, [
    'pages.privacy',
    'static.privacy',
    'static.legal',
    'seo',
  ]);
  return {
    props: {
      messages,
      webPageJsonLd: buildPrivacyJsonLd(messages, resolvedLocale),
      seoTitle: resolveMsgKey(messages, 'seo.privacy.title'),
      seoDescription: resolveMsgKey(messages, 'seo.privacy.description'),
      breadcrumbJsonLd: buildBreadcrumbJsonLd(
        messages,
        resolvedLocale,
        [
          { labelKey: 'home', path: '/' },
          { labelKey: 'privacy', path: '/privacy' },
        ],
        `${SEO_CONFIG.domain}/privacy/#breadcrumb`
      ),
    },
    revalidate: 3600,
  };
}
