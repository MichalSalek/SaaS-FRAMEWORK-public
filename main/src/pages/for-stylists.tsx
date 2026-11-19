import type { GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
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
  const { messages, buildMessages } = await getPublicPageMessages(
    resolvedLocale,
    PUBLIC_PAGE_MESSAGES['/for-stylists']
  );

  const softwareAppJsonLd = attachReviews(
    buildForStylistsSoftwareAppJsonLd(buildMessages, resolvedLocale),
    STYLIST_REVIEWS,
    buildMessages,
    resolvedLocale
  );
  const faqJsonLd = buildForStylistsFaqJsonLd(buildMessages, resolvedLocale);
  const howToJsonLd = buildForStylistsHowToJsonLd(
    buildMessages,
    resolvedLocale
  );

  return {
    props: {
      messages,
      softwareAppJsonLd,
      faqJsonLd,
      howToJsonLd,
      breadcrumbJsonLd: buildForStylistsBreadcrumbJsonLd(
        buildMessages,
        resolvedLocale
      ),
      seoTitle: resolveMsgKey(buildMessages, 'seo.forStylists.title'),
      seoDescription: resolveMsgKey(
        buildMessages,
        'seo.forStylists.description'
      ),
    },
    revalidate: 3600,
  };
}
