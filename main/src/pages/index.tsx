import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../application/i18n/i18n.loader';
import { HomePageComposition } from '../UI/features/home/HomePage.composition';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../UI/components/JsonLd';
import { FAQ_ITEMS } from '../UI/features/home/homePageData';
import { SEO_CONFIG, getLocaleBcp47 } from '@kernel/policies/seo.policy';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';
import { attachReviews } from '../UI/features/shared/reviews/ReviewsPageJsonLd';
import { HOME_REVIEWS } from '../UI/features/shared/reviews/ReviewsData';
import {
  buildHomeSoftwareAppJsonLd,
  buildHomeBreadcrumbJsonLd,
} from '../UI/features/static/HomePageJsonLd';

type FaqJsonLd = Record<string, unknown>;

interface HomeProps {
  softwareAppJsonLd: Record<string, unknown>;
  faqJsonLd: FaqJsonLd;
  breadcrumbJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
}

export default function Home({
  softwareAppJsonLd,
  faqJsonLd,
  breadcrumbJsonLd,
  seoTitle,
  seoDescription,
}: HomeProps) {
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
        path='/'
      />
      <JsonLdComposition data={jsonLdItems} />
      <HomePageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolvedLocale = locale ?? 'pl';
  const messages = await getI18nMessages(resolvedLocale, [
    // account.plan → nazwy planów i nota o cenie wejściowej (usePricingPlans,
    // EntryPriceNoteMolecule); bez tego namespace konsola sypie MISSING_MESSAGE.
    'account.plan',
    'pages.home',
    'static.reviews',
    'validation',
    'seo',
  ]);

  const prefix = 'pages.home.';
  const faqJsonLd: FaqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SEO_CONFIG.domain}/#faq`,
    inLanguage: getLocaleBcp47(resolvedLocale),
    mainEntity: FAQ_ITEMS.map(item => ({
      '@type': 'Question',
      name: resolveMsgKey(messages, prefix + item.questionKey),
      acceptedAnswer: {
        '@type': 'Answer',
        text: resolveMsgKey(messages, prefix + item.answerKey),
      },
    })),
  };

  const softwareAppJsonLd = attachReviews(
    buildHomeSoftwareAppJsonLd(messages, resolvedLocale),
    HOME_REVIEWS,
    messages,
    resolvedLocale
  );

  return {
    props: {
      messages,
      softwareAppJsonLd,
      faqJsonLd,
      breadcrumbJsonLd: buildHomeBreadcrumbJsonLd(messages, resolvedLocale),
      seoTitle: resolveMsgKey(messages, 'seo.home.title'),
      seoDescription: resolveMsgKey(messages, 'seo.home.description'),
    },
  };
}
