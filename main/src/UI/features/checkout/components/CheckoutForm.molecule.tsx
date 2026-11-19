import { CheckoutActionsMolecule } from './CheckoutActions.molecule';
// UI/features/checkout/components/CheckoutForm.molecule.tsx
// The embedded payment form — lives INSIDE <CheckoutProvider>.
// Reads the live checkout via useCheckout(), renders the order summary +
// Stripe <PaymentElement/> (card + BLIK + P24, dynamic) + a single "pay" CTA.
// confirm() finalizes: Stripe redirects to the session's return_url on success
// (or surfaces an inline error). No return_url is passed here — it is baked into
// the Checkout Session backend-side (see CheckoutSessionResponse.returnUrl).
import { useTranslations } from 'next-intl';
import { useCheckout } from '@stripe/react-stripe-js/checkout';
import { useCheckoutElementAutofocus } from './useCheckoutElementAutofocus';
import { useCheckoutAttemptState } from './useCheckoutAttemptState';
import {
  CheckoutRecoverViewMolecule,
  CheckoutStalledMolecule,
  CheckoutStatusViewMolecule,
} from './CheckoutStatusView.molecule';
import { PlanCheckoutSummaryMolecule } from './PlanCheckoutSummary.molecule';
import { buildCheckoutSummaryModel } from '../checkout-summary.helpers';
import { resolveCheckoutAct } from '../checkout-act.helpers';
import type { CheckoutFormProps } from './CheckoutForm.types';
import styles from '../PlanCheckoutPanel.module.css';
import { PAY_TIMING, payFlow, checkoutMarket } from './checkout-pay.helpers';
import { updateCheckoutCompany } from './updateCheckoutCompany';
import { CheckoutPaymentDetailsOrganism } from './CheckoutPaymentDetails.organism';
import { useCheckoutBillingState } from '../hooks/useCheckoutBillingState';
import { renderCheckoutBlockingViewMolecule } from './CheckoutBlockingView.molecule';
export type { CheckoutFormTranslations } from './CheckoutForm.types';
export function CheckoutFormMolecule({
  planId,
  billingPeriod,
  billingCountry: country,
  billingProfile,
  billingProfileUnverified = false,
  billingAddressRequired = false,
  currency = 'pln',
  source = 'account-pay',
  promo,
  onConfirmed,
  onCancel,
  onRetrySession,
  onPaymentInFlightChange,
  onPaymentActiveChange,
  summaryDescribedById,
  tx,
}: CheckoutFormProps) {
  const checkoutState = useCheckout();
  const c = useTranslations('account.checkout');
  const billing = useCheckoutBillingState({
    country,
    profile: billingProfile,
    addressRequired: billingAddressRequired,
    source,
    planId,
    billingPeriod,
    currency,
    promo,
  });
  const { billingNameRef } = billing;
  const payment = useCheckoutAttemptState(
    billing.taxPortal.busy,
    onPaymentInFlightChange,
    onPaymentActiveChange
  );
  const { confirmingRef, attemptRef, watchdogRef, mountedRef } = payment;
  useCheckoutElementAutofocus();
  if (checkoutState.type === 'loading') {
    return (
      <CheckoutStatusViewMolecule
        variant='spinner'
        role='status'
        text={tx.loadingPayment}
      />
    );
  }
  // Cancel exits of the status views below (only when the parent offers one).
  const cancelAction =
    onCancel !== undefined
      ? { label: tx.cancel, onClick: onCancel }
      : undefined;
  if (checkoutState.type === 'error') {
    // Nothing is committed yet (no confirm() ran), so both exits are safe.
    return (
      <CheckoutRecoverViewMolecule
        text={tx.initError}
        retryLabel={tx.retry}
        onRetry={onRetrySession}
        cancel={cancelAction}
      />
    );
  }
  const { checkout } = checkoutState;
  // Trial or payment: the session decides, and the wording follows it.
  const summary = buildCheckoutSummaryModel(checkout, billingPeriod);
  const act = resolveCheckoutAct(summary, c, tx);
  const blockedView = renderCheckoutBlockingViewMolecule(
    act,
    {
      timedOut: payment.timedOut,
      addressReady: billing.addressReady,
      confirming: payment.confirming,
      redirectInFlight: payment.redirectInFlight,
    },
    tx,
    onRetrySession,
    cancelAction
  );
  if (blockedView) {
    return blockedView;
  }
  const handlePay = async () => {
    if (
      act.amountUnknown ||
      confirmingRef.current ||
      !billing.readyRef.current ||
      billing.taxPortal.isBusy() ||
      billingProfileUnverified ||
      billing.blocked ||
      !billing.billingCountry
    ) {
      return;
    }
    // VAT invoice: validate the subform BEFORE the payment starts. An error → show per-field messages
    // and do NOT call confirm() (VAT is added regardless).
    if (
      billing.vat.isOn &&
      !billing.vat.validate(
        {
          required: tx.vatFieldRequired,
          postalInvalid: tx.vatPostalCodeInvalid,
          nipInvalid: tx.nipInvalid,
        },
        billing.needsAddress ? billing.sharedAddress : undefined
      )
    ) {
      return;
    }
    const attempt = (attemptRef.current += 1);
    confirmingRef.current = true;
    payment.setConfirming(true);
    payment.setConfirmError(null);
    payment.setStalled(false);
    payment.clearWatchdog();
    // Arm the stall watchdog BEFORE awaiting: if confirm() neither resolves nor
    // rejects within the grace window the request is stuck — flip to a
    // recoverable view (Cancel re-enabled + Retry) so the user is never trapped
    // on a permanent spinner. We do NOT clear `confirming` here so the redirect
    // path (which keeps the spinner) stays consistent; the stalled view replaces
    // the form entirely.
    watchdogRef.current = setTimeout(() => {
      if (attempt !== attemptRef.current) {
        return;
      }
      // Stall is recoverable, so the next handlePay must be allowed to fire.
      confirmingRef.current = false;
      payment.setStalled(true);
    }, PAY_TIMING.CONFIRM_STALL_MS);
    // VAT invoice (save-before-confirm): when the switch is ON, save the company data on the Stripe
    // Customer BEFORE the payment is finalised — the invoice created at confirm() must already have
    // name/address/tax_id. A save error → show inline vatSaveError and do NOT call confirm().
    // Stale-generation + unmount guarded (parity with confirm below).
    if (billing.vat.isOn && payment.appliedCompany !== billing.fingerprint) {
      const previousBillingName = billingNameRef.current;
      billingNameRef.current = billing.vat.form.companyName.trim();
      try {
        await updateCheckoutCompany(
          checkout,
          billing.vat,
          billing.billingCountry,
          billing.needsAddress ? billing.sharedAddress : undefined
        );
      } catch {
        billingNameRef.current = previousBillingName;
        if (attempt !== attemptRef.current || !mountedRef.current) {
          return;
        }
        payment.releaseAttempt();
        payment.setConfirmError(tx.vatSaveError);
        return;
      }
      // A late resolution after retry/close: ignore (only latest live attempt proceeds).
      if (attempt !== attemptRef.current || !mountedRef.current) {
        return;
      }
      // Stripe may change the total after the address or tax ID update. Show
      // its refreshed summary and require a separate payment confirmation.
      payment.setAppliedCompany(billing.fingerprint);
      payment.releaseAttempt();
      return;
    }
    const market = checkoutMarket(
      billing.actualCountry ?? country,
      checkout.currency,
      billingPeriod
    );
    const confirmationKind =
      summary.kind === 'trial'
        ? 'trial'
        : checkout.total.total.minorUnitsAmount > 0
          ? 'payment'
          : 'zero';
    let result: Awaited<ReturnType<typeof checkout.confirm>>;
    try {
      // confirm() finalizes the payment. On success Stripe navigates to the
      // session's return_url (set backend-side) — for redirect methods (BLIK/P24)
      // the browser leaves immediately; for card it resolves here then navigates.
      payFlow.clicked(planId, market, confirmationKind);
      result = await checkout.confirm();
    } catch {
      // A transport rejection can follow a provider acceptance. Check the owned
      // attempt result before permitting another confirmation.
      if (attempt !== attemptRef.current || !mountedRef.current) {
        return;
      }
      payFlow.threw(planId, market, confirmationKind);
      payment.releaseAttempt();
      payment.setStalled(true);
      return;
    }
    // A late resolution after the user retried (or closed the dialog): ignore —
    // only the latest attempt on a still-mounted form may mutate state or kick off
    // navigation (mountedRef closes the unmount window attemptRef can't see).
    if (attempt !== attemptRef.current || !mountedRef.current) {
      return;
    }
    payment.clearWatchdog();
    if (result.type === 'error') {
      if (result.error.code !== 'paymentFailed') {
        payFlow.threw(planId, market, confirmationKind);
        payment.releaseAttempt();
        payment.setStalled(true);
        return;
      }
      // NEVER render Stripe's raw error.message (often English / raw API copy in
      // a fully-Polish UI). Show the PL confirmError; log the raw text for
      // diagnostics only. (code/declineCode → dedicated PL strings would need new
      // i18n keys; the generic PL line is correct for every case today.)
      if (result.error.message != null && result.error.message !== '') {
        console.warn('[checkout] confirm failed:', result.error.message);
      }
      // The payment did NOT go through: one error vibration with the shake.
      payFlow.declined(planId, result.error, market, confirmationKind);
      payment.releaseAttempt();
      payment.setConfirmError(act.confirmError);
      payment.setShake(true);
      return;
    }
    // The payment went through: the one vibration of this flow (an outcome
    // confirmed by Stripe in the browser, so it has no server event to ride
    // on; policy in `application/platform/haptic-events.config.ts`).
    payFlow.succeeded(planId, market, confirmationKind);
    // Success path: the redirect is in flight. Keep the button disabled AND
    // hard-block dismissal (redirectInFlight) until navigation completes. If the
    // stall watchdog had already flipped us to the recoverable view, recover from
    // it — the payment actually succeeded. Re-arm a redirect-overdue watchdog so a
    // navigation that never lands degrades to a neutral note instead of a
    // permanent spinner (a re-confirm on a confirmed session would just error).
    payment.setStalled(false);
    payment.setRedirectInFlight(true);
    // DECISION: confirming the card can succeed without navigation. The explicit return goes
    // through webhook polling instead of leaving the modal open.
    try {
      onConfirmed(result.session.id);
    } catch {
      // Payment succeeded even when this browser refuses navigation.
      payment.setRedirectInFlight(false);
      payment.setTimedOut(true);
      return;
    }
    watchdogRef.current = setTimeout(() => {
      // Do NOT surface confirmError — confirm() succeeded; re-enabling "pay" would
      // push a doomed re-confirm on an already-paid session. RELEASE the dismissal
      // block: redirect overshot its window but the session is PAID (webhook = SSOT),
      // so a non-dismissable modal would trap the user (blocked Android WebView
      // redirect → app-restart as only exit). timedOut Cancel/Escape now exit safely.
      payment.setRedirectInFlight(false);
      payment.setTimedOut(true);
    }, PAY_TIMING.REDIRECT_OVERDUE_MS);
  };
  // An uncertain provider result is resolved through the owned checkout-result
  // screen. A second confirmation is not a substitute for learning that result.
  if (payment.stalled) {
    return (
      <CheckoutStalledMolecule
        text={c('resultUnknown')}
        retry={{
          label: c('checkResult'),
          onClick: () => onConfirmed(checkout.id),
        }}
        cancel={cancelAction}
      />
    );
  }
  // Cancel is disabled only while the confirmed-success redirect settles, never
  // during the bare network call (a stall must stay escapable). Escape/backdrop
  // blocking is mirrored to the parent via onPaymentInFlightChange.
  return (
    <div className={styles.panel}>
      <PlanCheckoutSummaryMolecule
        planId={planId}
        model={summary}
        summaryDescribedById={summaryDescribedById}
        tx={tx}
        addressReady={billing.addressReady}
        currency={checkout.currency}
      />

      <CheckoutPaymentDetailsOrganism
        billing={billing}
        disabled={payment.confirming || billingProfileUnverified}
        appliedCompany={payment.appliedCompany}
        onOpenTaxPortal={() => {
          if (!confirmingRef.current) {
            void billing.taxPortal.open();
          }
        }}
        tx={tx}
      />

      <CheckoutActionsMolecule
        progress={
          payment.confirming || payment.redirectInFlight ? act.processing : ''
        }
        error={payment.confirmError}
        confirming={payment.confirming}
        disabled={
          act.amountUnknown ||
          payment.confirming ||
          !billing.addressReady ||
          billing.taxPortal.busy ||
          billingProfileUnverified ||
          billing.blocked
        }
        shake={payment.shake}
        onShakeEnd={() => payment.setShake(false)}
        onPay={() => void handlePay()}
        onCancel={onCancel}
        cancelDisabled={payment.redirectInFlight || billing.taxPortal.busy}
        payLabel={act.payNow}
        processingLabel={act.processing}
        needsCompanyUpdate={
          billing.vat.isOn && payment.appliedCompany !== billing.fingerprint
        }
        cancelLabel={tx.cancel}
        secureHint={tx.secureHint}
      />
    </div>
  );
}
