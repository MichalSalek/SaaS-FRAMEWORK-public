// UI/features/account/hooks/useAccountPayActions.ts
//
// SPE (W5): the account-pay action layer. Encapsulates the plan-change funnel
// (FREE→paid embedded checkout, paid→paid quick change with inline SCA, the
// billing portal redirect, and the downgrade-warning gate) so the page
// composition stays a thin renderer under the 300 LOC ceiling.
//
// Routing of intent (single entry point `selectPlan`):
//   FREE → paid : open the embedded checkout dialog (new subscription / trial).
//   paid → paid : quick plan change (one-tap proration + inline SCA), with a
//                 downgrade-warning gate when the target sits lower in the tier.
//   "manage"    : redirect to the Stripe billing portal (full self-service).

import { useEffect, useRef, useState } from 'react';
import posthog from 'posthog-js';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { isPlanDowngrade } from '@kernel/domain/pricing/pricing-policy';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { isIOError } from '../../../../application/http/io';
import { createPortalSession_IO } from '../../../../domain/account/accountIO.possibilities.api';
import { usePlanChange } from './usePlanChange';

interface UseAccountPayActionsArgs {
  currentPlan: PricingPlan;
  billingPeriod: BillingPeriod;
}

export interface AccountPayActions {
  /** Any action (plan-change OR portal) is in flight — gates the whole grid. */
  busy: boolean;
  /** The plan whose card is currently spinning (in-flight change / open dialog). */
  pendingPlan: PricingPlan | null;
  /** Portal redirect in flight (drives the "manage billing" spinner). */
  openingPortal: boolean;
  /** The last plan change failed for this plan; cleared by the next action.
   *  The card of that plan says so under its button: the toast alone is gone
   *  in a few seconds and far from the finger (S126). */
  failedPlan: PricingPlan | null;
  /** The billing portal did not open; cleared by the next action. */
  portalFailed: boolean;
  /** FREE → paid: the plan whose embedded checkout dialog is open (null = closed). */
  checkoutPlan: PricingPlan | null;
  /** Pending downgrade awaiting confirmation (null = no warning shown). */
  downgradeTarget: PricingPlan | null;
  /** Single entry point from the plan cards. */
  selectPlan: (planId: PricingPlan) => void;
  /** Redirect to the Stripe billing portal (full management). */
  openBillingPortal: () => void;
  checkoutClose: () => void;
  confirmDowngrade: () => void;
  cancelDowngrade: () => void;
}

// Portal redirect watchdog (parity with PlanCheckoutPanel's HOSTED_NAV_GRACE_MS):
// window.location.assign() returns immediately and the page should unload. If it
// does not (redirect blocked, sandboxed WebView) we are still mounted — the flag
// must be released, otherwise `openingPortal` gates `busy` forever and freezes
// the whole plan grid on an eternal spinner.
const PORTAL_NAV_GRACE_MS = 4_000;

export function useAccountPayActions({
  currentPlan,
  billingPeriod,
}: UseAccountPayActionsArgs): AccountPayActions {
  const planChange = usePlanChange();
  const [pendingPlan, setPendingPlan] = useState<PricingPlan | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [failedPlan, setFailedPlan] = useState<PricingPlan | null>(null);
  const [portalFailed, setPortalFailed] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<PricingPlan | null>(null);
  const [downgradeTarget, setDowngradeTarget] = useState<PricingPlan | null>(
    null
  );
  const portalWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (portalWatchdogRef.current !== null) {
        clearTimeout(portalWatchdogRef.current);
      }
    },
    []
  );

  const busy = pendingPlan !== null || openingPortal;

  // Portal — full self-service management (cancel, invoices, card). Stays a
  // redirect; NOT the quick-upgrade path anymore.
  const openBillingPortal = (): void => {
    if (busy) {
      return;
    }
    // Churn-intent proxy (ANALYTICS_TRACKING_PLAN §3): anulowanie subskrypcji
    // NIE ma in-app flow — kanoniczna ścieżka to hostowany Stripe billing
    // portal, więc to wejście jest jedynym mierzalnym sygnałem cancel-intent
    // po stronie frontu (powody anulowania zbiera Stripe). Poprzedzający
    // downgrade_confirmed z target_plan=FREE rozróżnia intent "cancel" od
    // zwykłego "manage". Singleton respektuje opt-out.
    posthog.capture('billing_portal_opened', { current_plan: currentPlan });
    setFailedPlan(null);
    setPortalFailed(false);
    setOpeningPortal(true);
    void (async () => {
      try {
        const { url } = await createPortalSession_IO(undefined);
        // Guard: portal url bywa pusty mimo że DTO deklaruje string —
        // chronimy przed window.location.assign(undefined).
        if (url && typeof window !== 'undefined') {
          window.location.assign(url);
          // assign() returns immediately; the page should unload. If we are
          // still mounted after the grace window the redirect was blocked —
          // release the flag (unfreezes the grid, CTA becomes a retry) and
          // surface an error toast (same class as PlanCheckoutPanel's
          // hosted_fallback watchdog).
          if (portalWatchdogRef.current !== null) {
            clearTimeout(portalWatchdogRef.current);
          }
          portalWatchdogRef.current = setTimeout(() => {
            setOpeningPortal(false);
            setPortalFailed(true);
            pushNewSnackbar(APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, 'error');
          }, PORTAL_NAV_GRACE_MS);
        } else if (!url) {
          setOpeningPortal(false);
          setPortalFailed(true);
          pushNewSnackbar(APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, 'error');
        }
      } catch (e) {
        setOpeningPortal(false);
        setPortalFailed(true);
        // DECISION (nie usuwaj tego komentarza):
        // createPortalSession_IO failure round-trips the HTTP interceptor
        // (event-bus Stage 1), które już pokazało snackbar (backend event na
        // błędzie HTTP / INTERNET_CONNECTION_PROBLEM na sieci). Lokalny push
        // odpalamy tylko dla client-side throw, który NIE przeszedł przez
        // interceptor — inaczej double-toast. Spinner-reset zostaje bezwarunkowo.
        if (!isIOError(e)) {
          pushNewSnackbar(APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, 'error');
        }
      }
    })();
  };

  // paid → paid: card on file, one-tap proration (+ inline SCA inside the hook).
  const executePlanChange = (planId: PricingPlan): void => {
    if (busy) {
      return;
    }
    setFailedPlan(null);
    setPortalFailed(false);
    setPendingPlan(planId);
    planChange.mutate(
      { targetPlanId: planId, billingPeriod },
      {
        onSuccess: () => {
          setPendingPlan(null);
          pushNewSnackbar(
            APP_EVENTS.INFO.ACCOUNT.PRICING_PLAN_CHANGED,
            'success'
          );
        },
        // Error toast is owned by usePlanChange; just clear the spinner.
        onError: () => {
          setPendingPlan(null);
          setFailedPlan(planId);
        },
      }
    );
  };

  const selectPlan = (planId: PricingPlan): void => {
    if (busy || planId === currentPlan) {
      return;
    }
    if (currentPlan === PricingPlanValue.FREE) {
      setCheckoutPlan(planId);
      setPendingPlan(planId);
      return;
    }
    // Downgrade direction from the kernel tier order (SSOT), not the runtime
    // plans array — same decision, one source.
    if (isPlanDowngrade(currentPlan, planId)) {
      setDowngradeTarget(planId);
      return;
    }
    executePlanChange(planId);
  };

  // Brak `checkoutSuccess`: dialog obsługuje WYŁĄCZNIE Free→paid, a jedyną
  // gałęzią panelu, która woła onSuccess, jest `free_selected` — nieosiągalna
  // tutaj (selectPlan odrzuca planId === currentPlan, więc Free nigdy nie
  // „wybiera Free"). Płatny checkout kończy się redirectem Stripe na stronę
  // powrotu, nie callbackiem.
  const checkoutClose = (): void => {
    setCheckoutPlan(null);
    setPendingPlan(null);
  };

  const confirmDowngrade = (): void => {
    if (downgradeTarget !== null) {
      const target = downgradeTarget;
      setDowngradeTarget(null);
      // Para do downgrade_warning_shown (DowngradeWarningDialog): shown bez
      // confirmed = retention save (dialog N10 loss-aversion zadziałał).
      posthog.capture('downgrade_confirmed', {
        current_plan: currentPlan,
        target_plan: target,
      });
      // DECISION (nie usuwaj tego komentarza):
      // Downgrade do FREE NIE idzie przez POST /account/plan-change. Backend
      // resolveCheckoutPrice_IO nie ma ceny Stripe dla FREE (CHECKOUT_PLAN_NOT_FOUND
      // → 400 CANNOT_MAKE_PAYMENT), a error-mapper przy CHECKOUT_FREE_PLAN_CONFLICT
      // jawnie mówi "downgrade must go through portal/cancel". Kanoniczna ścieżka:
      // Stripe billing portal → anulowanie subskrypcji → subskrypcja wygasa z
      // końcem opłaconego okresu → webhook zdejmuje plan do FREE. Dlatego
      // potwierdzony downgrade z targetem FREE przekierowuje do portalu zamiast
      // strzelać w plan-change (który był dead-endem: zawsze 400). Downgrade
      // paid→paid zostaje na plan-change (subscription.update z proracją).
      if (target === PricingPlanValue.FREE) {
        openBillingPortal();
        return;
      }
      executePlanChange(target);
    }
  };

  const cancelDowngrade = (): void => {
    setDowngradeTarget(null);
  };

  return {
    busy,
    pendingPlan,
    openingPortal,
    failedPlan,
    portalFailed,
    checkoutPlan,
    downgradeTarget,
    selectPlan,
    openBillingPortal,
    checkoutClose,
    confirmDowngrade,
    cancelDowngrade,
  };
}
