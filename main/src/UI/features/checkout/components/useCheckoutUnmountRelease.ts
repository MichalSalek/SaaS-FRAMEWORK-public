import { useEffect, type RefObject } from 'react';

/**
 * Unmount-only cleanup of CheckoutFormMolecule.
 */
export function useCheckoutUnmountRelease(
  mountedRef: RefObject<boolean>,
  clearWatchdog: () => void,
  onPaymentInFlightChange: ((inFlight: boolean) => void) | undefined
): void {
  // DECISION: the effect below runs on mount and unmount only, on purpose: `clearWatchdog` touches
  // only a ref and `onPaymentInFlightChange` is a stable parent callback, so re-running it would
  // release the parent's lock mid-payment. This file is the one place
  // `react-hooks/exhaustive-deps` is off for it (main/eslint.config.mjs), and 'use no memo' keeps
  // the React Compiler from compiling around the omission.
  'use no memo';
  // Cleanup on unmount (the normal success case navigates away before the
  // redirect watchdog fires; also covers an early Cancel during stall). Releases
  // any "in flight" lock the parent holds so it is never stranded mid-phase.
  useEffect(() => {
    // Re-assert on (re-)mount so dev StrictMode's mount→unmount→mount leaves the
    // surviving instance flagged mounted.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearWatchdog();
      onPaymentInFlightChange?.(false);
    };
  }, []);
}
