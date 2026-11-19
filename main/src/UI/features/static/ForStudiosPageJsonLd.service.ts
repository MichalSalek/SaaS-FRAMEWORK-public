import { SEO_CONFIG } from '@kernel/policies/seo.policy';
import type { IntlMessages } from '../../../types/i18n';
import { resolveMsgKey } from '../../../application/i18n/resolve-msg-key';
import {
  PricingPlanValue,
  getPlanDisplayName,
} from '@kernel/domain/pricing/pricing.config';
import { planFeatureHighlights } from '../../../application/pricing/plan-features.catalog';
import { planFeatureSentence } from './planFeatures.jsonld';
import {
  PRICING_TIER_PREVIEW,
  STUDIO_PREVIEW_FEATURE_COUNT,
} from './ForStudiosPageData';

/** Offer entry: the plan name plus its card lines from the plan feature catalog. */
const offerFor = (
  messages: IntlMessages,
  locale: string,
  plan: (typeof PRICING_TIER_PREVIEW)[number]['id']
): Record<string, unknown> => {
  const name = getPlanDisplayName(PricingPlanValue[plan]);
  return {
    '@type': 'Offer',
    name,
    itemOffered: {
      '@type': 'Service',
      name: `Nailfolio ${name}`,
      description: planFeatureSentence(
        messages,
        locale,
        planFeatureHighlights(
          PricingPlanValue[plan],
          STUDIO_PREVIEW_FEATURE_COUNT
        )
      ),
    },
  };
};

export const buildStudioServiceJsonLd = (
  messages: IntlMessages,
  locale: string
): Record<string, unknown> => {
  const jsonLdKey = (leaf: string): string =>
    resolveMsgKey(messages, `seo.forStudios.jsonLd.${leaf}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${SEO_CONFIG.domain}/for-studios/#service`,
    name: jsonLdKey('serviceName'),
    serviceType: jsonLdKey('serviceType'),
    provider: { '@id': `${SEO_CONFIG.domain}/#organization` },
    description: jsonLdKey('serviceDescription'),
    areaServed: [
      { '@type': 'Country', name: 'Poland' },
      { '@type': 'Country', name: 'Germany' },
      { '@type': 'Country', name: 'Austria' },
      { '@type': 'Country', name: 'United Kingdom' },
    ],
    audience: {
      '@type': 'BusinessAudience',
      audienceType: jsonLdKey('serviceAudienceType'),
    },
    // DECISION: no prices in JSON-LD; Stripe is the only price SSOT and static prices drift
    // from real billing. hasOfferCatalog lists the plans (name + description via
    // itemOffered) with no price and no AggregateOffer.
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: jsonLdKey('catalogName'),
      // Oferty = plany z karty /for-studios, opis z katalogu cech (bez
      // własnej prozy o planach, plan §4 2026-10-14).
      itemListElement: PRICING_TIER_PREVIEW.map(tier =>
        offerFor(messages, locale, tier.id)
      ),
    },
  };
};
