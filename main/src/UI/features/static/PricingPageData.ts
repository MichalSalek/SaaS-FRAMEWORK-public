import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';

/*
 * Layout metadata of the /pricing cards only. WHAT a plan includes is NOT
 * here: cards and the comparison table render projections of the plan feature
 * catalog (`application/pricing/plan-features.catalog.ts`).
 */

export interface PricingTier {
  id: string;
  /**
   * Kernel plan id — the join key against `PricingPlanCard.id` (prices) and
   * `stylist_account.pricing_plan` (current plan). `id` is a lowercase DOM/key
   * slug and MUST NOT be used for plan lookups ('pro-plus' !== 'PRO_PLUS').
   */
  planId: PricingPlan;
  nameKey: string;
  taglineKey: string;
  ctaKey:
    | 'tiers.freeCta'
    | 'tiers.proCta'
    | 'tiers.proPlusCta'
    | 'tiers.studioCta'
    | 'tiers.scaleCta';
  badgeKey?: string;
  isTarget?: boolean;
  /**
   * Recommended plan (badge i18n `tierSection.popularBadge`): drives the
   * frozen-tint highlight of the column/card in the "Porównaj plany" section.
   * Separate from `isTarget` (Studio = the business target with a typographic badge).
   */
  isRecommended?: boolean;
  isContact?: boolean;
  /**
   * Card rendered in the ink band „Pakiety premium" UNDER the light pair
   * Free+Pro (owner: hybrid, a 2+2 grid, premium highlighted by a SECTION negative
   * instead of a negative on the single Pro card).
   * The pricing layout SSOT lives here, not in the component.
   */
  isPremiumBand?: boolean;
  /**
   * Note in the card BODY (under the feature list): fills the subgrid CTA-align void on
   * cards with a short list and positions the plan (Pro Marka = demanding solo, Studio = salon).
   */
  bodyNoteKey?: string;
}

export const TIERS: PricingTier[] = [
  {
    id: 'free',
    planId: PricingPlanValue.FREE,
    nameKey: 'tiers.freeName',
    taglineKey: 'tiers.freeTagline',
    ctaKey: 'tiers.freeCta',
  },
  {
    id: 'pro',
    planId: PricingPlanValue.PRO,
    nameKey: 'tiers.proName',
    taglineKey: 'tiers.proTagline',
    isRecommended: true,
    ctaKey: 'tiers.proCta',
  },
  {
    id: 'pro-plus',
    planId: PricingPlanValue.PRO_PLUS,
    nameKey: 'tiers.proPlusName',
    taglineKey: 'tiers.proPlusTagline',
    isPremiumBand: true,
    bodyNoteKey: 'tiers.proPlusDecoyNote',
    ctaKey: 'tiers.proPlusCta',
  },
  {
    id: 'studio',
    planId: PricingPlanValue.STUDIO,
    nameKey: 'tiers.studioName',
    taglineKey: 'tiers.studioTagline',
    isTarget: true,
    isPremiumBand: true,
    badgeKey: 'tiers.studioBadge',
    bodyNoteKey: 'tiers.studioBodyNote',
    ctaKey: 'tiers.studioCta',
  },
  {
    id: 'scale',
    planId: PricingPlanValue.SCALE,
    nameKey: 'tiers.scaleName',
    taglineKey: 'tiers.scaleTagline',
    isContact: true,
    ctaKey: 'tiers.scaleCta',
  },
];

/* ─── FAQ Data — keys only ─── */

export interface FaqItem {
  questionKey: string;
  answerKey: string;
}

export const PRICING_FAQ = [
  { questionKey: 'faq.q1', answerKey: 'faq.a1' },
  { questionKey: 'faq.q2', answerKey: 'faq.a2' },
  { questionKey: 'faq.q3', answerKey: 'faq.a3' },
  { questionKey: 'faq.q4', answerKey: 'faq.a4' },
  { questionKey: 'faq.q5', answerKey: 'faq.a5' },
  { questionKey: 'faq.q6', answerKey: 'faq.a6' },
  { questionKey: 'faq.q7', answerKey: 'faq.a7' },
  { questionKey: 'faq.q8', answerKey: 'faq.a8' },
  { questionKey: 'faq.q9', answerKey: 'faq.a9' },
  { questionKey: 'faq.q10', answerKey: 'faq.a10' },
] as const satisfies readonly FaqItem[];
