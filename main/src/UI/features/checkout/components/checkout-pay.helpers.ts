// Payment-attempt helpers for the checkout panel and form: the two watchdog
// windows and the named flow trace of each attempt (outcome haptics ride along, so the
// form keeps one call per outcome).
import type { StripeCheckoutConfirmResult } from '@stripe/stripe-js';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { CheckoutSessionResponse } from '@kernel/domain/user-and-account/account-checkout.types';
import { hapticNotification } from '../../../../application/platform/haptics';
import {
  billingMarketProperties,
  type BillingMarketAnalytics,
} from '../../../../application/analytics/billing-market.analytics';
import { trackFlowStep } from '../../../../application/analytics/flow-events';

export function clearCheckoutWatchdog(ref: {
  current: ReturnType<typeof setTimeout> | null;
}): void {
  if (ref.current !== null) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

type ConfirmError = Extract<
  StripeCheckoutConfirmResult,
  { type: 'error' }
>['error'];

export const PAY_TIMING = {
  // confirm() normally hands off to a Stripe redirect within a couple of seconds.
  // First watchdog: if confirm() neither resolves nor rejects within this window,
  // the network is stalled mid-confirm — surface a recoverable view (retry/close)
  // instead of trapping the user on a permanent "processing" spinner with no exit.
  CONFIRM_STALL_MS: 20_000,
  // Second watchdog: confirm() returned success but the post-success navigation
  // never landed (slow Android WebView / blocked redirect). Neutral "still
  // processing" note — the payment likely went through; only nav is slow.
  REDIRECT_OVERDUE_MS: 15_000,
} as const;

const SESSION_KIND: Record<CheckoutSessionResponse['mode'], string> = {
  free_selected: 'free',
  checkout_elements: 'elements',
  hosted_fallback: 'hosted',
};

export function checkoutMarket(
  billingCountry: string | undefined,
  currency: string,
  billingPeriod: string
): BillingMarketAnalytics {
  return { billingCountry, currency, billingPeriod };
}

type ConfirmationKind = 'trial' | 'payment' | 'zero';

export const payFlow = {
  /** The checkout session was minted (Free activation, embedded form or hosted page). */
  sessionCreated(
    plan: PricingPlan,
    mode: CheckoutSessionResponse['mode'],
    market?: BillingMarketAnalytics
  ): void {
    trackFlowStep('checkout', 'session_created', {
      plan,
      kind: SESSION_KIND[mode],
      ...billingMarketProperties(
        mode === 'free_selected' ? { ...market, currency: undefined } : market
      ),
    });
  },
  clicked(
    plan: PricingPlan,
    market?: BillingMarketAnalytics,
    confirmationKind?: ConfirmationKind
  ): void {
    trackFlowStep('checkout', 'pay_clicked', {
      plan,
      measurement_version: 2,
      measurement_changed_at: '2026-11-06',
      ...billingMarketProperties(market),
      ...(confirmationKind ? { confirmation_kind: confirmationKind } : {}),
    });
  },
  /** Stripe confirmed the payment in the browser: success vibration + trace. */
  succeeded(
    plan: PricingPlan,
    market?: BillingMarketAnalytics,
    confirmationKind?: ConfirmationKind
  ): void {
    void hapticNotification('Success');
    trackFlowStep('checkout', 'payment_succeeded', {
      plan,
      ...billingMarketProperties(market),
      ...(confirmationKind ? { confirmation_kind: confirmationKind } : {}),
    });
  },
  /** Stripe refused the payment: error vibration + trace with Stripe codes only. */
  declined(
    plan: PricingPlan,
    error: ConfirmError,
    market?: BillingMarketAnalytics,
    confirmationKind?: ConfirmationKind
  ): void {
    void hapticNotification('Error');
    trackFlowStep('checkout', 'payment_failed', {
      plan,
      ...billingMarketProperties(market),
      ...(confirmationKind ? { confirmation_kind: confirmationKind } : {}),
      code: error.code ?? 'unknown',
      ...(error.code === 'paymentFailed' &&
      error.paymentFailed.declineCode !== null
        ? { decline_code: error.paymentFailed.declineCode }
        : {}),
    });
  },
  /** confirm() threw (network, SDK fault): no vibration, as before. */
  threw(
    plan: PricingPlan,
    market?: BillingMarketAnalytics,
    confirmationKind?: ConfirmationKind
  ): void {
    trackFlowStep('checkout', 'confirmation_unknown', {
      plan,
      ...billingMarketProperties(market),
      ...(confirmationKind ? { confirmation_kind: confirmationKind } : {}),
      code: 'confirm_threw',
    });
  },
};
