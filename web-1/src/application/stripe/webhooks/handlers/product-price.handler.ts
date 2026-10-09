import { reportIssueBackend } from '@app/debugger/error-handler';
import { clearPricingCache } from '@app/stripe/pricing.operations';
import { clearPriceResolverCache } from '@app/stripe/price-resolver.operations';
import { clearPlanIdCache } from '@app/stripe/webhooks/stripe-webhooks.utils';
import {
  emptyEffectsResult,
  type StripeHandlerResult,
} from '@app/stripe/webhooks/stripe-effects.types';
import { STRIPE_WEBHOOK_LOG_NAMESPACE } from '@app/stripe/stripe.config';

export const handleProductOrPriceUpdate = (): StripeHandlerResult => {
  clearPricingCache();
  // Clear price→planId cache too — Product metadata edits (changing planId on
  // a Product) would otherwise serve stale entries until per-key TTL expires.
  clearPlanIdCache();
  // Clear checkout price-resolver cache — a price rotation (archive old + add
  // new) would otherwise build subscriptions on the archived priceId until the
  // per-key TTL expires (up to 60 min), which Stripe rejects on the paid path.
  clearPriceResolverCache();

  reportIssueBackend({
    namespace: STRIPE_WEBHOOK_LOG_NAMESPACE,
    message:
      'Pricing cache + planId cache + price-resolver cache invalidated (product/price updated in Stripe)',
    payload: {},
    mode: 'info',
  });

  return emptyEffectsResult();
};
