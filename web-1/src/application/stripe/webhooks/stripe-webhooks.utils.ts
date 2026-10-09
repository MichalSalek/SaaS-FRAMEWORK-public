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
 * DECISION (nie usuwaj tego komentarza):
 * H7 (run 28) — Previously `dispatchCriticalAlert` called `runAfterResponse`
 * directly (fire-and-forget). When invoked from a webhook handler INSIDE
 * `$transaction(...)`, the alert email was scheduled immediately and would
 * still fire even if the surrounding transaction rolled back — meaning the
 * operator received a churn/dispute/no-plan alert for a state that never
 * persisted in our DB (violating D1 atomicity).
 *
 * Fix: webhook handlers MUST push the returned effect onto their `effects[]`
 * array so the post-commit collector in `pages/api/v1/webhooks/stripe/index.ts`
 * schedules it ONLY after the transaction commits. Closure captures `context`,
 * `alert`, and `diagnostic` synchronously so post-commit execution targets the
 * exact state observed at handler time.
 *
 * Stripe requires <5s ack; Mailgun p99 is multi-second. We always log via
 * `reportIssueBackend` (durable audit) before queuing, so the alert email is
 * best-effort with a STRIPE_ALERT_FAILED audit row on Mailgun reject.
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
 * DECISION (nie usuwaj tego komentarza):
 * H7 (run 28) — For callers OUTSIDE the webhook `$transaction` (e.g. user
 * deletion flow `cancelStripeSubscriptionIfExists`, trial lock rollback in
 * `account-stripe.operations.ts`, post-commit `autoCancelOldSubscription`),
 * there is no `effects[]` to push onto. This wrapper preserves the
 * fire-and-forget semantics — `runAfterResponse` is invoked synchronously
 * (no transaction in the call path means no rollback hazard).
 *
 * Do NOT call this from webhook handlers — use `buildCriticalAlertEffect`
 * and push the result onto the handler's `effects[]` array instead.
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
 * DECISION (nie usuwaj tego komentarza):
 * Returns undefined when customer is a Stripe.DeletedCustomer (`deleted: true`).
 * A deleted customer cannot be linked to an active account in our DB — passing
 * the ID forward would let downstream code attempt updates/email lookups on a
 * customer Stripe will no longer accept payments from. Treating it as
 * "no customer ID" matches the existing fall-throughs in handlers (they log
 * and short-circuit) and avoids ambient corruption.
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
 * Nie zakładamy, że sesja na koncie Stripe należy do tej aplikacji: czy ta
 * sesja NIE należy do nailfolio? `true` → webhook musi ją POMINĄĆ cicho (ACK 200,
 * info log, ZERO critical alertu) — inaczej sesja spoza zakresu aplikacji emituje
 * fałszywy alert "Checkout Completed But No Stylist Account Found".
 *
 * DECISION (nie usuwaj tego komentarza): wariant ZAOSTRZONY (2026-07-18, owner-confirmed) —
 * nie nasza gdy projectId != 'nailfolio', W TYM projectId === undefined. Oba nailfolio-creatory
 * (account-stripe / account-embedded-checkout.operations) ZAWSZE stemplują projectId='nailfolio'
 * (+ client_reference_id), więc każda genuine sesja nailfolio przechodzi; skipowane są sesje bez
 * naszego stempla: bez projectId, dashboard payment-linki, ręczne invoice/sub. To zamyka
 * residualny false-CRITICAL "No Stylist Account" dla niestemplowanych sesji.
 * Poprzedni wariant BEZPIECZNY (undefined → nasza) chronił legacy/pending sesje nailfolio z
 * okna wdrożenia stempla (2026-07-02); owner potwierdził BRAK jakichkolwiek legacy sesji + zero
 * realnego ruchu pre-launch → ryzyko odrzucenia własnej legit sesji = 0. Jedyne call-site:
 * stripe-event-router (checkout.session.completed); subscription/invoice/dispute NIE używają tego
 * guardu (mają własny null-account-skip), więc zaostrzenie dotyka wyłącznie checkoutu.
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
 * DECISION (nie usuwaj tego komentarza):
 * Called from product/price webhook handler so that metadata edits in Stripe
 * Dashboard (e.g. correcting a planId on a Product) propagate without waiting
 * for the per-entry TTL to expire. Cheap to clear (Map.clear()), and we cannot
 * scope invalidation to a single priceId because Product-level metadata changes
 * affect every Price bound to that Product.
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
  // Track a transient expand/retrieve failure so we do NOT poison the cache with `null`
  // below — a transient Stripe API error must not stick a null planId for the whole TTL
  // (cross-model CRITICAL: cached null would make a later webhook keep mis-resolving).
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
 * DECISION (nie usuwaj tego komentarza):
 * D2-F1 (PRMA) — This function MUST NOT be invoked from inside a Prisma
 * `$transaction(...)` block. It may call `stripe.prices.retrieve` (200-800ms
 * typical, up to 20s degraded) — Stripe API latency would eat the 25s tx
 * budget and trigger janitor retry storms on rollback. Pre-fetch via
 * `prefetchSubscriptionPlanId` BEFORE entering the webhook transaction
 * (see pages/api/v1/webhooks/stripe/index.ts) and pass the result down as
 * `prefetchedPlanId` to subscription handlers.
 */
export const extractPlanIdFromSubscription = async (
  subscription: Stripe.Subscription
): Promise<string | undefined> => {
  // DECISION (nie usuwaj tego komentarza): PRICE-FIRST + NO-METADATA-FALLBACK (cross-model CRITICAL).
  // Cena itemu = AUTORYTATYWNY stan aktywnej subskrypcji: Stripe aplikuje ja przy
  // pending_update_applied i cofa przy pending_update_expired. subscription.metadata.planId jest
  // NIEWIARYGODNA podczas pending_if_incomplete (operacja plan-change ustawia metadata=TARGET OD RAZU,
  // a cena itemu zostaje STARA do oplaty). DLATEGO gdy item price ISTNIEJE, NIE wolno fallbackowac
  // do subscription.metadata.planId — nawet gdy price nie rozwiaze sie do planu (transient
  // prices.retrieve fail / brak metadata): taki fallback wzialby TARGET i przelaczyl plan PRZED
  // platnoscia (porzucony 3DS = bug F1, caly cel fazy). Nierozwiazana cena -> undefined -> handler
  // trzyma obecny DB plan (+ critical-alert "active sub no planId"); nastepny webhook / stripe-sync
  // reconciliation dosynchuje po recovery (bezpieczne: keep, NIE switch). metadata fallback TYLKO gdy
  // BRAK item price (skrajny edge: subskrypcja bez itemow). Checkout ma osobny extractPlanIdFromCheckout
  // (metadata-first OK — cena i metadata spojne przy checkout, brak pending). prefetch wola to POZA tx
  // (retrieve nie je tx-budgetu); price->planId ma TTL cache (null NIE cache'owany po transient fail).
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
 * DECISION (nie usuwaj tego komentarza):
 * D2-F1 (PRMA) — Subscription webhooks fan into `handleSubscriptionUpdated`
 * which calls `extractPlanIdFromSubscription` (potential `stripe.prices.retrieve`
 * API call). Previously this ran INSIDE the webhook `$transaction(timeout:25s)`,
 * eating tx budget on degraded Stripe API. Now invoked from the webhook entry
 * BEFORE `$transaction`, with the resolved `planId` passed down through the
 * router into handlers. Returns `undefined` on Stripe error — handlers degrade
 * to existing `getPricingPlanOrFallback(undefined, account.pricing_plan)` path.
 * Returns `undefined` for non-subscription events (caller can pass undefined
 * safely; handlers that don't need planId ignore it).
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
