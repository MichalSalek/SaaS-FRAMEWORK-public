// UI/features/checkout/PlanCheckoutPanel.organism.tsx
//
// SPE (W2): the single reusable embedded-checkout organism. Used in BOTH the
// onboarding flow and the account-pay upgrade flow (`mode` prop). On mount it
// asks the backend to mint a Checkout Session for {planId, billingPeriod} and
// then switches on the discriminated CheckoutSessionResponse:
//
//   free_selected     → no Stripe at all → invalidate account + onSuccess().
//   checkout_elements  → render <StripeCustomCheckoutProvider> + <CheckoutForm>
//                        (embedded PaymentElement, native feel — the whole SPE).
//   hosted_fallback    → controlled redirect to hosted Stripe Checkout.
//
// DECISION (nie usuwaj tego komentarza):
// `useSelectPlan` was folded into `usePlanCheckout` — `free_selected` is just a
// `mode` branch of the SAME /checkout-session mutation, so a second hook would
// duplicate transport (rule-of-three: one call site, no abstraction yet).
//
// Stack: TQ v5 + @stripe/react-stripe-js/checkout + CSS Modules + Phosphor.

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleNotchIcon, WarningCircleIcon } from '@phosphor-icons/react';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { canStartTrial as canStartTrialPolicy } from '@kernel/domain/pricing/pricing-policy';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { usePlanCheckout } from './hooks/usePlanCheckout';
import { StripeCustomCheckoutOrganism } from './StripeCustomCheckout.organism';
import {
  CheckoutFormMolecule,
  type CheckoutFormTranslations,
} from './components/CheckoutForm.molecule';
import styles from './PlanCheckoutPanel.module.css';

type PlanCheckoutMode = 'onboarding' | 'account-pay';

export interface PlanCheckoutPanelTranslations extends CheckoutFormTranslations {
  /** Status while the Checkout Session is being created. */
  preparing: string;
  /** Error when session creation fails. */
  sessionError: string;
  /** Shown when the server refused `promo` and minted a full-price session. */
  promoInvalid?: string;
  // `retry` lives on CheckoutFormTranslations (the embedded form's stall view
  // reuses it); inherited here for the session-error retry button.
}

interface PlanCheckoutPanelProps {
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  promo?: string;
  mode: PlanCheckoutMode;
  // Only the `free_selected` branch fires this (no argument). The paid
  // `checkout_elements` path resolves via Stripe's redirect to the return page,
  // so there is no sessionId to hand back here — hence the bare `() => void`.
  // Optional: the account-pay dialog is Free→paid only, where `free_selected`
  // is unreachable, so it has nothing to hand back.
  onSuccess?: () => void;
  onCancel?: () => void;
  /**
   * Bubbled from the embedded form: true while a confirmed-success redirect is
   * settling (dismissal must be blocked). Passed straight through to the form;
   * the parent dialog gates Escape / backdrop on it.
   */
  onPaymentInFlightChange?: (inFlight: boolean) => void;
  /**
   * Bubbled "panel is committing" signal for the onboarding shell (findings
   * #1 + #2). True while EITHER a PAID confirm()/redirect is in flight (from the
   * embedded form) OR the FREE `free_selected` mutation is still committing the
   * plan on the backend. The onboarding step gates BOTH its "Zmień plan" link
   * AND the sticky global Back on this, so a payment/activation can never be
   * interrupted mid-flight: a mid-confirm plan switch (or Back) would orphan a
   * succeeding Stripe subscription, and a mid-free-mutation unmount would strand
   * the account with FREE set but no onSuccess/invalidate ever firing.
   */
  onBusyChange?: (busy: boolean) => void;
  /** id for the order-summary total, wired to the dialog's aria-describedby. */
  summaryDescribedById?: string;
  tx: PlanCheckoutPanelTranslations;
}

// hosted_fallback redirect: window.location.assign() returns immediately and the
// page should unload. If it does not (popup/redirect blocked, sandboxed context)
// within this grace window we are still mounted → surface the error/retry view
// instead of a hanging "preparing" spinner (parity with the embedded path).
const HOSTED_NAV_GRACE_MS = 4_000;

export function PlanCheckoutPanelOrganism({
  planId,
  billingPeriod,
  promo,
  mode,
  onSuccess,
  onCancel,
  onPaymentInFlightChange,
  onBusyChange,
  summaryDescribedById,
  tx,
}: PlanCheckoutPanelProps) {
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUserAccount();
  const checkout = usePlanCheckout();
  const { mutate } = checkout;

  // Findings #1/#2 — a single "panel busy" signal surfaced to the onboarding
  // shell. PAID: confirm()/redirect in flight, bubbled from the embedded form
  // into `paidActive`. FREE: the `free_selected` mutation is committing the plan
  // (or about to — locked from mount until it resolves), so leaving now would
  // unmount before onSuccess invalidates + advances. A PAID session-mint is NOT
  // busy (nothing committed yet), hence the free lock is scoped to planId ===
  // FREE and released only on the error/retry view (`checkout.isError`).
  const [paidActive, setPaidActive] = useState(false);
  const freeBusy = planId === PricingPlanValue.FREE && !checkout.isError;
  const busy = paidActive || freeBusy;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  // Release the parent's lock if we unmount while still busy (success navigates
  // the whole step away mid-busy) so the sticky Back is never left disabled.
  // Dep [onBusyChange] zamiast wyłączania reguły exhaustive-deps
  // (react-compiler odmawia optymalizacji komponentu z wyłączoną regułą React):
  // przy zmianie identity callbacka cleanup(false) odpala się PRZED re-runem
  // efektu [busy, onBusyChange] wyżej, który natychmiast przywraca właściwy
  // stan — netto identycznie jak unmount-only, bez łamania reguł.
  useEffect(
    () => () => {
      onBusyChange?.(false);
    },
    [onBusyChange]
  );
  // hosted_fallback redirect failed (assign threw, or the page never unloaded).
  // Drives the same error/retry view as a failed session mint.
  const [navFailed, setNavFailed] = useState(false);
  const navWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (navWatchdogRef.current !== null) {
        clearTimeout(navWatchdogRef.current);
      }
    },
    []
  );

  // Trial-eligible (kernel SSOT) AND a paid plan → reassure the buyer the card
  // is only charged after the trial. FREE plan never has a trial note.
  const isTrialClaim =
    planId !== PricingPlanValue.FREE &&
    canStartTrialPolicy({
      trialStartedAt: user?.stylist_account?.trial_started_at,
      paymentStatus: user?.stylist_account?.payment_status,
    });

  // Mint the Checkout Session once on mount (and when the plan/cycle changes).
  // A ref de-dupes so we never POST two sessions for the same selection.
  // `retryNonce` lets the retry button force the effect to re-run (the ref is
  // not a dependency, so clearing it alone would never re-fire — the nonce in
  // the dep array does).
  //
  // DECISION (nie usuwaj tego komentarza):
  // The mutate() is deferred by a macrotask (setTimeout 0) and CANCELLED by the
  // effect cleanup. React 18/19 dev StrictMode double-invokes this effect
  // (mount → cleanup → mount) on a TRANSIENT instance that is discarded
  // immediately. A mutate() fired SYNCHRONOUSLY on that transient mount resolves
  // against an unmounted mutation observer (TQ v5 drops the scoped callbacks +
  // the state transition on unmount), so the SURVIVING instance's panel is
  // stranded on the "preparing" spinner forever even though the POST returned
  // 200 — a dev-only hang, same class as the pairing-claim StrictMode fix (S41).
  // Scheduling on a timer that the cleanup clears means the transient mount's
  // fire is cancelled and ONLY the surviving mount ever mutates, on a LIVE
  // observer. `requestedKey` is set INSIDE the timer so a cancelled transient
  // run never latches the key and blocks the survivor.
  const requestedKey = useRef<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  useEffect(() => {
    const key = `${planId}:${billingPeriod}:${promo ?? ''}`;
    if (requestedKey.current === key) {
      return;
    }
    const timer = setTimeout(() => {
      requestedKey.current = key;
      mutate(
        {
          planId,
          billingPeriod,
          source: mode,
          ...(promo ? { promo } : {}),
        },
        {
          onSuccess: response => {
            switch (response.mode) {
              case 'free_selected':
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.account.current,
                });
                // Plan limits changed → usage-vs-limit stats must re-derive.
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.account.usageStats,
                });
                onSuccess?.();
                return;
              case 'checkout_elements':
                // Rendered below via `checkout.data` — nothing to do here.
                return;
              case 'hosted_fallback':
                if (typeof window !== 'undefined') {
                  try {
                    window.location.assign(response.url);
                  } catch {
                    // assign() can throw in sandboxed / locked-down contexts.
                    setNavFailed(true);
                    return;
                  }
                  // assign() returns immediately; the page should unload. If we are
                  // still mounted after the grace window the redirect was blocked —
                  // surface the error/retry view (no hanging "preparing" spinner).
                  if (navWatchdogRef.current !== null) {
                    clearTimeout(navWatchdogRef.current);
                  }
                  navWatchdogRef.current = setTimeout(() => {
                    setNavFailed(true);
                  }, HOSTED_NAV_GRACE_MS);
                } else {
                  // No window (SSR / non-browser) → cannot redirect at all.
                  setNavFailed(true);
                }
                return;
              default: {
                const _exhaustive: never = response;
                return _exhaustive;
              }
            }
          },
        }
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [
    planId,
    billingPeriod,
    promo,
    mode,
    mutate,
    onSuccess,
    queryClient,
    retryNonce,
  ]);

  const handleRetry = () => {
    requestedKey.current = null;
    if (navWatchdogRef.current !== null) {
      clearTimeout(navWatchdogRef.current);
      navWatchdogRef.current = null;
    }
    setNavFailed(false);
    checkout.reset();
    setRetryNonce(n => n + 1);
  };

  /* ── Error — session creation failed, OR a hosted-redirect that never landed ── */
  if (checkout.isError || navFailed) {
    return (
      <div className={styles.statusViewport} role='alert'>
        <WarningCircleIcon
          size={32}
          weight='duotone'
          className={styles.inlineErrorIcon}
          aria-hidden='true'
        />
        <p className={styles.statusText}>{tx.sessionError}</p>
        <ButtonAtom variant='outlined' onClick={handleRetry}>
          {tx.retry}
        </ButtonAtom>
      </div>
    );
  }

  /* ── Embedded checkout surface (the SPE happy path) ── */
  if (checkout.isSuccess && checkout.data.mode === 'checkout_elements') {
    return (
      <StripeCustomCheckoutOrganism clientSecret={checkout.data.clientSecret}>
        {checkout.data.promoRejected && tx.promoInvalid ? (
          <p className={styles.statusText} role='status'>
            {tx.promoInvalid}
          </p>
        ) : null}
        <CheckoutFormMolecule
          planId={planId}
          billingPeriod={billingPeriod}
          showTrialNote={isTrialClaim}
          onCancel={onCancel}
          onRetrySession={handleRetry}
          onPaymentInFlightChange={onPaymentInFlightChange}
          onPaymentActiveChange={setPaidActive}
          summaryDescribedById={summaryDescribedById}
          tx={tx}
        />
      </StripeCustomCheckoutOrganism>
    );
  }

  /* ── Preparing — creating session, or free/hosted resolving (redirect/onSuccess
        already fired in onSuccess; we keep a spinner until navigation/unmount) ── */
  return (
    <div className={styles.statusViewport} role='status'>
      <CircleNotchIcon
        size={32}
        className={`${styles.statusIcon} ${styles.spinner}`}
        aria-hidden='true'
      />
      <p className={styles.statusText}>{tx.preparing}</p>
    </div>
  );
}
