import type { GetStaticPropsContext } from 'next';
import { getI18nMessages } from '../application/i18n/i18n.loader';
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
  const messages = await getI18nMessages(resolvedLocale, [
    'static.compare',
    // account.plan → nota o cenie wejściowej w bandzie finałowym
    // (EntryPriceNoteMolecule → usePricingPlans). Bez tego namespace nota
    // wyrenderowałaby surowe klucze tłumaczeń.
    'account.plan',
  ]);

  const faqJsonLd = buildCompareFaqJsonLd(messages, resolvedLocale);

  return {
    props: {
      messages,
      faqJsonLd,
      breadcrumbJsonLd: buildCompareBreadcrumbJsonLd(messages, resolvedLocale),
      seoTitle: resolveMsgKey(messages, 'static.compare.seo.title'),
      seoDescription: resolveMsgKey(messages, 'static.compare.seo.description'),
    },
    revalidate: 3600,
  };
}
