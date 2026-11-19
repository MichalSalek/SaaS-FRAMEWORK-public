import { canStartTrial } from '@kernel/domain/pricing/pricing-policy';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';
import type {
  CheckoutAttemptRow,
  PrepareCheckout,
} from './checkout-attempt.types';
import { attemptStore as store } from './checkout-attempt.database';
import { AttemptBusy, AttemptSubscribed } from './checkout-attempt.policy';
import {
  fence,
  required,
  type Context,
  PreparationFailure,
} from './checkout-attempt.context';
import {
  readOwnedAccount,
  recoverProviderTrial,
} from './checkout-attempt.database';
import { assertNoScopedSubscription } from './checkout-attempt.provider';
import { resolveCheckoutDiscounts_IO } from '@app/stripe/checkout-discount.operations';

// Never store credentials or provider client secrets, even if a callback is changed later.
function containsSecret(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsSecret);
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return Object.entries(value).some(
    ([key, item]) => /secret|api_key/i.test(key) || containsSecret(item)
  );
}

export async function freezeAttempt(
  row: CheckoutAttemptRow,
  ctx: Context,
  prepare: PrepareCheckout
): Promise<CheckoutAttemptRow> {
  const result = await prepare();
  if (!result.success) {
    throw new PreparationFailure(result.error);
  }
  const account = await readOwnedAccount(
    ctx.intent.userId,
    ctx.intent.accountId
  );
  if (
    !account ||
    !account.stripe_customer_id ||
    result.data.params.customer !== account.stripe_customer_id
  ) {
    throw new AttemptBusy('Customer changed during preparation');
  }
  if (
    account.subscription_id &&
    (account.subscription_status === null ||
      !['CANCELED', 'INCOMPLETE_EXPIRED'].includes(account.subscription_status))
  ) {
    throw new AttemptSubscribed('Existing account subscription');
  }
  const params = result.data.params;
  if (
    !row.attempt_id ||
    !row.expires_at ||
    params.mode !== 'subscription' ||
    params.metadata?.projectId !== STRIPE_PROJECT_ID ||
    params.metadata.accountId !== ctx.intent.accountId ||
    params.subscription_data?.metadata?.projectId !== STRIPE_PROJECT_ID ||
    params.subscription_data.metadata.accountId !== ctx.intent.accountId ||
    containsSecret(params) ||
    containsSecret(result.data.meta)
  ) {
    throw new AttemptBusy('Unverified preparation');
  }
  const usedProviderTrial = await assertNoScopedSubscription(
    account.stripe_customer_id,
    ctx.intent,
    ctx.options
  );
  if (usedProviderTrial && !account.trial_started_at) {
    await recoverProviderTrial(
      ctx.intent.userId,
      ctx.intent.accountId,
      account.stripe_customer_id,
      usedProviderTrial
    );
  }
  if (
    (usedProviderTrial ||
      !canStartTrial({
        trialStartedAt: account.trial_started_at,
        paymentStatus: account.payment_status,
      })) &&
    params.subscription_data.trial_period_days !== undefined
  ) {
    delete params.subscription_data.trial_period_days;
    // The first-month offer is excluded during a trial. If the authoritative
    // check removes that trial, resolve it again before freezing the session.
    if (ctx.intent.billingPeriod === 'month' && ctx.intent.promo?.trim()) {
      const discount = await resolveCheckoutDiscounts_IO({
        billingPeriod: ctx.intent.billingPeriod,
        currency: ctx.intent.currency,
        promo: ctx.intent.promo,
        stripeCustomerId: account.stripe_customer_id,
        trialEligible: false,
      });
      if (discount.discounts) {
        params.discounts = discount.discounts;
      } else {
        delete params.discounts;
      }
      result.data.meta.promoRejected = discount.promoRejected;
    }
  }
  const trialDays = params.subscription_data.trial_period_days ?? 0;
  if (ctx.intent.expectedTrialDays !== trialDays) {
    throw new PreparationFailure({ type: 'CHECKOUT_TERMS_CHANGED', trialDays });
  }
  params.metadata = { ...params.metadata, attemptId: row.attempt_id };
  params.subscription_data.metadata = {
    ...params.subscription_data.metadata,
    attemptId: row.attempt_id,
  };
  params.expires_at = Math.floor(row.expires_at.getTime() / 1000);
  return required(
    await store.prepared({
      ...fence(row, ctx),
      paramsJson: JSON.stringify(params),
      metaJson: JSON.stringify(result.data.meta),
      customerId: account.stripe_customer_id,
    })
  );
}
