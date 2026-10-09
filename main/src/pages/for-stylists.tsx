import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../application/i18n/i18n.loader';
import { ForStylistsPageComposition } from '../UI/features/static/ForStylistsPage.composition';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../UI/components/JsonLd';
import {
  buildForStylistsSoftwareAppJsonLd,
  buildForStylistsBreadcrumbJsonLd,
  buildForStylistsFaqJsonLd,
  buildForStylistsHowToJsonLd,
} from '../UI/features/static/ForStylistsPageJsonLd';
import { attachReviews } from '../UI/features/shared/reviews/ReviewsPageJsonLd';
import { STYLIST_REVIEWS } from '../UI/features/shared/reviews/ReviewsData';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';

interface ForStylistsProps {
  softwareAppJsonLd: Record<string, unknown>;
  faqJsonLd: Record<string, unknown>;
  howToJsonLd: Record<string, unknown>;
  breadcrumbJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
}

export default function ForStylists({
  softwareAppJsonLd,
  faqJsonLd,
  howToJsonLd,
  breadcrumbJsonLd,
  seoTitle,
  seoDescription,
}: ForStylistsProps) {
  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/for-stylists'
      />
      <JsonLdComposition
        data={[
          WEBSITE_JSONLD,
          ORGANIZATION_JSONLD,
          softwareAppJsonLd,
          faqJsonLd,
          howToJsonLd,
          breadcrumbJsonLd,
        ]}
        id='for-stylists'
      />
      <ForStylistsPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolvedLocale = locale ?? 'pl';
  const messages = await getI18nMessages(resolvedLocale, [
    'static.forStylists',
    'static.reviews',
    // account.plan → nazwy features planów w usePricingPlans (sekcja pricing
    // preview); bez tego namespace konsola sypie MISSING_MESSAGE (fix S24).
    'account.plan',
    'seo',
  ]);

  const softwareAppJsonLd = attachReviews(
    buildForStylistsSoftwareAppJsonLd(messages, resolvedLocale),
    STYLIST_REVIEWS,
    messages,
    resolvedLocale
  );
  const faqJsonLd = buildForStylistsFaqJsonLd(messages, resolvedLocale);
  const howToJsonLd = buildForStylistsHowToJsonLd(messages, resolvedLocale);

  return {
    props: {
      messages,
      softwareAppJsonLd,
      faqJsonLd,
      howToJsonLd,
      breadcrumbJsonLd: buildForStylistsBreadcrumbJsonLd(
        messages,
        resolvedLocale
      ),
      seoTitle: resolveMsgKey(messages, 'seo.forStylists.title'),
      seoDescription: resolveMsgKey(messages, 'seo.forStylists.description'),
    },
    revalidate: 3600,
  };
}
