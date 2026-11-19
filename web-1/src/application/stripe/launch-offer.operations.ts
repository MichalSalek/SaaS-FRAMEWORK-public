import type Stripe from 'stripe';
import { createCache } from '@app/cache/cache.utils';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { getStripe } from './adapters/stripe.adapter';
import { LAUNCH_OFFER, isLaunchOfferActive } from './stripe.config';

const LAUNCH_PROMO_CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY = 'launch-offer-promotion-code-id';

// Wrapper object so a cached "definitively not found" (id: null) is
// distinguishable from a cache miss (get() → null).
const promoIdCache = createCache<{ id: string | null }>(
  LAUNCH_PROMO_CACHE_TTL_MS
);

const resolveLaunchOfferPromotionCodeId = async (): Promise<string | null> => {
  const cached = promoIdCache.get(CACHE_KEY);
  if (cached !== null) {
    return cached.id;
  }

  let promotionCodes: Stripe.ApiList<Stripe.PromotionCode>;
  try {
    promotionCodes = await getStripe().promotionCodes.list({
      code: LAUNCH_OFFER.PROMO_CODE,
      active: true,
      limit: 1,
    });
  } catch (error) {
    // Transient failure → fail-open WITHOUT caching (next checkout retries).
    reportIssueBackend({
      namespace: 'STRIPE_LAUNCH_OFFER',
      message:
        'Launch offer promotion-code lookup failed — annual checkout proceeds WITHOUT the advertised discount',
      payload: {
        promoCode: LAUNCH_OFFER.PROMO_CODE,
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'error',
    });
    return null;
  }

  const promotionCode = promotionCodes.data[0];
  if (!promotionCode) {
    // Definitive not-found/inactive → cache null (TTL heals after owner fixes
    // the Dashboard) and alert: the pricing page PROMISES -30% in the window.
    promoIdCache.set(CACHE_KEY, { id: null });
    reportIssueBackend({
      namespace: 'STRIPE_LAUNCH_OFFER',
      message:
        'CRITICAL: launch offer promotion code missing or inactive on Stripe — advertised -30% annual discount is NOT being applied',
      payload: { promoCode: LAUNCH_OFFER.PROMO_CODE },
      mode: 'error',
    });
    return null;
  }

  promoIdCache.set(CACHE_KEY, { id: promotionCode.id });
  return promotionCode.id;
};

/**
 * Single gate + lookup for the launch-offer checkout discount (SSOT for both
 * the embedded and the hosted-fallback checkout creators).
 *
 * Returns the ready-to-splice `discounts` entry when the offer applies
 * (annual billing INSIDE the launch window and the promo code resolves),
 * otherwise null (monthly, window closed, or fail-open on lookup problems).
 */
export const getLaunchOfferCheckoutDiscount = async ({
  billingPeriod,
}: {
  billingPeriod: BillingPeriod;
}): Promise<Stripe.Checkout.SessionCreateParams.Discount | null> => {
  if (billingPeriod !== 'year' || !isLaunchOfferActive()) {
    return null;
  }
  const promotionCodeId = await resolveLaunchOfferPromotionCodeId();
  if (promotionCodeId === null) {
    return null;
  }
  return { promotion_code: promotionCodeId };
};

/** Test seam + parity with clearPriceResolverCache / clearPlanIdCache. */
export const clearLaunchOfferPromoCache = (): void => {
  promoIdCache.clear();
};
