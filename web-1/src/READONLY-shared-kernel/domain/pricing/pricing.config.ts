import type { ValueOf } from '../../application/application.utils';

export const PricingPlanValue = Object.freeze({
  FREE: 'FREE',
  PRO: 'PRO',
  PRO_PLUS: 'PRO_PLUS',
  STUDIO: 'STUDIO',
  SCALE: 'SCALE',
} as const);
export type PricingPlan = ValueOf<typeof PricingPlanValue>;

// Note: Pricing is managed by Stripe (Customer Portal / Pricing Table)
// This config only defines plan tiers, not prices or billing intervals
// Billing interval (monthly vs annual) is managed entirely by Stripe

/**
 * Customer-facing plan display names (SSOT).
 *
 * Raw enum values (PRO_PLUS) must NEVER reach user-facing surfaces
 * (emails, UI copy) — use getPlanDisplayName instead of String(plan).
 * Names match the pricing UI (usePricingPlans.ts) and are brand names,
 * not translatable copy — identical across pl/en/de.
 */
export const PLAN_DISPLAY_NAMES: Record<PricingPlan, string> = Object.freeze({
  FREE: 'Free',
  PRO: 'Pro',
  PRO_PLUS: 'Pro Marka',
  STUDIO: 'Studio',
  SCALE: 'Scale',
});

export const getPlanDisplayName = (plan: PricingPlan): string =>
  PLAN_DISPLAY_NAMES[plan];
