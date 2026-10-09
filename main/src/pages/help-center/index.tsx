import type { GetStaticPropsContext } from 'next';
import { SEO_CONFIG, getLocaleBcp47 } from '@kernel/policies/seo.policy';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { HelpCenterPageComposition as HelpCenterFeature } from '../../UI/features/static/HelpCenterPage.composition';
import { PublicSeoHeadComposition } from '../../UI/components/PublicSeoHead/PublicSeoHead.composition';
import {
  JsonLdComposition,
  ORGANIZATION_JSONLD,
  WEBSITE_JSONLD,
} from '../../UI/components/JsonLd';
import { FAQ_DATA } from '../../UI/features/static/HelpCenterAccordion.molecule';
import { resolveMsgKey } from '../../application/i18n/resolve-msg-key';
import { buildBreadcrumbJsonLd } from '../../UI/features/static/breadcrumb.jsonld';

interface HelpCenterProps {
  faqJsonLd: Record<string, unknown>;
  howToJsonLd: Record<string, unknown>;
  breadcrumbJsonLd: Record<string, unknown>;
  seoTitle: string;
  seoDescription: string;
}

/**
 * Help Center route — wired to the same feature component as /help so a single
 * page lives behind both URLs. Indexable; PublicSeoHead emits canonical to
 * `/help-center` (the route configured in ROUTES_FRONT_STATIC.HELP_CENTER).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Pojedynczy FAQPage JSON-LD obejmujący wszystkie kategorie (general + stylists + clients +
 * technical), NIE split per kategoria. Google FAQPage spec nie limituje liczby Q&A.
 * Split wymagałby osobnych URLi per kategoria (refactor tabs → routes), naruszając zasadę
 * 1 FAQPage per canonical URL. Tabs UI to ten sam URL = jeden canonical = jeden FAQPage.
 */
export default function HelpCenter({
  faqJsonLd,
  howToJsonLd,
  breadcrumbJsonLd,
  seoTitle,
  seoDescription,
}: HelpCenterProps) {
  return (
    <>
      <PublicSeoHeadComposition
        title={seoTitle}
        description={seoDescription}
        path='/help-center'
      />
      <JsonLdComposition
        data={[
          WEBSITE_JSONLD,
          ORGANIZATION_JSONLD,
          faqJsonLd,
          howToJsonLd,
          breadcrumbJsonLd,
        ]}
        id='help-center'
      />
      <HelpCenterFeature />
    </>
  );
}

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  const resolvedLocale = locale ?? 'pl';
  const messages = await getI18nMessages(resolvedLocale, [
    'static.helpCenter',
    'seo',
  ]);
  const bcp47 = getLocaleBcp47(resolvedLocale);

  // Build FAQ JSON-LD by resolving translation keys from the loaded messages
  const prefix = 'static.helpCenter.';
  const allFaqs = Object.values(FAQ_DATA)
    .flat()
    .map(item => ({
      '@type': 'Question',
      name: resolveMsgKey(messages, prefix + item.questionKey),
      acceptedAnswer: {
        '@type': 'Answer',
        text: resolveMsgKey(messages, prefix + item.answerKey),
      },
    }));

  const faqJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SEO_CONFIG.domain}/help-center/#faq`,
    inLanguage: bcp47,
    mainEntity: allFaqs,
  };

  const wizardSteps = [
    { titleKey: 'wizard.step1Title', bodyKey: 'wizard.step1Body' },
    { titleKey: 'wizard.step2Title', bodyKey: 'wizard.step2Body' },
    { titleKey: 'wizard.step3Title', bodyKey: 'wizard.step3Body' },
    { titleKey: 'wizard.step4Title', bodyKey: 'wizard.step4Body' },
  ];

  // Name/description/tool w HowTo JSON-LD zlokalizowane
  // (seo.helpCenter.jsonLd.*) per locale.
  const howToJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    '@id': `${SEO_CONFIG.domain}/help-center/#howto`,
    name: resolveMsgKey(messages, 'seo.helpCenter.jsonLd.howToName'),
    description: resolveMsgKey(
      messages,
      'seo.helpCenter.jsonLd.howToDescription'
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
        name: resolveMsgKey(messages, 'seo.helpCenter.jsonLd.howToTool'),
      },
    ],
    step: wizardSteps.map((step, idx) => ({
      '@type': 'HowToStep',
      position: idx + 1,
      name: resolveMsgKey(messages, prefix + step.titleKey),
      text: resolveMsgKey(messages, prefix + step.bodyKey),
      url: `${SEO_CONFIG.domain}/help-center/#wizard-step-${idx + 1}`,
    })),
  };

  return {
    props: {
      messages,
      faqJsonLd,
      howToJsonLd,
      breadcrumbJsonLd: buildBreadcrumbJsonLd(
        messages,
        resolvedLocale,
        [
          { labelKey: 'home', path: '/' },
          { labelKey: 'helpCenter', path: '/help-center' },
        ],
        `${SEO_CONFIG.domain}/help-center/#breadcrumb`
      ),
      seoTitle: resolveMsgKey(messages, 'seo.helpCenter.title'),
      seoDescription: resolveMsgKey(messages, 'seo.helpCenter.description'),
    },
    revalidate: 3600,
  };
}
