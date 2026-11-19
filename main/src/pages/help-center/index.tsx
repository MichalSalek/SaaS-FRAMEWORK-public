import type { GetStaticPropsContext } from 'next';
import { SEO_CONFIG, getLocaleBcp47 } from '@kernel/policies/seo.policy';
import { getPublicPageMessages } from '../../application/i18n/i18n.loader';
import { PUBLIC_PAGE_MESSAGES } from '../../application/i18n/page-messages.config';
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
 * DECISION: ONE FAQPage JSON-LD covers all categories (general + stylists + clients + technical),
 * NOT one per category. Google's FAQPage spec does not limit the number of Q&A, and a split would
 * need separate URLs per category (tabs → routes), breaking the rule of one FAQPage per canonical
 * URL. The tabs UI is one URL, so one canonical and one FAQPage.
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
  const { messages, buildMessages } = await getPublicPageMessages(
    resolvedLocale,
    PUBLIC_PAGE_MESSAGES['/help-center']
  );
  const bcp47 = getLocaleBcp47(resolvedLocale);

  // Build FAQ JSON-LD by resolving translation keys from the loaded buildMessages
  const prefix = 'static.helpCenter.';
  const allFaqs = Object.values(FAQ_DATA)
    .flat()
    .map(item => ({
      '@type': 'Question',
      name: resolveMsgKey(buildMessages, prefix + item.questionKey),
      acceptedAnswer: {
        '@type': 'Answer',
        text: resolveMsgKey(buildMessages, prefix + item.answerKey),
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
    name: resolveMsgKey(buildMessages, 'seo.helpCenter.jsonLd.howToName'),
    description: resolveMsgKey(
      buildMessages,
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
        name: resolveMsgKey(buildMessages, 'seo.helpCenter.jsonLd.howToTool'),
      },
    ],
    step: wizardSteps.map((step, idx) => ({
      '@type': 'HowToStep',
      position: idx + 1,
      name: resolveMsgKey(buildMessages, prefix + step.titleKey),
      text: resolveMsgKey(buildMessages, prefix + step.bodyKey),
      url: `${SEO_CONFIG.domain}/help-center/#wizard-step-${idx + 1}`,
    })),
  };

  return {
    props: {
      messages,
      faqJsonLd,
      howToJsonLd,
      breadcrumbJsonLd: buildBreadcrumbJsonLd(
        buildMessages,
        resolvedLocale,
        [
          { labelKey: 'home', path: '/' },
          { labelKey: 'helpCenter', path: '/help-center' },
        ],
        `${SEO_CONFIG.domain}/help-center/#breadcrumb`
      ),
      seoTitle: resolveMsgKey(buildMessages, 'seo.helpCenter.title'),
      seoDescription: resolveMsgKey(
        buildMessages,
        'seo.helpCenter.description'
      ),
    },
    revalidate: 3600,
  };
}
