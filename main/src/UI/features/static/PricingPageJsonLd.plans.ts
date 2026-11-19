import { resolveDefaultOgAsset } from '../../assets/brandAssets';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { PLAN_TIER_ORDER } from '@kernel/domain/pricing/pricing-policy';
import type { IntlMessages } from '../../../types/i18n';
import { resolveMsgKey } from '../../../application/i18n/resolve-msg-key';
import { resolvePlanFeatures } from '../../../application/pricing/plan-features.catalog';
import { planFeatureSentence } from './planFeatures.jsonld';

/* ─── Shared constants (pricing data SSOT, see PRICING_PACKAGING.md §4) ─── */

const BRAND_REF = { '@type': 'Organization', name: 'Nailfolio' } as const;

// DECISION: plan entities carry no `offers` or prices: Stripe is the only price SSOT
// (see main/src/UI/components/JsonLd/freePlanOffer.ts). Their `@type` is Service, not
// Product: Google validates every Product for "Product snippets" and requires offers,
// review or aggregateRating, which a price-less entity cannot satisfy, and attaching the
// app-wide aggregateRating to each plan would be misleading markup. A SaaS plan is a
// service and stays a valid `Offer.itemOffered`. Same pattern as
// ForStudiosPageJsonLd.service.ts; do not switch back to Product while prices stay out.

/* ─── Service schemas per plan (5 plans, price-less — Stripe is SSOT) ─── */

const PLAN_MSG_PREFIX: Record<PricingPlan, string> = {
  FREE: 'free',
  PRO: 'pro',
  PRO_PLUS: 'proPlus',
  STUDIO: 'studio',
  SCALE: 'scale',
};

const PLAN_META = PLAN_TIER_ORDER.map(planId => ({
  planId,
  idFragment: `plan-${planId.toLowerCase().replace(/_/g, '-')}`,
  name: `Nailfolio ${getPlanDisplayName(planId)}`,
  msgPrefix: PLAN_MSG_PREFIX[planId],
}));

export function buildPricingPlansJsonLd(
  messages: IntlMessages,
  locale: string | undefined = 'pl'
): Array<Record<string, unknown>> {
  return PLAN_META.map(plan => ({
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${SEO_CONFIG.domain}/pricing/#${plan.idFragment}`,
    name: plan.name,
    description: planFeatureSentence(
      messages,
      locale,
      resolvePlanFeatures(plan.planId)
    ),
    image: `${SEO_CONFIG.domain}${resolveDefaultOgAsset(locale)}`,
    brand: BRAND_REF,
    provider: { '@id': `${SEO_CONFIG.domain}/#organization` },
    category: 'SaaS Subscription',
    audience: {
      '@type': 'BusinessAudience',
      audienceType: resolveMsgKey(
        messages,
        `seo.pricing.jsonLd.${plan.msgPrefix}Audience`
      ),
    },
  }));
}
