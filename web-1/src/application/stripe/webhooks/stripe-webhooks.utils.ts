import type Stripe from 'stripe';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  getPricingPlanValueFromPlanId,
  getValidPlanIds,
  UNKNOWN_PLAN_ID,
} from '@app/stripe/stripe.config';
import type { CheckoutMetadata } from '@app/stripe/stripe.types';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { sendCriticalBusinessAlert } from '@app/email-handler/email.operations';
import type { CriticalBusinessAlertParams } from '@app/email-handler/email.types';
import { runAfterResponse } from '@app/runtime/run-after-response';
import type { StripeWebhookEffect } from './stripe-effects.types';

/**
 * Build a critical business alert effect to be scheduled AFTER the webhook
 * transaction commits.
 *
 * DECISION: webhook handlers MUST push the returned effect onto their `effects[]` array so the
 * post-commit collector in `pages/api/v1/webhooks/stripe/index.ts` schedules it ONLY after the
 * transaction commits (see stripe-effects.types.ts). Calling `runAfterResponse` directly inside
 * `$transaction(...)` would fire the alert even when the tx rolls back (an alert for a state that
 * never persisted). The closure captures `context`, `alert` and `diagnostic` synchronously, so
 * post-commit execution targets the state observed at handler time. Stripe requires <5s ack and
 * Mailgun p99 is multi-second, so we always log via `reportIssueBackend` (durable audit) before
 * queuing; the alert email is best-effort with a STRIPE_ALERT_FAILED audit row on reject.
 */
export const buildCriticalAlertEffect = ({
  context,
  alert,
  diagnostic,
}: {
  context: string;
  alert: CriticalBusinessAlertParams;
  diagnostic?: Record<string, unknown>;
}): StripeWebhookEffect => {
  return async () => {
    try {
      await sendCriticalBusinessAlert(alert);
    } catch (err) {
      reportIssueBackend({
        namespace: 'STRIPE_ALERT_FAILED',
        message: 'Critical business alert send failed',
        payload: { context, error: String(err), ...(diagnostic ?? {}) },
        mode: 'error',
      });
    }
  };
};

/**
 * Fire critical business alert immediately AFTER the response is sent.
 *
 * DECISION: for callers OUTSIDE the webhook `$transaction` (user deletion flow
 * `cancelStripeSubscriptionIfExists`, trial lock rollback in `account-stripe.operations.ts`,
 * post-commit `autoCancelOldSubscription`) there is no `effects[]` to push onto, so this wrapper
 * keeps fire-and-forget semantics (no transaction in the call path, no rollback hazard).
 *
 * Do NOT call this from webhook handlers; use `buildCriticalAlertEffect` and push the result onto
 * the handler's `effects[]` instead.
 */
export const dispatchCriticalAlert = ({
  context,
  alert,
  diagnostic,
}: {
  context: string;
  alert: CriticalBusinessAlertParams;
  diagnostic?: Record<string, unknown>;
}): void => {
  runAfterResponse(
    buildCriticalAlertEffect({
      context,
      alert,
      ...(diagnostic !== undefined ? { diagnostic } : {}),
    })
  );
};

/**
 * Validate Stripe planId from metadata.
 * Returns null instead of throwing — safe for webhook handlers.
 */
export const validatePlanId = ({
  planId,
}: {
  planId: string | undefined;
}): string | null => {
  if (!planId) {
    return null;
  }

  const validPlanIds = getValidPlanIds();
  const isValidPlanId = validPlanIds.includes(planId);

  if (!isValidPlanId) {
    reportIssueBackend({
      namespace: 'STRIPE_METADATA_VALIDATION',
      message: 'CRITICAL: Invalid planId in metadata',
      payload: { receivedPlanId: planId, validPlanIds },
      mode: 'error',
    });
    return null;
  }

  return planId;
};

/**
 * Extract customer ID from Stripe customer object or string.
 *
 * DECISION: returns undefined when the customer is a Stripe.DeletedCustomer (`deleted: true`). A
 * deleted customer cannot be linked to an active account, and passing the ID forward would let
 * downstream code attempt updates/email lookups on a customer Stripe no longer accepts payments
 * from. This matches the handlers' existing "no customer ID" fall-throughs (log and short-circuit).
 */
export const extractCustomerId = ({
  customer,
}: {
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null;
}): string | undefined => {
  if (customer == null) {
    return undefined;
  }
  if (typeof customer === 'string') {
    return customer;
  }
  if ('deleted' in customer && customer.deleted) {
    return undefined;
  }
  return customer.id;
};

/**
 * Extract subscription ID from Stripe subscription object or string
 */
export const extractSubscriptionId = ({
  subscription,
}: {
  subscription: string | Stripe.Subscription | null;
}): string | undefined => {
  if (subscription == null) {
    return undefined;
  }
  return typeof subscription === 'string' ? subscription : subscription.id;
};

/**
 * Parse checkout session metadata
 */
export const parseCheckoutMetadata = ({
  metadata,
}: {
  metadata: Stripe.Metadata | null;
}): CheckoutMetadata => {
  if (!metadata) {
    return {};
  }
  // exactOptionalPropertyTypes: only attach keys that are actually present so
  // optional props stay "absent" rather than explicitly `undefined`.
  return {
    ...(metadata.planId !== undefined ? { planId: metadata.planId } : {}),
    ...(metadata.userEmail !== undefined
      ? { userEmail: metadata.userEmail }
      : {}),
    ...(metadata.projectId !== undefined
      ? { projectId: metadata.projectId }
      : {}),
  };
};

/**
 * We do not assume every session on the Stripe account belongs to this application: does this
 * session NOT belong to nailfolio? `true` means the webhook must SKIP it silently (ACK 200, info log,
 * ZERO critical alert), or an out-of-scope session would emit a false "Checkout Completed But No
 * Stylist Account Found".
 *
 * DECISION: STRICT variant: out of scope when projectId != 'nailfolio', INCLUDING projectId ===
 * undefined. Both nailfolio checkout creators (account-stripe / account-embedded-checkout
 * operations) ALWAYS stamp projectId='nailfolio' (+ client_reference_id), so every genuine
 * nailfolio session passes; skipped are sessions without our stamp (no projectId, dashboard
 * payment links, manual invoices/subs). There are no legacy unstamped nailfolio sessions (owner
 * confirmed 2026-07-18). Only call site: stripe-event-router (checkout.session.completed);
 * subscription/invoice/dispute have their own null-account skip, so the strictness affects
 * the strictness affects checkout only. (owner)
 */
export const isOutOfScopeSession = (
  metadata: Stripe.Metadata | null
): boolean => {
  const { projectId } = parseCheckoutMetadata({ metadata });
  return projectId !== STRIPE_PROJECT_ID;
};

// In-memory price→planId cache. Reduces Stripe API calls when multiple
// webhooks (or repeated extractions within a single webhook) hit the same price.
// Bounded (FIFO eviction) and TTL'd to avoid serving stale planId after a
// Product/Price metadata change in Stripe Dashboard.
const PLAN_ID_CACHE_TTL_MS = 5 * 60 * 1000;
const PLAN_ID_CACHE_MAX = 500;
type CacheEntry = { value: string | null; expiresAt: number };
const planIdCache = new Map<string, CacheEntry>();

const cacheGetPlanId = (priceId: string): string | null | undefined => {
  const entry = planIdCache.get(priceId);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt < Date.now()) {
    planIdCache.delete(priceId);
    return undefined;
  }
  return entry.value;
};

const cacheSetPlanId = (priceId: string, value: string | null): void => {
  if (planIdCache.size >= PLAN_ID_CACHE_MAX) {
    const firstKey = planIdCache.keys().next().value;
    if (firstKey !== undefined) {
      planIdCache.delete(firstKey);
    }
  }
  planIdCache.set(priceId, {
    value,
    expiresAt: Date.now() + PLAN_ID_CACHE_TTL_MS,
  });
};

/**
 * Drop all cached price→planId mappings.
 *
 * DECISION: called from the product/price webhook handler so that metadata edits in the Stripe
 * Dashboard (e.g. correcting a planId on a Product) propagate without waiting for the per-entry
 * TTL. Cheap to clear (Map.clear()), and invalidation cannot be scoped to a single priceId
 * because Product-level metadata changes affect every Price bound to that Product.
 */
export const clearPlanIdCache = (): void => {
  planIdCache.clear();
};

/**
 * SSOT: Extracts planId from a Stripe Price object.
 *
 * Extraction order (Product-first approach):
 * 1. price.product.metadata.planId (PRIORITY - Product is stable)
 * 2. price.metadata.planId (fallback for legacy prices)
 * 3. Fetch from Stripe API if price not expanded
 *
 * Rationale: Product metadata is more stable than Price metadata.
 * Products rarely change, but Prices can be archived/replaced.
 *
 * @param price - Stripe Price object or price ID string
 * @returns planId string or null if not found
 */
const extractPlanIdFromPrice = async ({
  price,
}: {
  price: Stripe.Price | string;
}): Promise<string | null> => {
  const priceIdKey = typeof price === 'string' ? price : price.id;
  const cached = cacheGetPlanId(priceIdKey);
  if (cached !== undefined) {
    return cached;
  }
  const stripe = getStripe();

  // If price is a string ID, fetch it from Stripe
  let priceObject: Stripe.Price;

  let expandFailed = false;
  if (typeof price === 'string') {
    try {
      priceObject = await stripe.prices.retrieve(price, {
        expand: ['product'],
      });

      reportIssueBackend({
        namespace: 'STRIPE_PLANID_EXTRACTION',
        message: 'Fetched price from Stripe API (was not expanded)',
        payload: { priceId: price },
        mode: 'info',
      });
    } catch (error) {
      reportIssueBackend({
        namespace: 'STRIPE_PLANID_EXTRACTION_ERROR',
        message: 'Failed to fetch price from Stripe API',
        payload: { priceId: price, error },
        mode: 'error',
      });
      return null;
    }
  } else {
    priceObject = price;

    // Webhook payloads deliver price.product as a string ID (not expanded).
    // Re-fetch with expand so product-metadata extraction works.
    if (typeof priceObject.product === 'string') {
      try {
        priceObject = await stripe.prices.retrieve(priceObject.id, {
          expand: ['product'],
        });
      } catch (error) {
        expandFailed = true;
        reportIssueBackend({
          namespace: 'STRIPE_PLANID_EXTRACTION_ERROR',
          message: 'Failed to expand product on pre-fetched price',
          payload: { priceId: priceObject.id, error },
          mode: 'error',
        });
      }
    }
  }

  // 1. Try Product metadata (PRIORITY)
  if (priceObject.product != null && typeof priceObject.product !== 'string') {
    const product = priceObject.product as Stripe.Product;
    const planIdFromProduct = product.metadata?.planId;

    if (planIdFromProduct) {
      reportIssueBackend({
        namespace: 'STRIPE_PLANID_EXTRACTION',
        message: 'PlanId extracted from Product metadata (priority source)',
        payload: {
          priceId: priceObject.id,
          productId: product.id,
          planId: planIdFromProduct,
        },
        mode: 'info',
      });
      cacheSetPlanId(priceIdKey, planIdFromProduct);
      return planIdFromProduct;
    }
  }

  // 2. Try Price metadata (fallback)
  const planIdFromPrice = priceObject.metadata?.planId;
  if (planIdFromPrice) {
    reportIssueBackend({
      namespace: 'STRIPE_PLANID_EXTRACTION',
      message: 'PlanId extracted from Price metadata (fallback)',
      payload: { priceId: priceObject.id, planId: planIdFromPrice },
      mode: 'info',
    });
    cacheSetPlanId(priceIdKey, planIdFromPrice);
    return planIdFromPrice;
  }

  // No planId found in either product or price metadata
  reportIssueBackend({
    namespace: 'STRIPE_PLANID_EXTRACTION_FAILED',
    message: 'Could not extract planId from Price or Product',
    payload: {
      priceId: priceObject.id,
      productId:
        typeof priceObject.product === 'string'
          ? priceObject.product
          : priceObject.product?.id,
    },
    mode: 'warn',
  });

  // Cache a definitive null ONLY when metadata is genuinely absent after a SUCCESSFUL expand.
  // After a transient expand failure we skip caching so a later webhook re-resolves the price.
  if (!expandFailed) {
    cacheSetPlanId(priceIdKey, null);
  }
  return null;
};

/**
 * Refactored: Extract planId from Stripe subscription.
 * Now uses SSOT extractPlanIdFromPrice.
 *
 * DECISION: this function MUST NOT be invoked from inside a Prisma `$transaction(...)` block. It
 * may call `stripe.prices.retrieve` (200-800ms typical, up to 20s degraded), which would eat the
 * 25s tx budget and trigger janitor retry storms on rollback. Pre-fetch via
 * `prefetchSubscriptionPlanId` BEFORE entering the webhook transaction (see
 * pages/api/v1/webhooks/stripe/index.ts) and pass the result down as `prefetchedPlanId`.
 */
export const extractPlanIdFromSubscription = async (
  subscription: Stripe.Subscription
): Promise<string | undefined> => {
  // DECISION: PRICE-FIRST, NO METADATA FALLBACK. The item price is the AUTHORITATIVE state of an
  // active subscription: Stripe applies it on pending_update_applied and reverts it on
  // pending_update_expired. subscription.metadata.planId is UNRELIABLE during
  // pending_if_incomplete (the plan-change operation sets metadata=TARGET at once while the item
  // price stays OLD until payment). So when an item price EXISTS we must not fall back to
  // subscription.metadata.planId, even when the price does not resolve to a plan (transient
  // prices.retrieve failure / no metadata): that fallback would take the TARGET and switch the
  // plan BEFORE payment (an abandoned 3DS). An unresolved price returns undefined, the handler
  // keeps the current DB plan (+ critical alert "active sub no planId") and the next webhook /
  // stripe-sync reconciles after recovery (keep, never switch). The metadata fallback applies
  // ONLY when there is no item price (subscription without items). Checkout has its own
  // extractPlanIdFromCheckout (metadata-first is fine there: price and metadata agree, no
  // pending update). Prefetch calls this OUTSIDE the tx; price->planId has a TTL cache (a null is
  // not cached after a transient failure).
  const subscriptionPrice = subscription.items.data[0]?.price;
  if (subscriptionPrice != null) {
    const extracted = await extractPlanIdFromPrice({
      price: subscriptionPrice,
    });
    return extracted ?? undefined;
  }

  return subscription.metadata?.planId ?? undefined;
};

/**
 * Pre-fetch planId for subscription-bearing Stripe webhook events.
 *
 * DECISION: subscription webhooks fan into `handleSubscriptionUpdated`, which calls
 * `extractPlanIdFromSubscription` (a potential `stripe.prices.retrieve`). That ran INSIDE the
 * webhook `$transaction(timeout:25s)`, eating the tx budget on a degraded Stripe API, so it is
 * now invoked from the webhook entry BEFORE `$transaction` and the resolved `planId` is passed
 * down through the router. Returns `undefined` on Stripe error (handlers degrade to
 * `getPricingPlanOrFallback(undefined, account.pricing_plan)`) and for non-subscription events.
 */
export const prefetchSubscriptionPlanId = async (
  subscription: Stripe.Subscription
): Promise<string | undefined> => {
  try {
    return await extractPlanIdFromSubscription(subscription);
  } catch (error) {
    reportIssueBackend({
      namespace: 'STRIPE_WEBHOOK_PREFETCH_FAILED',
      message:
        'Pre-fetch of subscription planId failed — handler will fall back to current DB plan',
      payload: { subscriptionId: subscription.id, error: String(error) },
      mode: 'warn',
    });
    return undefined;
  }
};

/**
 * Refactored: Extract planId from checkout session.
 * Now uses SSOT extractPlanIdFromPrice.
 */
export const extractPlanIdFromCheckout = async (
  session: Stripe.Checkout.Session,
  metadata: CheckoutMetadata
): Promise<string | undefined> => {
  let planId: string | undefined = metadata.planId ?? undefined;

  if (!planId) {
    const price = session.line_items?.data?.[0]?.price;
    if (price) {
      const extracted = await extractPlanIdFromPrice({ price });
      planId = extracted ?? undefined;
    }
  }

  return planId;
};

/**
 * Get pricing plan value from planId with fallback
 */
export const getPricingPlanOrFallback = (
  planId: string | undefined,
  fallback: PricingPlan
): PricingPlan => {
  return planId && planId !== UNKNOWN_PLAN_ID
    ? getPricingPlanValueFromPlanId(planId)
    : fallback;
};
