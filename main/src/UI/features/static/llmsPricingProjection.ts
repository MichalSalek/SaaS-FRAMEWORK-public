import { getPlanDisplayName } from '@kernel/domain/pricing/pricing.config';
import { PLAN_TIER_ORDER } from '@kernel/domain/pricing/pricing-policy';
import { resolvePlanFeatures } from '../../../application/pricing/plan-features.catalog';
import type { IntlMessages } from '../../../types/i18n';
import { formatPlanFeatureLines } from './planFeatures.jsonld';

/** Full feature-list projection used by the visible plan cards and LLM mirrors. */
export function renderLlmPricingSection(
  messages: IntlMessages,
  locale: string,
  livePricesHref: string
): string[] {
  const rows: string[] = [];
  for (const plan of PLAN_TIER_ORDER) {
    rows.push(`### ${getPlanDisplayName(plan)}`);
    rows.push(
      ...formatPlanFeatureLines(
        messages,
        locale,
        resolvePlanFeatures(plan)
      ).map(line => `- ${line}`)
    );
  }

  const pricingHeading = messages.static.pricing.tiers.headline;
  if (typeof pricingHeading !== 'string' || pricingHeading.trim() === '') {
    throw new Error(`Missing static.pricing.tiers.headline for ${locale}`);
  }
  rows.push(`[${pricingHeading}](${livePricesHref})`);
  return rows;
}
