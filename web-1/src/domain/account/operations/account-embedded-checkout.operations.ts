import type Stripe from 'stripe';
import type {
  BillingCurrency,
  CountryCode,
} from '@kernel/domain/localization/country.config';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { canStartTrial } from '@kernel/domain/pricing/pricing-policy';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { getOrCreateStripeCustomer } from '@app/stripe/customer.operations';
import { getOrCreateVatTaxRate } from '@app/stripe/vat-tax-rate.operations';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';
import { resolveCheckoutPrice_IO } from '@app/stripe/price-resolver.operations';
import { resolveCheckoutDiscounts_IO } from '@app/stripe/checkout-discount.operations';
import { buildCheckoutReturnUrl } from '@app/stripe/checkout-return-url';
import { runCheckoutAttempt_IO } from './checkout-attempt.operations';
import type { CheckoutAttemptError } from './checkout-attempt.types';
import {
  getPlanIdFromPricingPlanValue,
  TRIAL_CONFIG,
} from '@app/stripe/stripe.config';

export type EmbeddedCheckoutResult = {
  clientSecret: string;
  checkoutSessionId: string;
  returnUrl: string;
  trialDays: number;
  billingAddressRequired?: boolean;
  promoRejected?: boolean;
};

export const createEmbeddedCheckoutSession_IO = async ({
  userId,
  planId,
  billingPeriod,
  currency = 'pln',
  billingCountry,
  automaticTax = false,
  source,
  promo,
  expectedTrialDays,
}: {
  userId: string;
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  currency?: BillingCurrency;
  billingCountry?: CountryCode;
  automaticTax?: boolean;
  source?: string;
  promo?: string;
  expectedTrialDays?: number;
}): Promise<OperationResult<EmbeddedCheckoutResult, CheckoutAttemptError>> => {
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

  const account = user.stylist_account;
  const accountId = account.account_id;
  const checkoutUser = user;

  const attemptResult = await runCheckoutAttempt_IO({
    intent: {
      userId,
      accountId,
      planId,
      billingPeriod,
      currency,
      ...(billingCountry !== undefined && { billingCountry }),
      automaticTax,
      mode: 'custom',
      ...(source !== undefined && { source }),
      ...(promo !== undefined && { promo }),
      ...(expectedTrialDays !== undefined && { expectedTrialDays }),
    },
    prepare: async () => {
      const priceResult = await resolveCheckoutPrice_IO({
        planId,
        billingPeriod,
        currency,
      });
      if (!priceResult.success) {
        return failure(priceResult.error);
      }
      const { priceId } = priceResult.data;

      // READ-ONLY trial eligibility — kernel SSOT (pricing-policy.canStartTrial):
      // never-claimed trial (trial_started_at null) AND payment_status UNPAID/REJECTED.
      // PAID (active subscriber) / IN_PROGRESS (checkout already open) must NOT
      // (re)start a trial — a second checkout from a paying stylist would otherwise
      // mint a fresh trial (free month via duplicate-sub auto-cancel).
      const trialEligible = canStartTrial({
        trialStartedAt: account.trial_started_at,
        paymentStatus: account.payment_status,
      });

      // DECISION: no pre-lock of trial_started_at here. The customer.subscription.created webhook sets
      // it on entering trialing, so an abandoned checkout never burns the trial.
      let stripeCustomerId: string;
      try {
        stripeCustomerId = await getOrCreateStripeCustomer({
          userEmail: checkoutUser.email,
          accountId,
        });
      } catch (error: unknown) {
        return failure({
          type: 'ACCOUNT_STRIPE_ERROR',
          operation: 'createEmbeddedCheckoutSession',
          stripeError: error instanceof Error ? error.message : String(error),
        });
      }

      let vatTaxRateId: string | undefined;
      try {
        if (!automaticTax) {
          vatTaxRateId = await getOrCreateVatTaxRate();
        }
      } catch (error: unknown) {
        return failure({
          type: 'ACCOUNT_STRIPE_ERROR',
          operation: 'createEmbeddedCheckoutSession',
          stripeError: error instanceof Error ? error.message : String(error),
        });
      }

      const stripePlanId = getPlanIdFromPricingPlanValue(planId);
      // Checkout target (plan/period/source) in return_url; mechanism and DECISION in
      // checkout-return-url.ts (builder shared with the hosted variant).
      const returnUrl = buildCheckoutReturnUrl({
        planId,
        billingPeriod,
        source,
        currency,
        billingCountry,
      });

      const subscriptionMetadata: Record<string, string> = {
        planId: stripePlanId,
        accountId: accountId.toString(),
        billingPeriod,
        currency,
        ...(billingCountry ? { billingCountry } : {}),

        projectId: STRIPE_PROJECT_ID,
      };

      const checkoutParams: Stripe.Checkout.SessionCreateParams = {
        ui_mode: 'custom',
        adaptive_pricing: { enabled: false },
        tax_id_collection: { enabled: true },
        customer_update: {
          name: 'auto',
          address: 'auto',
        },
        ...(automaticTax
          ? {
              automatic_tax: { enabled: true },
              billing_address_collection: 'required' as const,
            }
          : {}),
        mode: 'subscription',
        customer: stripeCustomerId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          ...(trialEligible && {
            trial_period_days: TRIAL_CONFIG.DURATION_DAYS,
          }),
          // The inclusive 23% PL VAT rate is copied onto each recurring invoice by the SDK.
          ...(vatTaxRateId ? { default_tax_rates: [vatTaxRateId] } : {}),
          metadata: subscriptionMetadata,
        },
        metadata: {
          planId: stripePlanId,
          accountId: accountId.toString(),
          billingPeriod,
          currency,
          ...(billingCountry ? { billingCountry } : {}),
          projectId: STRIPE_PROJECT_ID,
          ...(source !== undefined && { source }),
        },
        return_url: returnUrl,
        client_reference_id: checkoutUser.id.toString(),
      };

      const discount = await resolveCheckoutDiscounts_IO({
        billingPeriod,
        currency,
        promo,
        stripeCustomerId,
        trialEligible,
      });
      if (discount.discounts) {
        checkoutParams.discounts = discount.discounts;
      }

      return success({
        params: checkoutParams,
        meta: {
          returnUrl,
          billingAddressRequired: automaticTax,
          promoRejected: discount.promoRejected,
        },
      });
    },
  });
  if (!attemptResult.success) {
    return failure(attemptResult.error);
  }
  const { session, meta, trialDays } = attemptResult.data;

  if (session.client_secret == null) {
    // ui_mode:'custom' MUST return a client_secret; a null means the session
    // is unusable (the client has nothing to mount the Payment Element with).
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createEmbeddedCheckoutSession',
      stripeError: 'Embedded checkout session returned null client_secret',
    });
  }

  return success({
    clientSecret: session.client_secret,
    checkoutSessionId: session.id,
    trialDays,
    returnUrl: meta.returnUrl,
    ...(meta.billingAddressRequired && { billingAddressRequired: true }),
    ...(meta.promoRejected ? { promoRejected: true as const } : {}),
  });
};
