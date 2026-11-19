import { resolveDefaultOgAsset } from '../UI/assets/brandAssets';
import type { GetStaticPropsContext, InferGetStaticPropsType } from 'next';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';
import { GetAppPageComposition } from '../UI/features/static/GetAppPage.composition';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  FREE_PLAN_OFFER_JSONLD,
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../UI/components/JsonLd';
import {
  getLocaleBcp47,
  SEO_CONFIG,
  SOFTWARE_APPLICATION_OS,
} from '@kernel/policies/seo.policy';
import { attachReviews } from '../UI/features/shared/reviews/ReviewsPageJsonLd';
import { GET_APP_REVIEWS } from '../UI/features/shared/reviews/ReviewsData';
import { buildBreadcrumbJsonLd } from '../UI/features/static/breadcrumb.jsonld';
import type { IntlMessages } from '../types/i18n';

/**
 * SoftwareApplication JSON-LD — enriched with featureList, audience, inLanguage,
 * publisher/author refs to shared Organization (Wave B7).
 *
 * Description/featureList/audience zlokalizowane (seo.getApp.jsonLd.*) per
 * locale — stała zamieniona na builder wołany w getStaticProps.
 */
const buildGetAppSoftwareAppJsonLd = (
  messages: IntlMessages,
  locale: string | undefined = 'pl'
): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': `${SEO_CONFIG.domain}/get-app/#software`,
  name: 'Nailfolio',
  description: resolveMsgKey(messages, 'seo.getApp.jsonLd.appDescription'),
  url: `${SEO_CONFIG.domain}/get-app/`,
  applicationCategory: 'BusinessApplication',
  applicationSubCategory: 'PortfolioApplication',
  operatingSystem: SOFTWARE_APPLICATION_OS,
  softwareVersion: '1.0',
  inLanguage: ['pl-PL', 'en-US', 'de-DE'],
  image: `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`,
  screenshot: `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`,
  featureList: [1, 2, 3, 4, 5, 6].map(n =>
    resolveMsgKey(messages, `seo.getApp.jsonLd.feature${n}`)
  ),
  audience: {
    '@type': 'BusinessAudience',
    audienceType: resolveMsgKey(messages, 'seo.getApp.jsonLd.audienceType'),
  },

  offers: FREE_PLAN_OFFER_JSONLD,
  author: { '@id': `${SEO_CONFIG.domain}/#organization` },
  publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
});

export default function GetApp({
  softwareAppJsonLd,
  faqJsonLd,
  breadcrumbJsonLd,
  seoTitle,
  seoDescription,
}: InferGetStaticPropsType<typeof getStaticProps>) {
  const jsonLdItems: ReadonlyArray<Record<string, unknown>> = [
    WEBSITE_JSONLD,
    ORGANIZATION_JSONLD,
    softwareAppJsonLd,
    faqJsonLd,
    breadcrumbJsonLd,
  ];

  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/get-app'
      />
      <JsonLdComposition data={jsonLdItems} id='get-app' />
      <GetAppPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolved = locale ?? 'pl';
  const { messages, buildMessages } = await getPublicPageMessages(
    resolved,
    PUBLIC_PAGE_MESSAGES['/get-app']
  );

  const prefix = 'static.getApp.faq.';
  const faqJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SEO_CONFIG.domain}/get-app/#faq`,
    inLanguage: getLocaleBcp47(resolved),
    mainEntity: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'].map(
      (qKey, idx) => ({
        '@type': 'Question',
        name: resolveMsgKey(buildMessages, prefix + qKey),
        acceptedAnswer: {
          '@type': 'Answer',
          text: resolveMsgKey(buildMessages, prefix + `a${idx + 1}`),
        },
      })
    ),
  };

  const softwareAppJsonLd = attachReviews(
    buildGetAppSoftwareAppJsonLd(buildMessages, resolved),
    GET_APP_REVIEWS,
    buildMessages,
    resolved
  );

  return {
    props: {
      messages,
      softwareAppJsonLd,
      faqJsonLd,
      breadcrumbJsonLd: buildBreadcrumbJsonLd(
        buildMessages,
        resolved,
        [
          { labelKey: 'home', path: '/' },
          { labelKey: 'getApp', path: '/get-app' },
        ],
        `${SEO_CONFIG.domain}/get-app/#breadcrumb`
      ),
      seoTitle: resolveMsgKey(buildMessages, 'seo.getApp.title'),
      seoDescription: resolveMsgKey(buildMessages, 'seo.getApp.description'),
    },
    revalidate: 3600,
  };
}
