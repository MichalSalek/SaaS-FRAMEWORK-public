import { SEO_CONFIG, getLocaleBcp47 } from '@kernel/policies/seo.policy';
import type { IntlMessages } from '../../../types/i18n';
import { resolveMsgKey } from '../../../application/i18n/resolve-msg-key';
import { buildBreadcrumbJsonLd } from './breadcrumb.jsonld';
import { COMPARE_FAQ } from './ComparePageData';

/**
 * Compare JSON-LD builders + static schema constants.
 *
 * Project convention (`ForStylistsPageJsonLd.ts`, `PricingPageJsonLd.ts`):
 * page shells stay thin, structured-data lives in a dedicated module.
 * Only FAQPage and BreadcrumbList. No Product or offers (Stripe is the only
 * price source) and no SoftwareApplication (the canonical app schema lives on
 * /for-stylists; a duplicate on the comparison page would blur the @id graph).
 */

const I18N_PREFIX = 'static.compare.';

export function buildCompareBreadcrumbJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  return buildBreadcrumbJsonLd(
    messages,
    locale,
    [
      { labelKey: 'home', path: '/' },
      { labelKey: 'compare', path: '/compare' },
    ],
    `${SEO_CONFIG.domain}/compare/#breadcrumb`
  );
}

export function buildCompareFaqJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SEO_CONFIG.domain}/compare/#faq`,
    inLanguage: getLocaleBcp47(locale),
    mainEntity: COMPARE_FAQ.map(q => ({
      '@type': 'Question',
      name: resolveMsgKey(messages, I18N_PREFIX + q.questionKey),
      acceptedAnswer: {
        '@type': 'Answer',
        text: resolveMsgKey(messages, I18N_PREFIX + q.answerKey),
      },
    })),
  };
}
