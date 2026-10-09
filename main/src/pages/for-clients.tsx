import { resolveDefaultOgAsset } from '../UI/assets/brandAssets';
import type { GetStaticPropsContext } from 'next';
import {
  SEO_CONFIG,
  getLocaleBcp47,
  SOFTWARE_APPLICATION_OS,
} from '@kernel/policies/seo.policy';
import { getI18nMessages } from '../application/i18n/i18n.loader';
import { ForClientsPageComposition } from '../UI/features/static/ForClientsPage.composition';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../UI/components/JsonLd';
import { CLIENT_FAQ, QR_STEPS } from '../UI/features/static/ForClientsPageData';
import { attachReviews } from '../UI/features/shared/reviews/ReviewsPageJsonLd';
import { CLIENT_REVIEWS } from '../UI/features/shared/reviews/ReviewsData';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';
import { buildBreadcrumbJsonLd } from '../UI/features/static/breadcrumb.jsonld';
import type { IntlMessages } from '../types/i18n';

interface ForClientsProps {
  serviceJsonLd: Record<string, unknown>;
  offerJsonLd: Record<string, unknown>;
  softwareAppJsonLd: Record<string, unknown>;
  faqJsonLd: Record<string, unknown>;
  howToJsonLd: Record<string, unknown>;
  breadcrumbJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
}

// Name/description/audience w JSON-LD są zlokalizowane (seo.forClients.jsonLd.*)
// per locale — stałe zamienione na buildery wołane w getStaticProps.
const buildServiceJsonLd = (
  messages: IntlMessages
): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'Service',
  '@id': `${SEO_CONFIG.domain}/for-clients/#service`,
  name: resolveMsgKey(messages, 'seo.forClients.jsonLd.serviceName'),
  serviceType: resolveMsgKey(messages, 'seo.forClients.jsonLd.serviceType'),
  provider: { '@id': `${SEO_CONFIG.domain}/#organization` },
  description: resolveMsgKey(
    messages,
    'seo.forClients.jsonLd.serviceDescription'
  ),
  areaServed: [
    { '@type': 'Country', name: 'Poland' },
    { '@type': 'Country', name: 'Germany' },
    { '@type': 'Country', name: 'Austria' },
    { '@type': 'Country', name: 'United Kingdom' },
  ],
  audience: {
    '@type': 'Audience',
    audienceType: resolveMsgKey(messages, 'seo.forClients.jsonLd.audienceType'),
  },
  url: `${SEO_CONFIG.domain}/for-clients/`,
  inLanguage: ['pl-PL', 'en-US', 'de-DE'],
});

// DECISION (nie usuwaj tego komentarza):
// `price:'0'` w JSON-LD dla klientek zostaje — produkt darmowy na zawsze (brak ceny
// Stripe, nie może dryfować). B37 (Stripe = SSOT cen) dotyczy płatnych planów stylistek,
// nie darmowej aplikacji dla klientek. Dotyczy też buildClientSoftwareAppJsonLd niżej.
const buildClientOfferJsonLd = (
  messages: IntlMessages
): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'Offer',
  '@id': `${SEO_CONFIG.domain}/for-clients/#offer-client`,
  name: resolveMsgKey(messages, 'seo.forClients.jsonLd.offerName'),
  description: resolveMsgKey(
    messages,
    'seo.forClients.jsonLd.offerDescription'
  ),
  price: '0',
  priceCurrency: 'PLN',
  availability: 'https://schema.org/InStock',
  eligibleCustomerType: 'Client',
  category: 'Free',
  url: `${SEO_CONFIG.domain}/for-clients/`,
  seller: { '@id': `${SEO_CONFIG.domain}/#organization` },
});

/**
 * SoftwareApplication (client-facing, free) — nośnik dla aggregateRating opinii
 * klientek. Osobna encja od stylist-app: inna grupa docelowa, darmowy plan,
 * `#software` @id. AggregateRating doczepiany w getStaticProps (Google pokazuje
 * review snippets dla SoftwareApplication, nie dla Service/Organization).
 */
const buildClientSoftwareAppJsonLd = (
  messages: IntlMessages,
  locale: string | undefined = 'pl'
): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': `${SEO_CONFIG.domain}/for-clients/#software`,
  name: resolveMsgKey(messages, 'seo.forClients.jsonLd.serviceName'),
  applicationCategory: 'LifestyleApplication',
  operatingSystem: SOFTWARE_APPLICATION_OS,
  url: `${SEO_CONFIG.domain}/for-clients/`,
  description: resolveMsgKey(messages, 'seo.forClients.jsonLd.appDescription'),
  image: `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`,
  inLanguage: ['pl-PL', 'en-US', 'de-DE'],
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'PLN',
    availability: 'https://schema.org/InStock',
    url: `${SEO_CONFIG.domain}/for-clients/`,
  },
  featureList: [1, 2, 3, 4, 5].map(n =>
    resolveMsgKey(messages, `seo.forClients.jsonLd.feature${n}`)
  ),
  audience: {
    '@type': 'Audience',
    audienceType: resolveMsgKey(messages, 'seo.forClients.jsonLd.audienceType'),
  },
  author: { '@id': `${SEO_CONFIG.domain}/#organization` },
  publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
});

export default function ForClients({
  serviceJsonLd,
  offerJsonLd,
  softwareAppJsonLd,
  faqJsonLd,
  howToJsonLd,
  breadcrumbJsonLd,
  seoTitle,
  seoDescription,
}: ForClientsProps) {
  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/for-clients'
      />
      <JsonLdComposition
        data={[
          WEBSITE_JSONLD,
          ORGANIZATION_JSONLD,
          serviceJsonLd,
          offerJsonLd,
          softwareAppJsonLd,
          faqJsonLd,
          howToJsonLd,
          breadcrumbJsonLd,
        ]}
        id='for-clients'
      />
      <ForClientsPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolvedLocale = locale ?? 'pl';
  const messages = await getI18nMessages(resolvedLocale, [
    'static.forClients',
    'static.reviews',
    'seo',
  ]);

  const prefix = 'static.forClients.';
  const bcp47 = getLocaleBcp47(resolvedLocale);

  const faqJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SEO_CONFIG.domain}/for-clients/#faq`,
    inLanguage: bcp47,
    mainEntity: CLIENT_FAQ.map(q => ({
      '@type': 'Question',
      name: resolveMsgKey(messages, prefix + q.questionKey),
      acceptedAnswer: {
        '@type': 'Answer',
        text: resolveMsgKey(messages, prefix + q.answerKey),
      },
    })),
  };

  const howToJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    '@id': `${SEO_CONFIG.domain}/for-clients/#howto`,
    name: resolveMsgKey(messages, 'seo.forClients.jsonLd.howToName'),
    description: resolveMsgKey(
      messages,
      'seo.forClients.jsonLd.howToDescription'
    ),
    inLanguage: bcp47,
    totalTime: 'PT5M',
    estimatedCost: {
      '@type': 'MonetaryAmount',
      currency: 'PLN',
      value: '0',
    },
    tool: [
      {
        '@type': 'HowToTool',
        name: resolveMsgKey(messages, 'seo.forClients.jsonLd.howToTool'),
      },
    ],
    step: QR_STEPS.map((step, idx) => ({
      '@type': 'HowToStep',
      position: idx + 1,
      name: resolveMsgKey(messages, prefix + step.titleKey),
      text: resolveMsgKey(messages, prefix + step.bodyKey),
      url: `${SEO_CONFIG.domain}/for-clients/#how-step-${idx + 1}`,
    })),
  };

  const softwareAppJsonLd = attachReviews(
    buildClientSoftwareAppJsonLd(messages, resolvedLocale),
    CLIENT_REVIEWS,
    messages,
    resolvedLocale
  );

  return {
    props: {
      messages,
      serviceJsonLd: buildServiceJsonLd(messages),
      offerJsonLd: buildClientOfferJsonLd(messages),
      softwareAppJsonLd,
      faqJsonLd,
      howToJsonLd,
      breadcrumbJsonLd: buildBreadcrumbJsonLd(
        messages,
        resolvedLocale,
        [
          { labelKey: 'home', path: '/' },
          { labelKey: 'forClients', path: '/for-clients' },
        ],
        `${SEO_CONFIG.domain}/for-clients/#breadcrumb`
      ),
      seoTitle: resolveMsgKey(messages, 'seo.forClients.title'),
      seoDescription: resolveMsgKey(messages, 'seo.forClients.description'),
    },
    revalidate: 3600,
  };
}
