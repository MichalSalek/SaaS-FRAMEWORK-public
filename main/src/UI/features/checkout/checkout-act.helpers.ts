// UI/features/checkout/checkout-act.helpers.ts
//
// DECISION: the session decides whether this step starts a trial or takes a payment, and every word
// that names the act follows it: the button, the progress line, the failure line. "Zapłać za plan"
// above a zero charge was the second half of the "it looks like a glitch" report. (owner
// 2026-10-11)

import type { CheckoutSummaryModel } from './checkout-summary.helpers';

interface PaymentActCopy {
  payNow: string;
  processing: string;
  confirmError: string;
  stillProcessing: string;
}

export interface CheckoutAct extends PaymentActCopy {
  /** Stripe gave no figure for today's charge: the form must not ask to pay. */
  amountUnknown: boolean;
  amountUnknownText: string;
}

/** `t` is the `account.checkout` translator; `tx` the form's payment wording. */
export function resolveCheckoutAct(
  summary: CheckoutSummaryModel,
  t: (key: string) => string,
  tx: PaymentActCopy
): CheckoutAct {
  const isTrial = summary.kind === 'trial';
  return {
    payNow: isTrial ? t('trial.cta') : tx.payNow,
    processing: isTrial ? t('trial.processing') : tx.processing,
    confirmError: isTrial ? t('trial.confirmError') : tx.confirmError,
    stillProcessing: isTrial ? t('trial.stillProcessing') : tx.stillProcessing,
    amountUnknown:
      summary.kind === 'trial'
        ? summary.next.kind === 'unavailable'
        : summary.today.kind === 'unavailable' || summary.nextGross === null,
    amountUnknownText:
      summary.kind === 'trial' ||
      (summary.kind === 'pay' && summary.today.kind !== 'unavailable')
        ? t('summary.renewalUnavailable')
        : t('summary.todayUnavailable'),
  };
}
