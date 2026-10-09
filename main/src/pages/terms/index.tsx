import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { resolveMsgKey } from '../../application/i18n/resolve-msg-key';
import { TermsPageComposition } from '../../UI/features/static/TermsPage.composition';
import { PublicSeoHeadComposition } from '../../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../../UI/components/JsonLd';
import { getLocaleBcp47, SEO_CONFIG } from '@kernel/policies/seo.policy';
import { buildBreadcrumbJsonLd } from '../../UI/features/static/breadcrumb.jsonld';
import type { IntlMessages } from '../../types/i18n';

const TERMS_LAST_MODIFIED = '2026-02-11';

interface TermsProps {
  webPageJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
  breadcrumbJsonLd: Record<string, unknown>;
}

// Name/description w JSON-LD są zlokalizowane (seo.terms.jsonLd.*) per locale
// — builder wołany w getStaticProps, wynik trafia do props.
function buildTermsJsonLd(messages: IntlMessages, locale: string) {
  return {
    '@context': 'https://schema.org',
    '@type': ['WebPage', 'TermsOfService'],
    '@id': `${SEO_CONFIG.domain}/terms/#webpage`,
    name: resolveMsgKey(messages, 'seo.terms.jsonLd.name'),
    // Bez „gwarancji zwrotu" — taka mechanika nie istnieje (census 2026-07-09):
    // regulamin daje 14 dni odstąpienia + reklamacje, nie money-back guarantee.
    description: resolveMsgKey(messages, 'seo.terms.jsonLd.description'),
    url: `${SEO_CONFIG.domain}/terms/`,
    inLanguage: getLocaleBcp47(locale),
    dateModified: TERMS_LAST_MODIFIED,
    isPartOf: { '@id': `${SEO_CONFIG.domain}/#website` },
    publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
    breadcrumb: { '@id': `${SEO_CONFIG.domain}/terms/#breadcrumb` },
  };
}

export default function Terms({
  webPageJsonLd,
  seoTitle,
  seoDescription,
  breadcrumbJsonLd,
}: TermsProps) {
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
        path='/terms'
        noindex
      />
      <JsonLdComposition data={jsonLdItems} />
      <TermsPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolvedLocale = locale ?? 'pl';
  const messages = await getI18nMessages(resolvedLocale, [
    'pages.terms',
    'static.terms',
    'static.legal',
    'seo',
  ]);
  return {
    props: {
      messages,
      webPageJsonLd: buildTermsJsonLd(messages, resolvedLocale),
      seoTitle: resolveMsgKey(messages, 'seo.terms.title'),
      seoDescription: resolveMsgKey(messages, 'seo.terms.description'),
      breadcrumbJsonLd: buildBreadcrumbJsonLd(
        messages,
        resolvedLocale,
        [
          { labelKey: 'home', path: '/' },
          { labelKey: 'terms', path: '/terms' },
        ],
        `${SEO_CONFIG.domain}/terms/#breadcrumb`
      ),
    },
    revalidate: 3600,
  };
}
