import {
  PaymentStatusValue,
  type PaymentStatus,
} from '../../models/db_models.generated.dto';
import { PricingPlanValue, type PricingPlan } from './pricing.config';

// Pricing policy — SSOT for trial-eligibility and upgrade/downgrade direction.
// Pure, framework-agnostic, FE-importable (no zod, no runtime deps). The
// frontend (AccountPayPage) and any backend guard derive the SAME decision
// from here instead of re-deriving inline.

/**
 * Canonical plan tier order, low → high. Drives upgrade/downgrade direction.
 * Matches the key order of PricingPlanValue (FREE < PRO < PRO_PLUS < STUDIO <
 * SCALE) — the single source for "which way is a downgrade".
 */
export const PLAN_TIER_ORDER: readonly PricingPlan[] = Object.freeze([
  PricingPlanValue.FREE,
  PricingPlanValue.PRO,
  PricingPlanValue.PRO_PLUS,
  PricingPlanValue.STUDIO,
  PricingPlanValue.SCALE,
]);

/**
 * Whether a stylist may start the one-time free trial.
 *
 * DECISION: a trial is available only when the account never had an active subscription
 * (payment_status UNPAID or REJECTED) AND never claimed the one-time trial (trial_started_at null).
 * PAID and IN_PROGRESS (Stripe checkout already opened) may not (re)start one. The backend guard
 * ACCOUNT_TRIAL_ALREADY_USED is the real boundary; this mirror only keeps the UI from showing a
 * dead-end CTA.
 */
export function canStartTrial(args: {
  trialStartedAt: Date | string | null | undefined;
  paymentStatus: PaymentStatus | null | undefined;
}): boolean {
  if (args.trialStartedAt != null) {
    return false;
  }
  return (
    args.paymentStatus === PaymentStatusValue.UNPAID ||
    args.paymentStatus === PaymentStatusValue.REJECTED
  );
}

export function isPlanDowngrade(
  currentPlan: PricingPlan,
  targetPlan: PricingPlan
): boolean {
  const currentIndex = PLAN_TIER_ORDER.indexOf(currentPlan);
  const targetIndex = PLAN_TIER_ORDER.indexOf(targetPlan);
  return (
    targetIndex !== -1 && currentIndex !== -1 && targetIndex < currentIndex
  );
}
