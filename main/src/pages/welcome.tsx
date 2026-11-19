import type { GetStaticPropsContext } from 'next';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { getLocaleBcp47, SEO_CONFIG } from '@kernel/policies/seo.policy';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
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
 * /welcome: start screen for a logged-out user in the wrapper app (routed here by
 * useNativeEntryRedirectGuard) AND a public, INDEXABLE page (footer link, SEO). Standalone:
 * WelcomePageComposition fills the whole viewport (no PublicLayout, like LoginPage).
 *
 * Structured data (WebSite + Organization + WebPage + BreadcrumbList) at parity with the other
 * indexable static pages: an indexable page in the sitemap without JSON-LD gave Google no
 * entity/site signals.
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
  // static.getApp: the install nudge on mobile web (GetAppStoreButtons); the Play/App Store labels
  // live in the get-app page namespace (SSOT, no copy).
  const { messages, buildMessages } = await getPublicPageMessages(
    resolved,
    PUBLIC_PAGE_MESSAGES['/welcome']
  );

  const seoTitle = resolveMsgKey(buildMessages, 'static.welcome.seoTitle');
  const seoDescription = resolveMsgKey(
    buildMessages,
    'static.welcome.seoDescription'
  );

  const jsonLd: ReadonlyArray<Record<string, unknown>> = [
    WEBSITE_JSONLD,
    ORGANIZATION_JSONLD,
    buildWelcomeWebPageJsonLd(resolved, seoTitle, seoDescription),
    buildBreadcrumbJsonLd(
      buildMessages,
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
