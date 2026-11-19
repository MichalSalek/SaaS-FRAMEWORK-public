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
import { ENV_VARS } from '@app/environment/environment.config';
import { buildCheckoutReturnUrl } from '@app/stripe/checkout-return-url';
import {
  getPlanIdFromPricingPlanValue,
  TRIAL_CONFIG,
} from '@app/stripe/stripe.config';
import { runCheckoutAttempt_IO } from './checkout-attempt.operations';
import type { CheckoutAttemptError } from './checkout-attempt.types';

/**
 * Create a hosted Stripe Checkout Session when embedded checkout is off or down.
 * The trial follows `canStartTrial` (trial never used, payment_status UNPAID or
 * REJECTED). Returns to `/app?checkout=done`.
 */
export const createHostedFallbackSession_IO = async ({
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
}): Promise<
  OperationResult<
    {
      url: string;
      checkoutSessionId: string;
      trialDays: number;
      billingAddressRequired?: boolean;
      promoRejected?: boolean;
    },
    CheckoutAttemptError
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
      mode: 'hosted',
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

      // Trial eligibility — kernel SSOT (pricing-policy.canStartTrial), parity with
      // the embedded creator: never-claimed trial AND payment_status UNPAID/REJECTED.
      const trialEligible = canStartTrial({
        trialStartedAt: account.trial_started_at,
        paymentStatus: account.payment_status,
      });
      const stripePlanId = getPlanIdFromPricingPlanValue(planId);

      let stripeCustomerId: string;
      try {
        stripeCustomerId = await getOrCreateStripeCustomer({
          userEmail: checkoutUser.email,
          accountId,
        });
      } catch (error: unknown) {
        return failure({
          type: 'ACCOUNT_STRIPE_ERROR',
          operation: 'createHostedFallbackSession',
          stripeError: error instanceof Error ? error.message : String(error),
        });
      }

      // DECISION: (owner) mirror embedded checkout's scoped, inclusive 23% PL VAT treatment.
      let vatTaxRateId: string | undefined;
      try {
        if (!automaticTax) {
          vatTaxRateId = await getOrCreateVatTaxRate();
        }
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
        currency,
        ...(billingCountry ? { billingCountry } : {}),

        projectId: STRIPE_PROJECT_ID,
      };

      const returnUrl = buildCheckoutReturnUrl({
        planId,
        billingPeriod,
        source,
        currency,
        billingCountry,
      });
      const checkoutParams: Stripe.Checkout.SessionCreateParams = {
        customer: stripeCustomerId,
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
        // Ten sam adres powrotu co embedded (polling webhooka + onboarding_completed);
        // `/app?checkout=done` omijał bramkę potwierdzenia — patrz checkout-return-url.ts.
        success_url: returnUrl,
        cancel_url: `${ENV_VARS.PUBLIC_URL}/app`,
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

  if (session.url === null) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'createHostedFallbackSession',
      stripeError: 'Hosted checkout session returned null url',
    });
  }

  return success({
    url: session.url,
    checkoutSessionId: session.id,
    trialDays,
    ...(meta.billingAddressRequired && { billingAddressRequired: true }),
    ...(meta.promoRejected ? { promoRejected: true as const } : {}),
  });
};
