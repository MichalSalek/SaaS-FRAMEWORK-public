import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';
import {
  currencyForCountry,
  type BillingCurrency,
  type CountryCode,
} from '@kernel/domain/localization/country.config';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  BillingPeriod,
  CheckoutSessionResponse,
} from '@kernel/domain/user-and-account/account-checkout.types';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { getFeatureFlags } from '@app/feature-flags/feature-flags.cache';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { createEmbeddedCheckoutSession_IO } from './account-embedded-checkout.operations';
import { createHostedFallbackSession_IO } from './checkout-prepare-hosted.operations';
import { selectFreePlan_IO } from './account-free-selection.operations';
import { guardNewSubscription_IO } from './account-checkout-subscription.guard';
import { retireCheckoutAttempt_IO } from './checkout-attempt.operations';
import type { CheckoutAttemptError } from './checkout-attempt.types';

/**
 * SPE — dispatcher wyboru planu (D9). Zwraca discriminated union po `mode`.
 *
 *  - FREE  -> retire outstanding checkout and selectFreePlan_IO -> { mode:'free_selected' }
 *  - SCALE -> CheckoutPlanNotFoundError (custom/contact, brak self-serve checkout)
 *  - paid  -> embedded (flaga ON, default) / hosted_fallback (embedded OFF & hosted ON)
 *
 * DECISION: with both flags OFF the default is embedded (the native feel is the point). Hosted is
 * a deliberate opt-in behind its flag, never a blind fallback for missing configuration.
 */
export const createCheckoutSession_IO = async ({
  userId,
  planId,
  billingPeriod,
  currency,
  billingCountry,
  observedCountry,
  source,
  promo,
  expectedTrialDays,
}: {
  userId: string;
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  currency?: BillingCurrency;
  billingCountry?: CountryCode;
  observedCountry?: CountryCode;
  source?: string;
  promo?: string;
  expectedTrialDays?: number;
}): Promise<OperationResult<CheckoutSessionResponse, CheckoutAttemptError>> => {
  if (planId === PricingPlanValue.FREE) {
    const retireResult = await retireCheckoutAttempt_IO({
      userId,
      commit: checkoutLease => selectFreePlan_IO({ userId, checkoutLease }),
    });
    if (!retireResult.success) {
      return failure(retireResult.error);
    }
    return success({ mode: 'free_selected' });
  }

  if (planId === PricingPlanValue.SCALE) {
    // SCALE = custom/contact tier — no self-serve Stripe checkout.
    return failure({ type: 'CHECKOUT_PLAN_NOT_FOUND', planId });
  }

  const subscriptionGuard = await guardNewSubscription_IO(userId);
  if (!subscriptionGuard.success) {
    return failure(subscriptionGuard.error);
  }

  const flags = await getFeatureFlags();
  // DECISION: first rollout opens only after old random-key checkout writers drain.
  if (!(flags.get(FEATURE_FLAG_KEYS.CHECKOUT_ATTEMPTS_ENABLED) ?? false)) {
    return failure({
      type: 'CHECKOUT_ATTEMPT_BUSY',
      accountId: subscriptionGuard.data.accountId,
      retryAfterSeconds: 5,
    });
  }
  const automaticTax =
    flags.get(FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED) ?? false;
  const international =
    flags.get(FEATURE_FLAG_KEYS.INTERNATIONAL_BILLING_ENABLED) ?? false;
  const selectedCurrency = currency ?? 'pln';
  if (
    (currency === undefined && billingCountry !== undefined) ||
    (billingCountry && currencyForCountry(billingCountry) !== selectedCurrency)
  ) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'billingCountry',
      message: VALIDATION_MESSAGES.payment.currencyMismatch,
    });
  }
  const effectiveCountry = billingCountry ?? observedCountry;
  if (
    ((effectiveCountry && effectiveCountry !== 'PL') ||
      selectedCurrency !== 'pln') &&
    (!international || !automaticTax)
  ) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'billingCountry',
      message: VALIDATION_MESSAGES.payment.marketUnavailable,
    });
  }
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
      currency: selectedCurrency,
      ...(billingCountry && { billingCountry }),
      automaticTax,
      ...(source !== undefined && { source }),
      ...(promo !== undefined && { promo }),
      ...(expectedTrialDays !== undefined && { expectedTrialDays }),
    });
    if (!hostedResult.success) {
      return failure(hostedResult.error);
    }
    return success({
      mode: 'hosted_fallback',
      ...(hostedResult.data.billingAddressRequired && {
        billingAddressRequired: true,
      }),
      url: hostedResult.data.url,
      checkoutSessionId: hostedResult.data.checkoutSessionId,
      trialDays: hostedResult.data.trialDays,
      ...(hostedResult.data.promoRejected
        ? { promoRejected: true as const }
        : {}),
    });
  }

  const embeddedResult = await createEmbeddedCheckoutSession_IO({
    userId,
    planId,
    billingPeriod,
    currency: selectedCurrency,
    ...(billingCountry && { billingCountry }),
    automaticTax,
    ...(source !== undefined && { source }),
    ...(promo !== undefined && { promo }),
    ...(expectedTrialDays !== undefined && { expectedTrialDays }),
  });
  if (!embeddedResult.success) {
    return failure(embeddedResult.error);
  }
  return success({
    mode: 'checkout_elements',
    ...(embeddedResult.data.billingAddressRequired && {
      billingAddressRequired: true,
    }),
    clientSecret: embeddedResult.data.clientSecret,
    checkoutSessionId: embeddedResult.data.checkoutSessionId,
    trialDays: embeddedResult.data.trialDays,
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
