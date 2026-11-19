// Stripe-specific constants shifted to shared kernel for SSOT
// These are used by both backend and potentially frontend for subscription state logic

/**
 * DECISION: catalog subscription amounts are gross. Polish VAT is included in
 * the displayed amount and collected on every invoice, with or without company
 * details. Revenue estimates exclude that VAT. (owner)
 */
export const SUBSCRIPTION_VAT_CONFIG = {
  PERCENTAGE: 23,
  COUNTRY: 'PL',
  INCLUSIVE: true,
} as const;

export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  TRIALING: 'trialing',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  UNPAID: 'unpaid',
  INCOMPLETE: 'incomplete',
  INCOMPLETE_EXPIRED: 'incomplete_expired',
  PAUSED: 'paused',
} as const;

// Stripe WIRE-format status union (lowercase 'active'/'trialing'/…). NOT the DB
// SubscriptionStatus (uppercase, generated dto) — distinct casing + source.
// Deliberately NOT exported: it is an implementation detail of STRIPE_ACTIVE_STATUSES
// (no external consumer; the old `export type SubscriptionStatus` collided by name
// with the generated DB enum and was only name-shadowed dead weight via `export *`).
type StripeApiSubscriptionStatus =
  (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export const STRIPE_ACTIVE_STATUSES: ReadonlyArray<StripeApiSubscriptionStatus> =
  [
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.TRIALING,
    SUBSCRIPTION_STATUS.PAST_DUE, // Allow access during retries
  ] as const;

export const isStripeSubscriptionActive = (status: unknown): boolean => {
  return (
    typeof status === 'string' &&
    (STRIPE_ACTIVE_STATUSES as readonly string[]).includes(status)
  );
};

export const PLAN_ID_MAP = {
  FREE: 'free',
  PRO: 'app-price-1',
  PRO_PLUS: 'app-price-2',
  STUDIO: 'app-price-3',
  SCALE: 'app-price-4',
} as const;

export type PlanId = (typeof PLAN_ID_MAP)[keyof typeof PLAN_ID_MAP];

/**
 * Stripe Product metadata.planId prefix for Nailfolio products.
 *
 * DECISION: the plan catalogue is ONLY products with this prefix. EVERY Stripe listing query must
 * scope to the prefix; anything else (objects created by hand in the dashboard, archived products) is
 * ignored (enforced by audit `stripe-scope`). Neither FREE nor SCALE has a real Stripe
 * Product/Price: FREE is zero payment, SCALE is a reserved custom/enterprise plan. 'app-price-4' is
 * only a reserved id, not proof a Product exists; the dispatcher rejects FREE and SCALE upstream
 * (account-embedded-checkout), so neither reaches the price resolver although PlanId includes them.
 */
// Internal (NOT exported): the public scope API is `isScopedToNailfolio`.
// The literal prefix documents the scope; the stripe-scope audit greps 'app-price-' in the source.
const STRIPE_PRODUCT_PREFIX = 'app-price-' as const;

export const isScopedToNailfolio = (
  planId: string | null | undefined
): boolean =>
  typeof planId === 'string' && planId.startsWith(STRIPE_PRODUCT_PREFIX);

export const TRIAL_CONFIG = {
  DURATION_DAYS: 14,
  REMINDER_DAYS_BEFORE_END: 7,
  // A trial requires a card. BLIK/P24 do not reliably support a recurring trial, so the trial flow
  // uses a card (dynamic methods stay on for immediate payments and changes without a trial). Copy
  // does NOT promise "BLIK with a trial".
  CARD_REQUIRED: true,
} as const;

/**
 * First paid month, 20% off, one redemption per recipient.
 *
 * `couponId` names the Stripe coupon. Senders mint a per-recipient promotion
 * code on that coupon at send time. Checkout accepts it only when the code's
 * coupon id matches `couponId`.
 */
export const EMAIL_OFFERS = {
  FIRST_MONTH: {
    couponId: '<stripe-coupon-id>',
    percentOff: 20,
    validHours: 72,
  },
} as const;

/**
 * LAUNCH_OFFER — 30% off annual subscription, 90-day window from launch date.
 *
 * Stripe Promotion Code created by hand in the Stripe Dashboard. Auto-applied on annual checkout
 * in the window [LAUNCH_DATE, LAUNCH_DATE + WINDOW_DAYS). After the window the banner disappears
 * and the coupon is not charged; annual returns to the standard -20% (saveBadge in the hero).
 *
 * The 30-day reference price (Omnibus) is based on the monthly price, independent of the offer.
 *
 * DECISION: the launch offer is switched off (WINDOW_DAYS=0 -> empty window -> banner off, no coupon at
 * checkout) and the LAUNCH30_ANNUAL coupon was deleted from Stripe, so applying it would throw. -30%
 * stacked with the -20% annual discount to -44% and undermined premium signalling. A founding coupon
 * PIERWSZE60 (19 PLN off x 12 months, max 25 uses, Pro only) is handed out manually, never
 * auto-applied. The window machinery stays for future campaigns (owner).
 */
export const LAUNCH_OFFER = {
  PROMO_CODE: 'LAUNCH30_ANNUAL',
  DISCOUNT_PERCENT: 30,
  LAUNCH_DATE: '2026-07-15',
  WINDOW_DAYS: 0,
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const getLaunchWindow = (): { start: number; end: number } => {
  const start = new Date(LAUNCH_OFFER.LAUNCH_DATE).getTime();
  return {
    start,
    end: start + LAUNCH_OFFER.WINDOW_DAYS * MS_PER_DAY,
  };
};

export const isLaunchOfferActive = (now: Date = new Date()): boolean => {
  const { start, end } = getLaunchWindow();
  const nowMs = now.getTime();
  return nowMs >= start && nowMs < end;
};

export const VALID_PAID_PLAN_IDS: ReadonlyArray<PlanId> = [
  PLAN_ID_MAP.PRO,
  PLAN_ID_MAP.PRO_PLUS,
  PLAN_ID_MAP.STUDIO,
  PLAN_ID_MAP.SCALE,
];

import type { PricingPlan } from '../pricing/pricing.config';
import { PricingPlanValue } from '../pricing/pricing.config';

/**
 * Reverse lookup: Stripe planId → PricingPlanValue key
 * e.g. "app-price-2" → "PRO_PLUS", "app-price-1" → "PRO", "free" → "FREE"
 * Uses PLAN_ID_MAP as SSOT (planIds are generic price-N, not domain names)
 */
const PLAN_ID_TO_PRICING_PLAN: Record<string, PricingPlan> = Object.fromEntries(
  Object.entries(PLAN_ID_MAP).map(([key, value]) => [value, key as PricingPlan])
) as Record<string, PricingPlan>;

export const getPricingPlanValueFromPlanId = (planId: string): PricingPlan => {
  return PLAN_ID_TO_PRICING_PLAN[planId] ?? PricingPlanValue.FREE;
};

/**
 * Convert PricingPlanValue string to planId string (Domain Enum to Stripe ID)
 * e.g. "PRO_PLUS" → "app-price-2", "FREE" → "free". PLAN_ID_MAP keys = PricingPlan
 * union (exhaustive), so the lookup is total — no fallback needed.
 */
export const getPlanIdFromPricingPlanValue = (value: PricingPlan): PlanId => {
  return PLAN_ID_MAP[value];
};
