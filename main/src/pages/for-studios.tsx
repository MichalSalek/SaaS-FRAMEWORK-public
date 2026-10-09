import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../application/i18n/i18n.loader';
import { ForStudiosPageComposition } from '../UI/features/static/ForStudiosPage.composition';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../UI/components/JsonLd';
import {
  buildStudioServiceJsonLd,
  buildStudioSoftwareAppJsonLd,
  buildStudioBreadcrumbJsonLd,
  buildStudioFaqJsonLd,
  buildStudioHowToJsonLd,
  buildStudioWebPageJsonLd,
  type FaqJsonLd,
  type HowToJsonLd,
} from '../UI/features/static/ForStudiosPageJsonLd';
import { attachReviews } from '../UI/features/shared/reviews/ReviewsPageJsonLd';
import { STUDIO_REVIEWS } from '../UI/features/shared/reviews/ReviewsData';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';

interface ForStudiosProps {
  serviceJsonLd: Record<string, unknown>;
  softwareAppJsonLd: Record<string, unknown>;
  faqJsonLd: FaqJsonLd;
  howToJsonLd: HowToJsonLd;
  webPageJsonLd: Record<string, unknown>;
  breadcrumbJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
}

export default function ForStudios({
  serviceJsonLd,
  softwareAppJsonLd,
  faqJsonLd,
  howToJsonLd,
  webPageJsonLd,
  breadcrumbJsonLd,
  seoTitle,
  seoDescription,
}: ForStudiosProps) {
  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/for-studios'
      />
      <JsonLdComposition
        data={[
          WEBSITE_JSONLD,
          ORGANIZATION_JSONLD,
          webPageJsonLd,
          serviceJsonLd,
          softwareAppJsonLd,
          faqJsonLd,
          howToJsonLd,
          breadcrumbJsonLd,
        ]}
      />
      <ForStudiosPageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolvedLocale = locale ?? 'pl';
  const messages = await getI18nMessages(resolvedLocale, [
    'static.forStudios',
    'static.reviews',
    // account.plan → nazwy features planów w usePricingPlans (hero PriceSlot,
    // pricing tier preview); bez tego konsola sypie MISSING_MESSAGE (fix S24).
    'account.plan',
    'seo',
  ]);
  const serviceJsonLd = buildStudioServiceJsonLd(messages);
  const softwareAppJsonLd = attachReviews(
    buildStudioSoftwareAppJsonLd(messages, resolvedLocale),
    STUDIO_REVIEWS,
    messages,
    resolvedLocale
  );
  const faqJsonLd = buildStudioFaqJsonLd(messages, resolvedLocale);
  const howToJsonLd = buildStudioHowToJsonLd(messages, resolvedLocale);
  const webPageJsonLd = buildStudioWebPageJsonLd(messages, resolvedLocale);

  return {
    props: {
      messages,
      serviceJsonLd,
      softwareAppJsonLd,
      faqJsonLd,
      howToJsonLd,
      webPageJsonLd,
      breadcrumbJsonLd: buildStudioBreadcrumbJsonLd(messages, resolvedLocale),
      seoTitle: resolveMsgKey(messages, 'seo.forStudios.title'),
      seoDescription: resolveMsgKey(messages, 'seo.forStudios.description'),
    },
    revalidate: 3600,
  };
}
