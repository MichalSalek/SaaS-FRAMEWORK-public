import type { GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
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
  const { messages, buildMessages } = await getPublicPageMessages(
    resolvedLocale,
    PUBLIC_PAGE_MESSAGES['/for-studios']
  );
  const serviceJsonLd = buildStudioServiceJsonLd(buildMessages, resolvedLocale);
  const softwareAppJsonLd = attachReviews(
    buildStudioSoftwareAppJsonLd(buildMessages, resolvedLocale),
    STUDIO_REVIEWS,
    buildMessages,
    resolvedLocale
  );
  const faqJsonLd = buildStudioFaqJsonLd(buildMessages, resolvedLocale);
  const howToJsonLd = buildStudioHowToJsonLd(buildMessages, resolvedLocale);
  const webPageJsonLd = buildStudioWebPageJsonLd(buildMessages, resolvedLocale);

  return {
    props: {
      messages,
      serviceJsonLd,
      softwareAppJsonLd,
      faqJsonLd,
      howToJsonLd,
      webPageJsonLd,
      breadcrumbJsonLd: buildStudioBreadcrumbJsonLd(
        buildMessages,
        resolvedLocale
      ),
      seoTitle: resolveMsgKey(buildMessages, 'seo.forStudios.title'),
      seoDescription: resolveMsgKey(
        buildMessages,
        'seo.forStudios.description'
      ),
    },
    revalidate: 3600,
  };
}
