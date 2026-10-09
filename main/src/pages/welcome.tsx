import type { GetStaticPropsContext } from 'next';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { getLocaleBcp47, SEO_CONFIG } from '@kernel/policies/seo.policy';
import { getI18nMessages } from '../application/i18n/i18n.loader';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../UI/components/JsonLd';
import { buildBreadcrumbJsonLd } from '../UI/features/static/breadcrumb.jsonld';
import { WelcomePageComposition } from '../UI/features/static/WelcomePage.composition';

interface WelcomeProps {
  seoTitle: string;
  seoDescription: string;
  jsonLd: ReadonlyArray<Record<string, unknown>>;
}

/**
 * /welcome — starter ekran dla niezalogowanego w apce-wrapperze (kierowany tu
 * przez useNativeEntryRedirectGuard) ORAZ publiczna, INDEKSOWALNA podstrona
 * (link w stopce, SEO). Standalone: WelcomePageComposition zajmuje cały
 * viewport (bez PublicLayout — jak LoginPage).
 *
 * Structured data (WebSite + Organization + WebPage + BreadcrumbList) na parytecie
 * z pozostałymi indeksowalnymi stronami statycznymi — indeksowalna strona w
 * sitemapie bez JSON-LD nie dawała Google żadnych sygnałów encji/site.
 */
export default function Welcome({
  seoTitle,
  seoDescription,
  jsonLd,
}: WelcomeProps) {
  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path={ROUTES_FRONT.WELCOME}
      />
      <JsonLdComposition data={jsonLd} />
      <WelcomePageComposition />
    </>
  );
}

function buildWelcomeWebPageJsonLd(
  locale: string,
  name: string,
  description: string
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${SEO_CONFIG.domain}/welcome/#webpage`,
    name,
    description,
    url: `${SEO_CONFIG.domain}/welcome/`,
    inLanguage: getLocaleBcp47(locale),
    isPartOf: { '@id': `${SEO_CONFIG.domain}/#website` },
    publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
    breadcrumb: { '@id': `${SEO_CONFIG.domain}/welcome/#breadcrumb` },
  };
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolved = locale ?? 'pl';
  // static.getApp: zachęcacz instalacji na mobile web (GetAppStoreButtons —
  // labelki Play/App Store żyją w namespace strony get-app, SSOT bez kopii).
  const messages = await getI18nMessages(resolved, [
    'static.welcome',
    'static.getApp',
    'seo',
  ]);

  const seoTitle = resolveMsgKey(messages, 'static.welcome.seoTitle');
  const seoDescription = resolveMsgKey(
    messages,
    'static.welcome.seoDescription'
  );

  const jsonLd: ReadonlyArray<Record<string, unknown>> = [
    WEBSITE_JSONLD,
    ORGANIZATION_JSONLD,
    buildWelcomeWebPageJsonLd(resolved, seoTitle, seoDescription),
    buildBreadcrumbJsonLd(
      messages,
      resolved,
      [
        { labelKey: 'home', path: '/' },
        { labelKey: 'welcome', path: '/welcome' },
      ],
      `${SEO_CONFIG.domain}/welcome/#breadcrumb`
    ),
  ];

  return { props: { messages, seoTitle, seoDescription, jsonLd } };
}
