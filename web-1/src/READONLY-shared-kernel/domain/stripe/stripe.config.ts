// Stripe-specific constants shifted to shared kernel for SSOT
// These are used by both backend and potentially frontend for subscription state logic

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

/**
 * PLAN_ID_MAP — mapowanie domen → Stripe Product metadata
 *
 * Stripe Products mają generyczne ID (app-price-1..app-price-4), NIGDY nazwy domenowe.
 * Dzięki temu zmiana nazwy planu (np. "Pro" → "Premium") nie wymaga zmian w Stripe.
 * FREE nie ma Stripe Product — to default po anulowaniu/braku subskrypcji.
 *
 * Stripe Product metadata: { planId: "app-price-1" } na encji Product (nie Price).
 * Prefiks `app-price-` jest WYMAGANY — `isScopedToNailfolio` odrzuca wartości bez
 * niego.
 */
export const PLAN_ID_MAP = {
  FREE: 'free',
  PRO: 'app-price-1',
  PRO_PLUS: 'app-price-2',
  STUDIO: 'app-price-3',
  SCALE: 'app-price-4',
} as const;

export type PlanId = (typeof PLAN_ID_MAP)[keyof typeof PLAN_ID_MAP];

/**
 * SPE: prefiks Stripe Product metadata.planId dla produktów Nailfolio.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Katalog planów to WYŁĄCZNIE produkty z tym prefiksem. KAŻDE zapytanie listujące Stripe
 * MUSI scope'ować do prefiksu; wszystko inne (obiekty założone ręcznie w dashboardzie,
 * produkty zarchiwizowane) jest ignorowane.
 * Egzekwowane audytem `stripe-scope`. Ani FREE, ani SCALE NIE mają realnego Stripe
 * Product/Price (by design): FREE = zero płatności; SCALE = plan zarezerwowany
 * (enterprise/custom, NIE self-serve). `PLAN_ID_MAP.SCALE='app-price-4'` to wyłącznie
 * zarezerwowane ID (prefiks dla spójności scope), NIE dowód istnienia Productu —
 * dispatcher odrzuca FREE i SCALE upstream (patrz account-embedded-checkout), więc
 * żaden z nich nie trafia do price-resolvera mimo że typ PlanId je zawiera.
 */
// Internal (NIE eksportowany) — publicznym API scope jest `isScopedToNailfolio`.
// Prefiks literalny dokumentuje scope; audyt stripe-scope grepuje 'app-price-' w źródle.
const STRIPE_PRODUCT_PREFIX = 'app-price-' as const;

export const isScopedToNailfolio = (
  planId: string | null | undefined
): boolean =>
  typeof planId === 'string' && planId.startsWith(STRIPE_PRODUCT_PREFIX);

export const TRIAL_CONFIG = {
  DURATION_DAYS: 30,
  REMINDER_DAYS_BEFORE_END: 7,
  // SPE D6: trial wymaga karty. BLIK/P24 nie wspierają niezawodnie recurring-trialu,
  // więc flow z trialem -> metoda karta (dynamic methods nadal włączone dla płatności
  // natychmiastowych/zmian bez triala). Copy NIE obiecuje "BLIK z trialem".
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
 * Stripe Promotion Code utworzony ręcznie w Stripe Dashboard.
 * Auto-apply na annual checkout w oknie [LAUNCH_DATE, LAUNCH_DATE + WINDOW_DAYS).
 * Po wygaśnięciu okna banner znika i kupon nie jest naliczany — annual wraca
 * do standardowego -20% (saveBadge w hero).
 *
 * Cena referencyjna 30 dni (Omnibus) zachowana — bazuje na monthly price,
 * niezależna od launch offer.
 *
 * DECISION (nie usuwaj tego komentarza):
 * 2026-07-10 owner WYŁĄCZYŁ launch offer (WINDOW_DAYS=0 → okno puste → banner off,
 * checkout nie aplikuje kuponu; kupon LAUNCH30_ANNUAL USUNIĘTY ze Stripe — próba
 * aplikacji rzuciłaby błąd).
 * Infrastruktura okna zostaje (przyszłe kampanie); LAUNCH_DATE historyczny.
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
 * Uses PLAN_ID_MAP as SSOT (planId-e są generyczne price-N, nie nazwy domenowe)
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
