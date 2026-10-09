// UI/features/checkout/components/CheckoutForm.molecule.tsx
// SPE (W2): the embedded payment form — lives INSIDE <CheckoutProvider>.
// Reads the live checkout via useCheckout(), renders the order summary +
// Stripe <PaymentElement/> (card + BLIK + P24, dynamic) + a single "pay" CTA.
// confirm() finalizes: Stripe redirects to the session's return_url on success
// (or surfaces an inline error). No return_url is passed here — it is baked into
// the Checkout Session backend-side (see CheckoutSessionResponse.returnUrl).

import { useEffect, useRef, useState } from 'react';
import { LockSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useCheckout, PaymentElement } from '@stripe/react-stripe-js/checkout';
import { useCheckoutElementAutofocus } from './useCheckoutElementAutofocus';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { useVatInvoiceForm } from '../hooks/useVatInvoiceForm';
import { VatInvoiceFieldsMolecule } from './VatInvoiceFields.molecule';
import {
  CheckoutStatusActionsMolecule,
  CheckoutStatusViewMolecule,
} from './CheckoutStatusView.molecule';
import { PlanCheckoutSummaryMolecule } from './PlanCheckoutSummary.molecule';
import type {
  CheckoutFormProps,
  CheckoutFormTranslations,
} from './CheckoutForm.types';
import styles from '../PlanCheckoutPanel.module.css';

export type { CheckoutFormTranslations };

// confirm() normally hands off to a Stripe redirect within a couple of seconds.
// First watchdog: if confirm() neither resolves nor rejects within this window,
// the network is stalled mid-confirm — surface a recoverable view (retry/close)
// instead of trapping the user on a permanent "processing" spinner with no exit.
const CONFIRM_STALL_MS = 20_000;
// Second watchdog: confirm() returned success but the post-success navigation
// never landed (slow Android WebView / blocked redirect). Neutral "still
// processing" note — the payment likely went through; only nav is slow.
const REDIRECT_OVERDUE_MS = 15_000;

export function CheckoutFormMolecule({
  planId,
  billingPeriod,
  showTrialNote,
  onCancel,
  onRetrySession,
  onPaymentInFlightChange,
  onPaymentActiveChange,
  summaryDescribedById,
  tx,
}: CheckoutFormProps) {
  const checkoutState = useCheckout();
  // Faktura VAT — switch „Faktura na firmę" + subform (stan/walidacja/zapis w hooku).
  const vat = useVatInvoiceForm();
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Error-shake na „Zapłać" (ButtonAtom `shake`), wyzwalany przy setConfirmError(błąd).
  const [shake, setShake] = useState(false);
  // confirm() returned success — the redirect is now in flight. This is the ONLY
  // flag that hard-blocks dismissal (Cancel / Escape / backdrop): once the
  // payment is confirmed the user must not be able to abandon the modal. During
  // the pre-success network call dismissal stays allowed (Cancel re-enabled) so a
  // stalled request never traps the user.
  const [redirectInFlight, setRedirectInFlight] = useState(false);
  // Post-success redirect overdue (redirect watchdog fired). confirm() already
  // returned success — the payment likely went through and only the navigation is
  // slow (common on Android WebView). NOT a failure: show a neutral note and
  // never re-arm "pay" (a second confirm() on a confirmed session just errors).
  const [timedOut, setTimedOut] = useState(false);
  // confirm() network call stalled past its grace window (neither resolved nor
  // rejected). Recoverable: re-enable Cancel + offer Retry. NOT terminal — if the
  // original call later resolves it is still honoured (stale-generation guarded).
  const [stalled, setStalled] = useState(false);

  // Synchronous re-entry guard: `confirming` state lags a render behind a rapid
  // double-tap; the ref closes that window so confirm() never fires twice.
  const confirmingRef = useRef(false);
  // Monotonic attempt id. A stalled confirm() that resolves AFTER the user has
  // retried (or closed) must be ignored — we compare the resolution's generation
  // against the live one so only the latest attempt can mutate state / navigate.
  const attemptRef = useRef(0);
  // Active watchdog timer (stall OR redirect-overdue, never both at once).
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mounted guard. Cancel stays ENABLED during the pre-success confirm() (a stall
  // must never trap the user), so the parent dialog can unmount this form while
  // confirm() is still awaiting. The attempt-generation guard does NOT catch that
  // — attemptRef survives unmount — so a resolution landing post-unmount would
  // setState on a dead component AND arm the redirect watchdog AFTER the unmount
  // cleanup already cleared it (an orphaned timer). This ref bails those paths.
  const mountedRef = useRef(true);

  const clearWatchdog = () => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  // Mirror the dismissal-blocking phase to the parent dialog. Only
  // `redirectInFlight` (confirmed success → navigation pending) hard-blocks
  // dismissal; a stalled-but-recoverable confirm leaves the modal closable.
  useEffect(() => {
    onPaymentInFlightChange?.(redirectInFlight);
  }, [redirectInFlight, onPaymentInFlightChange]);

  // Broader "payment attempt committed" signal for the onboarding FREE escape
  // (confirming covers the pre-success window the dialog's dismiss-guard leaves
  // open). `confirming` stays true through a stall, so the escape also hides
  // while a stalled confirm is still in the background — correct: the payment
  // may still land.
  useEffect(() => {
    onPaymentActiveChange?.(confirming || redirectInFlight);
  }, [confirming, redirectInFlight, onPaymentActiveChange]);

  // Cleanup on unmount (the normal success case navigates away before the
  // redirect watchdog fires; also covers an early Cancel during stall). Releases
  // any "in flight" lock the parent holds so it is never stranded mid-phase.
  useEffect(
    () => {
      // Re-assert on (re-)mount so dev StrictMode's mount→unmount→mount leaves the
      // surviving instance flagged mounted.
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        clearWatchdog();
        onPaymentInFlightChange?.(false);
      };
    },
    // Unmount-only cleanup; onPaymentInFlightChange is a stable parent callback.
    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Autofocus the Payment Element once the embedded form is live (extracted hook;
  // reads the shared checkout context itself).
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
      <CheckoutStatusViewMolecule
        variant='warning'
        role='alert'
        text={tx.initError}>
        <CheckoutStatusActionsMolecule
          retry={
            onRetrySession !== undefined
              ? { label: tx.retry, onClick: onRetrySession }
              : undefined
          }
          cancel={cancelAction}
        />
      </CheckoutStatusViewMolecule>
    );
  }

  // Redirect watchdog tripped after a successful confirm() — the redirect never
  // landed. Neutral terminal view (no "pay" button = no doomed re-confirm).
  // role='status' (not 'alert'): nothing failed, the payment is simply settling.
  if (timedOut) {
    return (
      <CheckoutStatusViewMolecule
        variant='info'
        role='status'
        text={tx.stillProcessing}>
        {/* Exit affordance — block already released (watchdog). No Retry: re-confirm on a paid session errors. */}
        <CheckoutStatusActionsMolecule cancel={cancelAction} />
      </CheckoutStatusViewMolecule>
    );
  }

  const { checkout } = checkoutState;

  const handlePay = async () => {
    if (confirmingRef.current) {
      return;
    }
    // Faktura VAT: walidacja subformu PRZED rozpoczęciem płatności. Błąd → pokaż
    // per-pole komunikaty i NIE wołaj confirm() (VAT i tak doliczony niezależnie).
    if (
      vat.isOn &&
      !vat.validate({
        required: tx.vatFieldRequired,
        postalInvalid: tx.vatPostalCodeInvalid,
        nipInvalid: tx.nipInvalid,
      })
    ) {
      return;
    }
    const attempt = (attemptRef.current += 1);
    confirmingRef.current = true;
    setConfirming(true);
    setConfirmError(null);
    setStalled(false);
    clearWatchdog();
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
      setStalled(true);
    }, CONFIRM_STALL_MS);

    // Faktura VAT (save-przed-confirm): gdy switch ON, zapisz dane firmowe na
    // Stripe Customer ZANIM sfinalizujemy płatność — faktura tworzona przy confirm()
    // musi mieć już name/adres/tax_id. Błąd zapisu → pokaż inline vatSaveError i NIE
    // wołaj confirm(). Stale-generation + unmount guarded (parytet z confirm poniżej).
    if (vat.isOn) {
      try {
        await vat.save();
      } catch {
        if (attempt !== attemptRef.current || !mountedRef.current) {
          return;
        }
        clearWatchdog();
        setStalled(false);
        setConfirmError(tx.vatSaveError);
        confirmingRef.current = false;
        setConfirming(false);
        return;
      }
      // A late resolution after retry/close: ignore (only latest live attempt proceeds).
      if (attempt !== attemptRef.current || !mountedRef.current) {
        return;
      }
    }

    let result: Awaited<ReturnType<typeof checkout.confirm>>;
    try {
      // confirm() finalizes the payment. On success Stripe navigates to the
      // session's return_url (set backend-side) — for redirect methods (BLIK/P24)
      // the browser leaves immediately; for card it resolves here then navigates.
      result = await checkout.confirm();
    } catch {
      // A thrown rejection (network failure mid-confirm, SDK fault) is the same
      // failure class as a resolved {type:'error'} — recover identically. The raw
      // throwable is intentionally NOT surfaced (it may carry English/raw text);
      // the user sees the PL confirmError. Stale-generation AND unmount guarded.
      if (attempt !== attemptRef.current || !mountedRef.current) {
        return;
      }
      clearWatchdog();
      setStalled(false);
      setConfirmError(tx.confirmError);
      setShake(true);
      confirmingRef.current = false;
      setConfirming(false);
      return;
    }

    // A late resolution after the user retried (or closed the dialog): ignore —
    // only the latest attempt on a still-mounted form may mutate state or kick off
    // navigation (mountedRef closes the unmount window attemptRef can't see).
    if (attempt !== attemptRef.current || !mountedRef.current) {
      return;
    }
    clearWatchdog();

    if (result.type === 'error') {
      // NEVER render Stripe's raw error.message (often English / raw API copy in
      // a fully-Polish UI). Show the PL confirmError; log the raw text for
      // diagnostics only. (code/declineCode → dedicated PL strings would need new
      // i18n keys; the generic PL line is correct for every case today.)
      if (result.error.message != null && result.error.message !== '') {
        console.warn('[checkout] confirm failed:', result.error.message);
      }
      setStalled(false);
      setConfirmError(tx.confirmError);
      setShake(true);
      confirmingRef.current = false;
      setConfirming(false);
      return;
    }

    // Success path: the redirect is in flight. Keep the button disabled AND
    // hard-block dismissal (redirectInFlight) until navigation completes. If the
    // stall watchdog had already flipped us to the recoverable view, recover from
    // it — the payment actually succeeded. Re-arm a redirect-overdue watchdog so a
    // navigation that never lands degrades to a neutral note instead of a
    // permanent spinner (a re-confirm on a confirmed session would just error).
    setStalled(false);
    setRedirectInFlight(true);
    watchdogRef.current = setTimeout(() => {
      // Do NOT surface confirmError — confirm() succeeded; re-enabling "pay" would
      // push a doomed re-confirm on an already-paid session. RELEASE the dismissal
      // block: redirect overshot its window but the session is PAID (webhook = SSOT),
      // so a non-dismissable modal would trap the user (blocked Android WebView
      // redirect → app-restart as only exit). timedOut Cancel/Escape now exit safely.
      setRedirectInFlight(false);
      setTimedOut(true);
    }, REDIRECT_OVERDUE_MS);
  };

  // Recoverable stall: confirm() is still pending in the background but the user
  // is no longer trapped. Offer Retry (new attempt; the stale one is ignored on
  // resolution) and Cancel (close the dialog). role='status' — not a hard failure.
  if (stalled) {
    return (
      <CheckoutStatusViewMolecule
        variant='info'
        role='status'
        text={tx.stillProcessing}>
        <CheckoutStatusActionsMolecule
          retry={{ label: tx.retry, onClick: () => void handlePay() }}
          retryVariant='primary'
          cancel={cancelAction}
        />
      </CheckoutStatusViewMolecule>
    );
  }

  // Disable Cancel only while the confirmed-success redirect is settling — never
  // during the bare network call (a stall must stay escapable). Dismissal blocking
  // (Escape/backdrop) is mirrored to the parent via onPaymentInFlightChange.
  const dismissDisabled = redirectInFlight;
  // Text for the always-mounted polite live region: drives SR announcement on
  // transitions WITHOUT mounting/unmounting role nodes (which SRs routinely miss).
  // Empty string => nothing to announce.
  const statusLiveText = confirming || redirectInFlight ? tx.processing : '';

  return (
    <div className={styles.panel}>
      <PlanCheckoutSummaryMolecule
        planId={planId}
        billingPeriod={billingPeriod}
        netFormatted={checkout.total.subtotal.amount}
        vatFormatted={checkout.total.taxExclusive.amount}
        grossFormatted={checkout.total.total.amount}
        showTrialNote={showTrialNote}
        summaryDescribedById={summaryDescribedById}
        tx={tx}
      />

      <div className={styles.paymentElementHost}>
        <PaymentElement />
      </div>

      <VatInvoiceFieldsMolecule
        isOn={vat.isOn}
        onToggle={vat.setIsOn}
        form={vat.form}
        errors={vat.errors}
        onFieldChange={vat.setField}
        disabled={confirming}
        tx={tx}
      />

      {/* Stable, always-mounted live regions: branches change their TEXT, never
          mount/unmount role nodes (early-return role=status/alert nodes are
          routinely missed by screen readers). polite = progress, assertive =
          failure. visually-hidden but in the a11y tree. */}
      <p className={styles.srStatus} role='status' aria-live='polite'>
        {statusLiveText}
      </p>
      <p className={styles.srStatus} role='alert' aria-live='assertive'>
        {confirmError ?? ''}
      </p>

      {confirmError !== null && (
        <div className={styles.inlineError} aria-hidden='true'>
          <WarningCircleIcon
            size={18}
            weight='fill'
            className={styles.inlineErrorIcon}
            aria-hidden='true'
          />
          <span>{confirmError}</span>
        </div>
      )}

      <div className={styles.actions}>
        <ButtonAtom
          variant='primary'
          size='lg'
          className={styles.payBtn}
          onClick={() => void handlePay()}
          disabled={confirming}
          aria-busy={confirming}
          shake={shake}
          onShakeEnd={() => setShake(false)}
          loading={confirming}>
          {confirming ? tx.processing : tx.payNow}
        </ButtonAtom>

        {onCancel !== undefined && (
          <ButtonAtom
            variant='text'
            size='md'
            className={styles.cancelBtn}
            onClick={onCancel}
            disabled={dismissDisabled}>
            {tx.cancel}
          </ButtonAtom>
        )}

        <p className={styles.secureHint}>
          <LockSimpleIcon
            size={13}
            weight='fill'
            className={styles.secureHintIcon}
            aria-hidden='true'
          />
          {tx.secureHint}
        </p>
      </div>
    </div>
  );
}
