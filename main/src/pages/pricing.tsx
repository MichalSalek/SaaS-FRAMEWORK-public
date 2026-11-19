import type { GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
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
  const { messages, buildMessages } = await getPublicPageMessages(
    resolvedLocale,
    PUBLIC_PAGE_MESSAGES['/pricing']
  );
  const softwareAppJsonLd = attachReviews(
    buildPricingSoftwareAppJsonLd(buildMessages, resolvedLocale),
    PRICING_REVIEWS,
    buildMessages,
    resolvedLocale
  );
  const faqJsonLd = buildPricingFaqJsonLd(buildMessages, resolvedLocale);
  return {
    props: {
      messages,
      softwareAppJsonLd,
      faqJsonLd,
      plansJsonLd: buildPricingPlansJsonLd(buildMessages, resolvedLocale),
      offerCatalogJsonLd: buildPricingOfferCatalogJsonLd(buildMessages),
      breadcrumbJsonLd: buildPricingBreadcrumbJsonLd(
        buildMessages,
        resolvedLocale
      ),
      seoTitle: resolveMsgKey(buildMessages, 'seo.pricing.title'),
      seoDescription: resolveMsgKey(buildMessages, 'seo.pricing.description'),
    },
    revalidate: 3600,
  };
}
