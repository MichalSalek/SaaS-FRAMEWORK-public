import type { GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../../application/i18n/page-messages.config';
import { resolveMsgKey } from '../../application/i18n/resolve-msg-key';
import { CookiesPageComposition } from '../../UI/features/static/CookiesPage.composition';
import { PublicSeoHeadComposition } from '../../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../../UI/components/JsonLd';
import { getLocaleBcp47, SEO_CONFIG } from '@kernel/policies/seo.policy';
import type { IntlMessages } from '../../types/i18n';
import { buildBreadcrumbJsonLd } from '../../UI/features/static/breadcrumb.jsonld';

import { COOKIES_UPDATED_AT } from '../../UI/features/static/CookiesPageData';

interface CookiesProps {
  webPageJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
  howToJsonLd: Record<string, unknown>;
  breadcrumbJsonLd: Record<string, unknown>;
}

// Name/description w JSON-LD są zlokalizowane (seo.cookies.jsonLd.*) per
// locale — builder wołany w getStaticProps, wynik trafia do props.
function buildCookiesJsonLd(messages: IntlMessages, locale: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${SEO_CONFIG.domain}/cookies/#webpage`,
    name: resolveMsgKey(messages, 'seo.cookies.jsonLd.name'),
    description: resolveMsgKey(messages, 'seo.cookies.jsonLd.description'),
    url: `${SEO_CONFIG.domain}/cookies/`,
    inLanguage: getLocaleBcp47(locale),
    dateModified: COOKIES_UPDATED_AT,
    isPartOf: { '@id': `${SEO_CONFIG.domain}/#website` },
    publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
    breadcrumb: { '@id': `${SEO_CONFIG.domain}/cookies/#breadcrumb` },
  };
}

// DECISION: HowTo JSON-LD steps come from i18n (seo.cookies.howto.*), localised per language, but
// they are still synced by hand with the UI copy: if static.cookies.sections.managing.browsers.*
// changes, update seo.cookies.howto.* in all three locales as well.
function buildCookiesHowToJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  const prefix = 'seo.cookies.howto.';
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    '@id': `${SEO_CONFIG.domain}/cookies/#howto`,
    name: resolveMsgKey(messages, 'seo.cookies.title'),
    description: resolveMsgKey(messages, 'seo.cookies.description'),
    inLanguage: getLocaleBcp47(locale),
    step: [
      {
        '@type': 'HowToStep',
        position: 1,
        name: 'Chrome',
        text: resolveMsgKey(messages, `${prefix}chrome`),
      },
      {
        '@type': 'HowToStep',
        position: 2,
        name: 'Firefox',
        text: resolveMsgKey(messages, `${prefix}firefox`),
      },
      {
        '@type': 'HowToStep',
        position: 3,
        name: 'Safari',
        text: resolveMsgKey(messages, `${prefix}safari`),
      },
      {
        '@type': 'HowToStep',
        position: 4,
        name: 'Edge',
        text: resolveMsgKey(messages, `${prefix}edge`),
      },
    ],
  };
}

export default function Cookies({
  webPageJsonLd,
  seoTitle,
  seoDescription,
  howToJsonLd,
  breadcrumbJsonLd,
}: CookiesProps) {
  const jsonLdItems: ReadonlyArray<Record<string, unknown>> = [
    WEBSITE_JSONLD,
    ORGANIZATION_JSONLD,
    webPageJsonLd,
    breadcrumbJsonLd,
    howToJsonLd,
  ];
  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/cookies'
        noindex
      />
      <JsonLdComposition data={jsonLdItems} />
      <CookiesPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolvedLocale = locale ?? 'pl';
  const { messages, buildMessages } = await getPublicPageMessages(
    resolvedLocale,
    PUBLIC_PAGE_MESSAGES['/cookies']
  );
  const howToJsonLd = buildCookiesHowToJsonLd(buildMessages, resolvedLocale);
  return {
    props: {
      messages,
      webPageJsonLd: buildCookiesJsonLd(buildMessages, resolvedLocale),
      seoTitle: resolveMsgKey(buildMessages, 'seo.cookies.title'),
      seoDescription: resolveMsgKey(buildMessages, 'seo.cookies.description'),
      howToJsonLd,
      breadcrumbJsonLd: buildBreadcrumbJsonLd(
        buildMessages,
        resolvedLocale,
        [
          { labelKey: 'home', path: '/' },
          { labelKey: 'cookies', path: '/cookies' },
        ],
        `${SEO_CONFIG.domain}/cookies/#breadcrumb`
      ),
    },
    revalidate: 3600,
  };
}
