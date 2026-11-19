import { useEffect, useRef, useState } from 'react';
import { clearCheckoutWatchdog } from './checkout-pay.helpers';
import { useCheckoutUnmountRelease } from './useCheckoutUnmountRelease';
import type { CheckoutFormProps } from './CheckoutForm.types';
export function useCheckoutAttemptState(
  taxPortalBusy: boolean,
  onPaymentInFlightChange: CheckoutFormProps['onPaymentInFlightChange'],
  onPaymentActiveChange: CheckoutFormProps['onPaymentActiveChange']
) {
  const [appliedCompany, setAppliedCompany] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Error shake on „Zapłać" (ButtonAtom `shake`), triggered on setConfirmError(error).
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
  // rejected). Recoverable: re-enable Cancel and offer an owned result check. NOT terminal — if the
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
  const clearWatchdog = () => clearCheckoutWatchdog(watchdogRef);
  const releaseAttempt = () => {
    clearWatchdog();
    setStalled(false);
    confirmingRef.current = false;
    setConfirming(false);
  };
  // Mirror handoff locks to the surrounding decision screen. Keep a bare,
  // recoverable confirm escapable; both a confirmed redirect and the tax-portal
  // handoff block Back, exactly as the form's own Cancel does.
  useEffect(() => {
    onPaymentInFlightChange?.(redirectInFlight || taxPortalBusy);
  }, [redirectInFlight, taxPortalBusy, onPaymentInFlightChange]);
  // Broader "payment attempt committed" signal for the onboarding FREE escape
  // (confirming covers the pre-success window the dialog's dismiss-guard leaves
  // open). `confirming` stays true through a stall, so the escape also hides
  // while a stalled confirm is still in the background — correct: the payment
  // may still land.
  useEffect(() => {
    onPaymentActiveChange?.(confirming || redirectInFlight || taxPortalBusy);
  }, [confirming, redirectInFlight, taxPortalBusy, onPaymentActiveChange]);
  // Cleanup on unmount: releases any "in flight" lock the parent holds.
  useCheckoutUnmountRelease(mountedRef, clearWatchdog, onPaymentInFlightChange);
  return {
    appliedCompany,
    setAppliedCompany,
    confirming,
    setConfirming,
    confirmError,
    setConfirmError,
    shake,
    setShake,
    redirectInFlight,
    setRedirectInFlight,
    timedOut,
    setTimedOut,
    stalled,
    setStalled,
    confirmingRef,
    attemptRef,
    watchdogRef,
    mountedRef,
    clearWatchdog,
    releaseAttempt,
  };
}
