import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../application/i18n/i18n.loader';
import { PricingPageComposition } from '../UI/features/static/PricingPage.composition';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../UI/components/JsonLd';
import {
  buildPricingSoftwareAppJsonLd,
  buildPricingPlansJsonLd,
  buildPricingOfferCatalogJsonLd,
  buildPricingBreadcrumbJsonLd,
  buildPricingFaqJsonLd,
} from '../UI/features/static/PricingPageJsonLd';
import { attachReviews } from '../UI/features/shared/reviews/ReviewsPageJsonLd';
import { PRICING_REVIEWS } from '../UI/features/shared/reviews/ReviewsData';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';

interface PricingProps {
  softwareAppJsonLd: Record<string, unknown>;
  faqJsonLd: Record<string, unknown>;
  plansJsonLd: Array<Record<string, unknown>>;
  offerCatalogJsonLd: Record<string, unknown>;
  breadcrumbJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
}

export default function Pricing({
  softwareAppJsonLd,
  faqJsonLd,
  plansJsonLd,
  offerCatalogJsonLd,
  breadcrumbJsonLd,
  seoTitle,
  seoDescription,
}: PricingProps) {
  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/pricing'
      />
      <JsonLdComposition
        data={[
          WEBSITE_JSONLD,
          ORGANIZATION_JSONLD,
          softwareAppJsonLd,
          faqJsonLd,
          ...plansJsonLd,
          offerCatalogJsonLd,
          breadcrumbJsonLd,
        ]}
        id='pricing'
      />
      <PricingPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolvedLocale = locale ?? 'pl';
  const messages = await getI18nMessages(resolvedLocale, [
    'static.pricing',
    'static.reviews',
    'account',
    'validation',
    'seo',
  ]);
  const softwareAppJsonLd = attachReviews(
    buildPricingSoftwareAppJsonLd(messages, resolvedLocale),
    PRICING_REVIEWS,
    messages,
    resolvedLocale
  );
  const faqJsonLd = buildPricingFaqJsonLd(messages, resolvedLocale);
  return {
    props: {
      messages,
      softwareAppJsonLd,
      faqJsonLd,
      plansJsonLd: buildPricingPlansJsonLd(messages, resolvedLocale),
      offerCatalogJsonLd: buildPricingOfferCatalogJsonLd(messages),
      breadcrumbJsonLd: buildPricingBreadcrumbJsonLd(messages, resolvedLocale),
      seoTitle: resolveMsgKey(messages, 'seo.pricing.title'),
      seoDescription: resolveMsgKey(messages, 'seo.pricing.description'),
    },
    revalidate: 3600,
  };
}
