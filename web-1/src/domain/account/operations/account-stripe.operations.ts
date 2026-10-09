import type Stripe from 'stripe';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AccountStripeError,
  CheckoutPlanNotFoundError,
  CheckoutPriceResolveError,
  CheckoutFreePlanConflictError,
} from '@kernel/domain/user-and-account/account-errors.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import type {
  BillingPeriod,
  CheckoutSessionResponse,
} from '@kernel/domain/user-and-account/account-checkout.types';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { canStartTrial } from '@kernel/domain/pricing/pricing-policy';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { getOrCreateStripeCustomer } from '@app/stripe/customer.operations';
import { getOrCreateVatTaxRate } from '@app/stripe/vat-tax-rate.operations';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';
import { resolveCheckoutPrice_IO } from '@app/stripe/price-resolver.operations';
import { resolveCheckoutDiscounts_IO } from '@app/stripe/checkout-discount.operations';
import { ENV_VARS } from '@app/environment/environment.config';
import { buildCheckoutReturnUrl } from '@app/stripe/checkout-return-url';
import {
  getPlanIdFromPricingPlanValue,
  TRIAL_CONFIG,
} from '@app/stripe/stripe.config';
import { getFeatureFlags } from '@app/feature-flags/feature-flags.cache';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { createEmbeddedCheckoutSession_IO } from './account-embedded-checkout.operations';
import { selectFreePlan_IO } from './account-free-selection.operations';

/** Union of every error any checkout dispatch branch can surface. */
type CheckoutDispatchError =
  | AccountNotFoundError
  | CheckoutPlanNotFoundError
  | CheckoutPriceResolveError
  | CheckoutFreePlanConflictError
  | AccountStripeError
  | DatabaseError;

/**
 * SPE — utwórz hosted Stripe Checkout Session (fallback za flagą).
 *
 * Kontrolowany redirect na hosted Checkout — używany gdy embedded jest wyłączony
 * (flaga) lub w awarii. Trial dołączany wg kernel SSOT `canStartTrial`
 * (trial nigdy nie zużyty + payment_status UNPAID/REJECTED).
 * Return na `/app?checkout=done`.
 */
const createHostedFallbackSession_IO = async ({
  userId,
  planId,
  billingPeriod,
  source,
  promo,
}: {
  userId: string;
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  source?: string;
  promo?: string;
}): Promise<
  OperationResult<
    { url: string; checkoutSessionId: string; promoRejected?: boolean },
    | AccountNotFoundError
    | CheckoutPlanNotFoundError
    | CheckoutPriceResolveError
    | AccountStripeError
    | DatabaseError
  >
> => {
  let user;
  try {
    user = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        stylist_account: {
          select: {
            account_id: true,
            trial_started_at: true,
            payment_status: true,
          },
        },
      },
    });
  } catch (error) {
    return databaseFailure('createHostedFallbackSession:fetchUser', error);
  }

  if (!user?.stylist_account) {
    return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: userId });
  }
  const accountId = user.stylist_account.account_id;

  const priceResult = await resolveCheckoutPrice_IO({ planId, billingPeriod });
  if (!priceResult.success) {
    return failure(priceResult.error);
  }
  const { priceId } = priceResult.data;

  // Trial eligibility — kernel SSOT (pricing-policy.canStartTrial), parity with
  // the embedded creator: never-claimed trial AND payment_status UNPAID/REJECTED.
  const trialEligible = canStartTrial({
    trialStartedAt: user.stylist_account.trial_started_at,
    paymentStatus: user.stylist_account.payment_status,
  });
  const stripePlanId = getPlanIdFromPricingPlanValue(planId);

  let stripeCustomerId: string;
  try {
    stripeCustomerId = await getOrCreateStripeCustomer({
      userEmail: user.email,
      accountId,
    });
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createHostedFallbackSession',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  // DECISION (nie usuwaj tego komentarza):
  // VAT 23% dotyczy KAŻDEJ płatności (ceny netto, owner) — parytet z embedded creatorem.
  // default_tax_rates na subskrypcji → Stripe kopiuje stawkę na każdą fakturę cykliczną.
  let vatTaxRateId: string;
  try {
    vatTaxRateId = await getOrCreateVatTaxRate();
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createHostedFallbackSession',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  const subscriptionMetadata: Record<string, string> = {
    planId: stripePlanId,
    accountId: accountId.toString(),
    billingPeriod,
    // Stempel projektu → webhook router przetwarza tylko sesje z naszym
    // stemplem (patrz STRIPE_PROJECT_ID).
    projectId: STRIPE_PROJECT_ID,
  };

  const checkoutParams: Stripe.Checkout.SessionCreateParams = {
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      ...(trialEligible && { trial_period_days: TRIAL_CONFIG.DURATION_DAYS }),
      // VAT 23% na subskrypcji → propagowany na każdą fakturę cykliczną (SDK).
      default_tax_rates: [vatTaxRateId],
      metadata: subscriptionMetadata,
    },
    metadata: {
      planId: stripePlanId,
      accountId: accountId.toString(),
      billingPeriod,
      projectId: STRIPE_PROJECT_ID,
      ...(source !== undefined && { source }),
    },
    // Ten sam adres powrotu co embedded (polling webhooka + onboarding_completed);
    // `/app?checkout=done` omijał bramkę potwierdzenia — patrz checkout-return-url.ts.
    success_url: buildCheckoutReturnUrl({ planId, billingPeriod, source }),
    cancel_url: `${ENV_VARS.PUBLIC_URL}/app`,
    client_reference_id: user.id.toString(),
  };

  const discount = await resolveCheckoutDiscounts_IO({
    billingPeriod,
    promo,
    stripeCustomerId,
    trialEligible,
  });
  if (discount.discounts) {
    checkoutParams.discounts = discount.discounts;
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await getStripe().checkout.sessions.create(checkoutParams);
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createHostedFallbackSession',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  if (session.url === null) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createHostedFallbackSession',
      stripeError: 'Hosted checkout session returned null url',
    });
  }

  // NOTE (2026-07-10): optimistic `plan_selected_at` marker REMOVED here too (see
  // embedded op) — it made abandoned paid checkouts look like resolved FREE plans.

  return success({
    url: session.url,
    checkoutSessionId: session.id,
    ...(discount.promoRejected ? { promoRejected: true as const } : {}),
  });
};

/**
 * SPE — dispatcher wyboru planu (D9). Zwraca discriminated union po `mode`.
 *
 *  - FREE  -> selectFreePlan_IO (zero Stripe) -> { mode:'free_selected' }
 *  - SCALE -> CheckoutPlanNotFoundError (custom/contact, brak self-serve checkout)
 *  - paid  -> embedded (flaga ON, default) / hosted_fallback (embedded OFF & hosted ON)
 *
 * DECISION (nie usuwaj tego komentarza):
 * Oba flagi OFF -> embedded jako bezpieczny default (cały sens SPE = native feel).
 * Hosted to świadomy opt-in za flagą, nie ślepy fallback przy braku konfiguracji.
 */
export const createCheckoutSession_IO = async ({
  userId,
  planId,
  billingPeriod,
  source,
  promo,
}: {
  userId: string;
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  source?: string;
  promo?: string;
}): Promise<
  OperationResult<CheckoutSessionResponse, CheckoutDispatchError>
> => {
  if (planId === PricingPlanValue.FREE) {
    const freeResult = await selectFreePlan_IO({ userId });
    if (!freeResult.success) {
      return failure(freeResult.error);
    }
    return success({ mode: 'free_selected' });
  }

  if (planId === PricingPlanValue.SCALE) {
    // SCALE = custom/contact tier — no self-serve Stripe checkout.
    return failure({ type: 'CHECKOUT_PLAN_NOT_FOUND', planId });
  }

  const flags = await getFeatureFlags();
  const embeddedEnabled =
    flags.get(FEATURE_FLAG_KEYS.STRIPE_EMBEDDED_CHECKOUT_ENABLED) ?? true;
  const hostedEnabled =
    flags.get(FEATURE_FLAG_KEYS.STRIPE_HOSTED_FALLBACK_ENABLED) ?? false;

  // Hosted only when embedded explicitly OFF and hosted explicitly ON. Every
  // other combination (incl. both OFF) defaults to embedded.
  if (!embeddedEnabled && hostedEnabled) {
    const hostedResult = await createHostedFallbackSession_IO({
      userId,
      planId,
      billingPeriod,
      ...(source !== undefined && { source }),
      ...(promo !== undefined && { promo }),
    });
    if (!hostedResult.success) {
      return failure(hostedResult.error);
    }
    return success({
      mode: 'hosted_fallback',
      url: hostedResult.data.url,
      checkoutSessionId: hostedResult.data.checkoutSessionId,
      ...(hostedResult.data.promoRejected
        ? { promoRejected: true as const }
        : {}),
    });
  }

  const embeddedResult = await createEmbeddedCheckoutSession_IO({
    userId,
    planId,
    billingPeriod,
    ...(source !== undefined && { source }),
    ...(promo !== undefined && { promo }),
  });
  if (!embeddedResult.success) {
    return failure(embeddedResult.error);
  }
  return success({
    mode: 'checkout_elements',
    clientSecret: embeddedResult.data.clientSecret,
    checkoutSessionId: embeddedResult.data.checkoutSessionId,
    returnUrl: embeddedResult.data.returnUrl,
    ...(embeddedResult.data.promoRejected
      ? { promoRejected: true as const }
      : {}),
  });
};

// createTrialCheckoutSession_IO USUNIETY (2026-07-09): byl cienkim shimem legacy
// `account/start-trial` (jedyny caller), ktory dispatchowal do Stripe i zwracal
// by-design 500 dla embedded-mode. Route zostal w CALOSCI usuniety (kernel event +
// routing + http-method + DTO + role-permission + smoke + handler), wiec ta operacja
// tez znikla jako martwy kod. Aktywna sciezka checkoutu = createCheckoutSession_IO
// (SPE dispatcher powyzej).

export const createBillingPortalSession_IO = async ({
  userId,
}: {
  userId: string;
}): Promise<
  OperationResult<
    { portalUrl: string; portalSessionId: string },
    AccountNotFoundError | AccountStripeError | DatabaseError
  >
> => {
  let user;
  try {
    user = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: {
        // No user.id here — billing-portal uses only email + account_id (unlike the
        // hosted/embedded creators, which need user.id.toString() for client_reference_id).
        email: true,
        stylist_account: {
          select: { account_id: true },
        },
      },
    });
  } catch (error) {
    return databaseFailure('createBillingPortalSession:fetchUser', error);
  }

  if (!user?.stylist_account) {
    return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: userId });
  }

  let stripeCustomerId: string;
  try {
    stripeCustomerId = await getOrCreateStripeCustomer({
      userEmail: user.email,
      accountId: user.stylist_account.account_id,
    });
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createBillingPortalSession',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  const portalSessionParams = {
    customer: stripeCustomerId,
    return_url:
      ENV_VARS.STRIPE_PORTAL_RETURN_URL || `${ENV_VARS.PUBLIC_URL}/app`,
    ...(ENV_VARS.STRIPE_PORTAL_CONFIGURATION_ID && {
      configuration: ENV_VARS.STRIPE_PORTAL_CONFIGURATION_ID,
    }),
  } satisfies Stripe.BillingPortal.SessionCreateParams;

  let portalSession: Stripe.BillingPortal.Session;
  try {
    portalSession =
      await getStripe().billingPortal.sessions.create(portalSessionParams);
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createBillingPortalSession',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  return success({
    portalUrl: portalSession.url,
    portalSessionId: portalSession.id,
  });
};
