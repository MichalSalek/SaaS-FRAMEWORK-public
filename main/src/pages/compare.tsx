import type { GetStaticPropsContext } from 'next';
import { getPublicPageMessages } from '../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../application/i18n/page-messages.config';
import { ComparePageComposition } from '../UI/features/static/ComparePage.composition';
import { PublicSeoHeadComposition } from '../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../UI/components/JsonLd';
import {
  buildCompareBreadcrumbJsonLd,
  buildCompareFaqJsonLd,
} from '../UI/features/static/ComparePageJsonLd';
import { resolveMsgKey } from '../application/i18n/resolve-msg-key';

interface CompareProps {
  faqJsonLd: Record<string, unknown>;
  breadcrumbJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
}

export default function Compare({
  faqJsonLd,
  breadcrumbJsonLd,
  seoTitle,
  seoDescription,
}: CompareProps) {
  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/compare'
      />
      <JsonLdComposition
        data={[
          WEBSITE_JSONLD,
          ORGANIZATION_JSONLD,
          faqJsonLd,
          breadcrumbJsonLd,
        ]}
        id='compare'
      />
      <ComparePageComposition />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolvedLocale = locale ?? 'pl';
  const { messages, buildMessages } = await getPublicPageMessages(
    resolvedLocale,
    PUBLIC_PAGE_MESSAGES['/compare']
  );

  const faqJsonLd = buildCompareFaqJsonLd(buildMessages, resolvedLocale);

  return {
    props: {
      messages,
      faqJsonLd,
      breadcrumbJsonLd: buildCompareBreadcrumbJsonLd(
        buildMessages,
        resolvedLocale
      ),
      seoTitle: resolveMsgKey(buildMessages, 'static.compare.seo.title'),
      seoDescription: resolveMsgKey(
        buildMessages,
        'static.compare.seo.description'
      ),
    },
    revalidate: 3600,
  };
}
