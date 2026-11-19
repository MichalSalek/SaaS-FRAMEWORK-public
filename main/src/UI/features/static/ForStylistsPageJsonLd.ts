import { resolveDefaultOgAsset } from '../../assets/brandAssets';
import {
  SEO_CONFIG,
  getLocaleBcp47,
  SOFTWARE_APPLICATION_OS,
} from '@kernel/policies/seo.policy';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import {
  COLOR_SEED_DATA,
  TRAIT_SEED_DATA,
} from '@kernel/domain/gallery/gallery.seed';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import type { IntlMessages } from '../../../types/i18n';
import { resolveMsgKey } from '../../../application/i18n/resolve-msg-key';
import { FREE_PLAN_OFFER_JSONLD } from '../../components/JsonLd/freePlanOffer';
import { buildBreadcrumbJsonLd } from './breadcrumb.jsonld';
import { OBJECTION_FAQ, STYLIST_PLAYBOOK } from './ForStylistsPageData';

/**
 * ForStylists JSON-LD builders + static schema constants.
 *
 * Extracted from `pages/for-stylists.tsx` to match the project convention
 * (`ForStudiosPageJsonLd.ts`, `PricingPageJsonLd.ts`): page shells stay thin,
 * structured-data lives in a dedicated module.
 */

const I18N_PREFIX = 'static.forStylists.';

// Taxonomy counts are derived from the seed SSOT so the featureList never drifts from it.
const COLOR_COUNT = COLOR_SEED_DATA.length;
const TRAIT_COUNT = TRAIT_SEED_DATA.length;
const TRAIT_CATEGORY_COUNT = new Set(TRAIT_SEED_DATA.map(t => t.category)).size;
const NAIL_LENGTH_COUNT = Object.keys(NAIL_LENGTHS).length;

// Name/description/featureList/audience in the JSON-LD are localized
// (seo.forStylists.jsonLd.*) per locale: a builder called in getStaticProps.
// Values derived from the SSOT (taxonomy, BRAND_CONFIG) enter through
// placeholders substituted at build time.
export const buildForStylistsSoftwareAppJsonLd = (
  messages: IntlMessages,
  locale: string | undefined = 'pl'
): Record<string, unknown> => {
  const jsonLdKey = (leaf: string): string =>
    resolveMsgKey(messages, `seo.forStylists.jsonLd.${leaf}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SEO_CONFIG.domain}/for-stylists/#software`,
    name: jsonLdKey('appName'),
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Visual CRM / Portfolio Management',
    operatingSystem: SOFTWARE_APPLICATION_OS,
    url: `${SEO_CONFIG.domain}/for-stylists/`,
    description: jsonLdKey('appDescription'),
    image: `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`,
    inLanguage: ['pl-PL', 'en-US', 'de-DE'],
    // DECISION: see main/src/UI/components/JsonLd/freePlanOffer.ts (no paid prices in JSON-LD).
    // aggregateRating is attached in getStaticProps.
    offers: FREE_PLAN_OFFER_JSONLD,
    featureList: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n =>
      jsonLdKey(`feature${n}`)
        .replace('{colors}', String(COLOR_COUNT))
        .replace('{traits}', String(TRAIT_COUNT))
        .replace('{categories}', String(TRAIT_CATEGORY_COUNT))
        .replace('{lengths}', String(NAIL_LENGTH_COUNT))
        .replace('{domain}', BRAND_CONFIG.domain)
    ),
    audience: {
      '@type': 'BusinessAudience',
      audienceType: jsonLdKey('audienceType'),
      geographicArea: [
        { '@type': 'Country', name: 'Poland' },
        { '@type': 'Country', name: 'Germany' },
        { '@type': 'Country', name: 'Austria' },
        { '@type': 'Country', name: 'United Kingdom' },
      ],
    },
    publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
  };
};

export function buildForStylistsBreadcrumbJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  return buildBreadcrumbJsonLd(
    messages,
    locale,
    [
      { labelKey: 'home', path: '/' },
      { labelKey: 'forStylists', path: '/for-stylists' },
    ],
    `${SEO_CONFIG.domain}/for-stylists/#breadcrumb`
  );
}

export function buildForStylistsFaqJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SEO_CONFIG.domain}/for-stylists/#faq`,
    inLanguage: getLocaleBcp47(locale),
    mainEntity: OBJECTION_FAQ.map(q => ({
      '@type': 'Question',
      name: resolveMsgKey(messages, I18N_PREFIX + q.questionKey),
      acceptedAnswer: {
        '@type': 'Answer',
        text: resolveMsgKey(messages, I18N_PREFIX + q.answerKey),
      },
    })),
  };
}

export function buildForStylistsHowToJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    '@id': `${SEO_CONFIG.domain}/for-stylists/#howto`,
    name: resolveMsgKey(messages, 'seo.forStylists.jsonLd.howToName'),
    description: resolveMsgKey(
      messages,
      'seo.forStylists.jsonLd.howToDescription'
    ),
    inLanguage: getLocaleBcp47(locale),
    totalTime: 'PT5M',
    estimatedCost: {
      '@type': 'MonetaryAmount',
      currency: 'PLN',
      value: '0',
    },
    supply: [
      {
        '@type': 'HowToSupply',
        name: resolveMsgKey(messages, 'seo.forStylists.jsonLd.howToSupply'),
      },
    ],
    tool: [
      {
        '@type': 'HowToTool',
        name: resolveMsgKey(messages, 'seo.forStylists.jsonLd.howToTool1'),
      },
      {
        '@type': 'HowToTool',
        name: resolveMsgKey(messages, 'seo.forStylists.jsonLd.howToTool2'),
      },
    ],
    step: STYLIST_PLAYBOOK.map((step, idx) => ({
      '@type': 'HowToStep',
      position: idx + 1,
      name: resolveMsgKey(messages, I18N_PREFIX + step.titleKey),
      text: resolveMsgKey(messages, I18N_PREFIX + step.bodyKey),
      url: `${SEO_CONFIG.domain}/for-stylists/#playbook-step-${idx + 1}`,
    })),
  };
}
