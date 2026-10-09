import { resolveDefaultOgAsset } from '../../assets/brandAssets';
import {
  SEO_CONFIG,
  SOFTWARE_APPLICATION_OS,
} from '@kernel/policies/seo.policy';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import type { IntlMessages } from '../../../types/i18n';
import { stripInlineMarkup } from '../../../application/i18n/strip-inline-markup';
import { FREE_PLAN_OFFER_JSONLD } from '../../components/JsonLd/freePlanOffer';
import { buildBreadcrumbJsonLd } from './breadcrumb.jsonld';
import { PRICING_FAQ } from './PricingPageData';

import { resolveMsgKey } from '../../../application/i18n/resolve-msg-key';

type Messages = Record<string, unknown>;

/* ─── Re-export per-plan Service schemas (split for max-lines) ─── */

export { buildPricingPlansJsonLd } from './PricingPageJsonLd.plans';

/* ─── Shared constants (pricing data SSOT, see PRICING_PACKAGING.md §4) ─── */

/* ─── FAQPage (resolved from messages) ─── */

export function buildPricingFaqJsonLd(
  messages: Messages,
  locale: string
): Record<string, unknown> {
  const p = (messages as Record<string, unknown>)?.static as
    Record<string, unknown> | undefined;
  const pricing = p?.pricing as Record<string, unknown> | undefined;
  const faq = pricing?.faq as Record<string, string> | undefined;

  const inLanguage =
    locale === 'de' ? 'de-DE' : locale === 'en' ? 'en-US' : 'pl-PL';

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SEO_CONFIG.domain}/pricing/#faq`,
    inLanguage,
    mainEntity: PRICING_FAQ.map(item => {
      const qKey = item.questionKey.replace('faq.', '');
      const aKey = item.answerKey.replace('faq.', '');
      // This builder navigates `messages.static.pricing.faq` directly (not via
      // resolveMsgKey), so it strips inline pseudo-tag markup itself to keep
      // structured data clean — same guarantee as the resolveMsgKey path.
      return {
        '@type': 'Question',
        name: stripInlineMarkup(faq?.[qKey] ?? item.questionKey),
        acceptedAnswer: {
          '@type': 'Answer',
          text: stripInlineMarkup(faq?.[aKey] ?? item.answerKey),
        },
      };
    }),
  };
}

/* ─── SoftwareApplication (enriched with AggregateOffer + 5 offers) ─── */

// Description/featureList w JSON-LD są zlokalizowane (seo.pricing.jsonLd.*)
// per locale — stała zamieniona na builder wołany w getStaticProps.
export const buildPricingSoftwareAppJsonLd = (
  messages: IntlMessages,
  locale: string | undefined = 'pl'
): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': `${SEO_CONFIG.domain}/pricing/#software`,
  name: 'Nailfolio',
  applicationCategory: 'BusinessApplication',
  applicationSubCategory: 'Visual CRM / Portfolio Management',
  operatingSystem: SOFTWARE_APPLICATION_OS,
  url: SEO_CONFIG.domain,
  description: resolveMsgKey(messages, 'seo.pricing.jsonLd.appDescription'),
  image: `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`,
  inLanguage: ['pl-PL', 'en-US', 'de-DE'],
  // DECISION (nie usuwaj tego komentarza):
  // No PAID prices in JSON-LD, Stripe is their only SSOT (B37, 2026-05-29). Paid prices
  // come only at runtime from live Stripe (PricingPage); a static AggregateOffer risked
  // drifting from real billing (Omnibus/UOKiK and a Google price-mismatch penalty). The
  // one exception is the Free-plan offer (price 0), which cannot drift
  // (FREE_PLAN_OFFER_JSONLD). aggregateRating is attached in getStaticProps.
  offers: FREE_PLAN_OFFER_JSONLD,
  featureList: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(n =>
    resolveMsgKey(messages, `seo.pricing.jsonLd.feature${n}`).replace(
      '{domain}',
      BRAND_CONFIG.domain
    )
  ),
  author: { '@id': `${SEO_CONFIG.domain}/#organization` },
  publisher: { '@id': `${SEO_CONFIG.domain}/#organization` },
});

/* ─── OfferCatalog (binds 5 plans semantically) ─── */

// Name/description zlokalizowane (seo.pricing.jsonLd.catalog*) per locale.
export const buildPricingOfferCatalogJsonLd = (
  messages: IntlMessages
): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'OfferCatalog',
  '@id': `${SEO_CONFIG.domain}/pricing/#catalog`,
  name: resolveMsgKey(messages, 'seo.pricing.jsonLd.catalogName'),
  description: resolveMsgKey(messages, 'seo.pricing.jsonLd.catalogDescription'),
  url: `${SEO_CONFIG.domain}/pricing/`,
  itemListElement: [
    {
      '@type': 'Offer',
      itemOffered: { '@id': `${SEO_CONFIG.domain}/pricing/#plan-free` },
      position: 1,
    },
    {
      '@type': 'Offer',
      itemOffered: { '@id': `${SEO_CONFIG.domain}/pricing/#plan-pro` },
      position: 2,
    },
    {
      '@type': 'Offer',
      itemOffered: { '@id': `${SEO_CONFIG.domain}/pricing/#plan-pro-plus` },
      position: 3,
    },
    {
      '@type': 'Offer',
      itemOffered: { '@id': `${SEO_CONFIG.domain}/pricing/#plan-studio` },
      position: 4,
    },
    {
      '@type': 'Offer',
      itemOffered: { '@id': `${SEO_CONFIG.domain}/pricing/#plan-scale` },
      position: 5,
    },
  ],
});

/* ─── BreadcrumbList (Home → Pricing) ─── */

export function buildPricingBreadcrumbJsonLd(
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  return buildBreadcrumbJsonLd(
    messages,
    locale,
    [
      { labelKey: 'home', path: '/' },
      { labelKey: 'pricing', path: '/pricing' },
    ],
    `${SEO_CONFIG.domain}/pricing/#breadcrumb`
  );
}
