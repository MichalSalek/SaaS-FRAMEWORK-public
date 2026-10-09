import crypto from 'crypto';
import type Stripe from 'stripe';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AccountStripeError,
  CheckoutPlanNotFoundError,
  CheckoutPriceResolveError,
} from '@kernel/domain/user-and-account/account-errors.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { canStartTrial } from '@kernel/domain/pricing/pricing-policy';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { getOrCreateStripeCustomer } from '@app/stripe/customer.operations';
import { getOrCreateVatTaxRate } from '@app/stripe/vat-tax-rate.operations';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';
import { retryStripeOperation } from '@app/stripe/stripe-retry.utils';
import { resolveCheckoutPrice_IO } from '@app/stripe/price-resolver.operations';
import { resolveCheckoutDiscounts_IO } from '@app/stripe/checkout-discount.operations';
import { buildCheckoutReturnUrl } from '@app/stripe/checkout-return-url';
import {
  getPlanIdFromPricingPlanValue,
  TRIAL_CONFIG,
} from '@app/stripe/stripe.config';

export type EmbeddedCheckoutResult = {
  clientSecret: string;
  checkoutSessionId: string;
  returnUrl: string;
  promoRejected?: boolean;
};

/**
 * SPE — utwórz custom Checkout Session (`ui_mode:'custom'`) dla planu paid.
 *
 * DECISION (nie usuwaj): `ui_mode:'custom'` (SDK stripe 20.2.0 — `UiMode='custom'|'embedded'|'hosted'`,
 * brak 'elements' z docs/nowszego SDK). 'custom' = MY renderujemy stronę (PlanCheckoutPanel: nasze
 * podsumowanie planu + tylko PaymentElement w iframe = max native feel, intencja ownera), front:
 * `@stripe/react-stripe-js` CheckoutProvider + PaymentElement + useCheckout, confirm via checkout.confirm.
 * NIE 'embedded' (Stripe renderuje CAŁE UI w iframe = browser-smell). NIE upgrade SDK (ryzyko dla
 * działającego webhook/subscription kodu tuż przed launchem; 'custom' daje tę samą UX).
 *
 * Renderowana WEWNĄTRZ appki/web (native feel, zero browser-smell). Trial dołączany
 * wg kernel SSOT `canStartTrial` (pricing-policy): trial_started_at null ORAZ
 * payment_status UNPAID/REJECTED; re-sub po zużytym trialu i aktywny subskrybent
 * (PAID/IN_PROGRESS) = bez triala. Mint = czysty round-trip do Stripe, ZERO zapisów
 * na koncie: `plan_selected_at` NIE jest już ustawiany przy mincie (usunięty
 * 2026-07-10 — patrz NOTE na końcu operacji), trial_started_at pisze webhook.
 */
export const createEmbeddedCheckoutSession_IO = async ({
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
    EmbeddedCheckoutResult,
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
    return databaseFailure('createEmbeddedCheckoutSession:fetchUser', error);
  }

  if (!user?.stylist_account) {
    return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: userId });
  }

  const accountId = user.stylist_account.account_id;

  // Resolve Stripe priceId (FREE/SCALE rejected upstream by dispatcher; here
  // resolver still guards CHECKOUT_PLAN_NOT_FOUND for missing product/price).
  const priceResult = await resolveCheckoutPrice_IO({ planId, billingPeriod });
  if (!priceResult.success) {
    return failure(priceResult.error);
  }
  const { priceId } = priceResult.data;

  // READ-ONLY trial eligibility — kernel SSOT (pricing-policy.canStartTrial):
  // never-claimed trial (trial_started_at null) AND payment_status UNPAID/REJECTED.
  // PAID (active subscriber) / IN_PROGRESS (checkout already open) must NOT
  // (re)start a trial — a second checkout from a paying stylist would otherwise
  // mint a fresh 30-day trial (free month via duplicate-sub auto-cancel).
  const trialEligible = canStartTrial({
    trialStartedAt: user.stylist_account.trial_started_at,
    paymentStatus: user.stylist_account.payment_status,
  });

  // DECISION (nie usuwaj tego komentarza):
  // D2 — brak pre-lock trial_started_at; webhook customer.subscription.created
  // ustawia trial przy wejściu w trialing (anty-lockout porzuconego checkoutu).
  let stripeCustomerId: string;
  try {
    stripeCustomerId = await getOrCreateStripeCustomer({
      userEmail: user.email,
      accountId,
    });
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createEmbeddedCheckoutSession',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  // DECISION (nie usuwaj tego komentarza):
  // VAT 23% dolicza się do KAŻDEJ płatności (ceny na LP = netto, owner). Stawka
  // trafia na subskrypcję jako `default_tax_rates` → Stripe kopiuje ją na KAŻDĄ
  // fakturę cykliczną (miesięczną/roczną), nie tylko na pierwszą. Get-or-create
  // scope'owane metadatą — patrz vat-tax-rate.operations.
  let vatTaxRateId: string;
  try {
    vatTaxRateId = await getOrCreateVatTaxRate();
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createEmbeddedCheckoutSession',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  const stripePlanId = getPlanIdFromPricingPlanValue(planId);
  // Cel checkoutu (plan/period/source) w return_url — mechanika i DECISION w
  // checkout-return-url.ts (wspólny builder z wariantem hosted).
  const returnUrl = buildCheckoutReturnUrl({ planId, billingPeriod, source });

  const subscriptionMetadata: Record<string, string> = {
    planId: stripePlanId,
    accountId: accountId.toString(),
    billingPeriod,
    // Stempel projektu → webhook router przetwarza tylko sesje z naszym
    // stemplem (patrz STRIPE_PROJECT_ID).
    projectId: STRIPE_PROJECT_ID,
  };

  const checkoutParams: Stripe.Checkout.SessionCreateParams = {
    ui_mode: 'custom',
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      ...(trialEligible && {
        trial_period_days: TRIAL_CONFIG.DURATION_DAYS,
      }),
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
    return_url: returnUrl,
    client_reference_id: user.id.toString(),
  };

  // QA-only: opcjonalny kupon z env (STRIPE_TEST_COUPON_ID) stosowany przy checkoucie na czas QA.
  // Pusty => normalna cena.
  const discount = await resolveCheckoutDiscounts_IO({
    billingPeriod,
    promo,
    stripeCustomerId,
    trialEligible,
  });
  if (discount.discounts) {
    checkoutParams.discounts = discount.discounts;
  }

  // Bound the Stripe round-trip with the shared retry policy (parity with the
  // auto-cancel path): transient 5xx/429/network failures back off (1s/2s/4s,
  // <=7s worst case) instead of failing the whole checkout on a single blip;
  // permanent 4xx short-circuit immediately.
  //
  // DECISION (nie usuwaj tego komentarza):
  // `checkout.sessions.create` is NOT naturally idempotent — each call mints a
  // new session. `retryStripeOperation` is documented for idempotent ops, so we
  // pass a per-invocation `idempotencyKey`: a network-retry of a creation whose
  // response was lost returns the SAME session (no duplicate), while a genuinely
  // new request (e.g. the user hitting Retry in PlanCheckoutPanel) is a fresh
  // call with a fresh key → a fresh session. Key scope = this invocation only.
  const idempotencyKey = crypto.randomUUID();
  const sessionResult = await retryStripeOperation({
    fn: () =>
      getStripe().checkout.sessions.create(checkoutParams, { idempotencyKey }),
    namespace: 'STRIPE_CHECKOUT_SESSION_CREATE',
    payload: {
      accountId: accountId.toString(),
      planId: stripePlanId,
      billingPeriod,
    },
  });

  if (!sessionResult.ok) {
    const lastAttempt =
      sessionResult.attempts[sessionResult.attempts.length - 1];
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createEmbeddedCheckoutSession',
      stripeError:
        lastAttempt?.errorMessage ??
        `Stripe checkout.sessions.create failed after ${sessionResult.attempts.length} attempts`,
    });
  }

  const session: Stripe.Checkout.Session = sessionResult.value;

  if (session.client_secret == null) {
    // ui_mode:'custom' MUST return a client_secret; a null means the session
    // is unusable (the client has nothing to mount the Payment Element with).
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createEmbeddedCheckoutSession',
      stripeError: 'Embedded checkout session returned null client_secret',
    });
  }

  // NOTE (2026-07-10): the optimistic `plan_selected_at` marker set here was
  // REMOVED. It was unreliable (fired on mere checkout-session MINT, before any
  // payment) and actively harmful: at mint `pricing_plan` stays FREE (the webhook
  // is the SSOT for pricing_plan), so an ABANDONED paid checkout looked like a
  // resolved FREE plan (pricing_plan=FREE + plan_selected_at set) to the
  // onboarding-plan guard and CAN_USER_HAVE_ACTIVE_ACCOUNT. plan_selected_at is
  // now written ONLY on genuine FREE selection (account-free-selection); paid
  // resolution is tracked via subscription_status / payment_status (webhook SSOT).

  return success({
    clientSecret: session.client_secret,
    checkoutSessionId: session.id,
    returnUrl,
    ...(discount.promoRejected ? { promoRejected: true as const } : {}),
  });
};
