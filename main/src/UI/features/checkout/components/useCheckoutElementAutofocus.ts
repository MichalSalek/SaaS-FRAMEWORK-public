import { useEffect, useRef } from 'react';
import { useCheckout } from '@stripe/react-stripe-js/checkout';

/**
 * Land focus inside the dialog once the embedded Payment Element is live.
 *
 * The focus-trap fires `initialFocus` while the panel is still its "preparing"
 * spinner (no focusable content), so focus parks on the container — keyboard / SR
 * users never enter the form. When the Stripe surface is ready, focus the Payment
 * Element's first field (native `.focus()`, on 'ready' so the iframe accepts it).
 * Once only — a re-render must never steal focus from a user mid-typing.
 *
 * Extracted from CheckoutForm to keep that component under the max-lines ceiling.
 * Reads the live checkout via its own `useCheckout()` (shared context — same value
 * the form sees), so the caller passes nothing.
 */
export function useCheckoutElementAutofocus(): void {
  // DECISION: React Compiler opt-out for this function. The effect below omits stable or
  // config dependencies on purpose (`react-hooks/exhaustive-deps` is off for this file in
  // eslint.config.mjs); the directive keeps the compiler from memoizing around that omission,
  // as the former inline lint suppression did.
  'use no memo';
  const checkoutState = useCheckout();
  const checkoutReady = checkoutState.type === 'success';
  const checkoutApi = checkoutReady ? checkoutState.checkout : null;
  const didAutofocusRef = useRef(false);
  useEffect(() => {
    if (!checkoutReady || checkoutApi === null || didAutofocusRef.current) {
      return;
    }
    const paymentElement = checkoutApi.getPaymentElement();
    if (paymentElement === null) {
      return;
    }
    didAutofocusRef.current = true;
    // focus() is a no-op until the iframe is ready and harmless when repeated, so it is safe
    // to attempt from BOTH the 'ready' event (covers not-yet-ready) and a delayed
    // frame (covers a 'ready' that fired before this effect attached). Only focus
    // while focus still sits on the dialog chrome (container / backdrop / body) —
    // never yank it back from a user who already tabbed into a field.
    const focusIfIdle = () => {
      const active = document.activeElement;
      const onChrome =
        active === null ||
        active === document.body ||
        active.getAttribute('role') === 'dialog' ||
        active.getAttribute('role') === 'presentation';
      if (onChrome) {
        // Stripe throws `IntegrationError: This Element has already been destroyed` when focus() hits
        // an element after its destroy — dev StrictMode re-mounts the panel and destroys the first
        // element, and a deferred focus (once('ready') / rAF) can arrive AFTER that destroy; in prod the
        // same can happen if the user closes the panel („Zmień plan"/unmount) in the same frame.
        // Autofocus is best-effort a11y — a destroyed element is skipped silently instead of letting
        // an Uncaught error reach the console.
        try {
          paymentElement.focus();
        } catch {
          /* element destroyed (unmount/StrictMode) — best-effort autofocus, skip */
        }
      }
    };
    paymentElement.once('ready', focusIfIdle);
    const frame = requestAnimationFrame(focusIfIdle);
    return () => {
      cancelAnimationFrame(frame);
      paymentElement.off('ready', focusIfIdle);
    };
    // Ready-transition only; getPaymentElement is stable per session.
  }, [checkoutReady]);
}
