// UI/features/account/hooks/useAccountPayActions.ts
//
// The account-pay action layer. Encapsulates the plan-change funnel
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
import { capturePosthog } from '../../../../application/analytics/posthog-client';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
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
import { savePurchaseChangeProof } from '../../../../application/client-device-storage/purchase-change-proof';
import {
  bindPurchaseResumeSession,
  readPurchaseResume,
} from '../../../../application/client-device-storage/purchase-resume';

interface UseAccountPayActionsArgs {
  currentPlan: PricingPlan;
  billingPeriod: BillingPeriod;
  currentBillingPeriod?: BillingPeriod | null;
  identity?: { userId: string; accountId: string };
}

export interface AccountPayActions {
  /** Any action (plan-change OR portal) is in flight — gates the whole grid. */
  busy: boolean;
  /** The plan whose card is currently spinning (in-flight change / open dialog). */
  pendingPlan: PricingPlan | null;
  /** Portal redirect in flight (drives the "manage billing" spinner). */
  openingPortal: boolean;
  /** The last plan change failed for this plan; cleared by the next action.
   *  The card of that plan says so under its button: the toast alone is gone in a few seconds and
   *  far from the finger. */
  failedPlan: PricingPlan | null;
  failedQuoteId: string | null;
  /** The billing portal did not open; cleared by the next action. */
  portalFailed: boolean;
  /** Confirmed mutation whose result page could not be opened. Never repeat payment. */
  changeReturnHref: string | null;
  /** FREE → paid: the plan whose embedded checkout dialog is open (null = closed). */
  checkoutPlan: PricingPlan | null;
  /** Pending downgrade awaiting confirmation (null = no warning shown). */
  downgradeTarget: PricingPlan | null;
  upgradeTarget: PricingPlan | null;
  confirmUpgrade: (quoteId?: string) => void;
  cancelUpgrade: () => void;
  /** Single entry point from the plan cards. */
  selectPlan: (planId: PricingPlan) => void;
  /** Redirect to the Stripe billing portal (full management). */
  openBillingPortal: () => void;
  openCancellationPortal: () => void;
  checkoutClose: () => void;
  confirmDowngrade: (quoteId?: string) => void;
  cancelDowngrade: () => void;
}

const PORTAL_NAV_GRACE_MS = 4_000;

export function useAccountPayActions({
  currentPlan,
  billingPeriod,
  currentBillingPeriod = null,
  identity,
}: UseAccountPayActionsArgs): AccountPayActions {
  const planChange = usePlanChange();
  const router = useRouter();
  const locale = useCurrentLang();
  const [pendingPlan, setPendingPlan] = useState<PricingPlan | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [failedPlan, setFailedPlan] = useState<PricingPlan | null>(null);
  const [failedQuoteId, setFailedQuoteId] = useState<string | null>(null);
  const [portalFailed, setPortalFailed] = useState(false);
  const [changeReturnHref, setChangeReturnHref] = useState<string | null>(null);
  const [upgradeTarget, setUpgradeTarget] = useState<PricingPlan | null>(null);
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
  const openBillingPortal = (purpose: 'manage' | 'cancel' = 'manage'): void => {
    if (busy) {
      return;
    }
    // Churn-intent proxy (ANALYTICS_TRACKING_PLAN §3): cancelling has NO in-app flow (the canonical
    // path is the hosted Stripe billing portal), so this entry is the only measurable cancel-intent
    // signal on the front (Stripe collects the reasons). A preceding downgrade_confirmed with
    // target_plan=FREE tells "cancel" from plain "manage". The singleton respects opt-out.
    capturePosthog('billing_portal_opened', { current_plan: currentPlan });
    setFailedPlan(null);
    setPortalFailed(false);
    setOpeningPortal(true);
    void (async () => {
      try {
        const { url } = await createPortalSession_IO({
          purpose,
          locale: locale === 'en' || locale === 'de' ? locale : 'pl',
        });
        // Guard: the portal url can be empty although the DTO declares a string; protects against
        // window.location.assign(undefined).
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
        // DECISION: a createPortalSession_IO failure round-trips the HTTP interceptor (event-bus
        // Stage 1), which already showed the snackbar. The local push fires only for a client-side
        // throw that did NOT go through the interceptor, otherwise it double-toasts. The spinner
        // reset stays unconditional.
        if (!isIOError(e)) {
          pushNewSnackbar(APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, 'error');
        }
      }
    })();
  };

  // paid → paid: card on file, one-tap proration (+ inline SCA inside the hook).
  const executePlanChange = (planId: PricingPlan, quoteId: string): void => {
    if (busy) {
      return;
    }
    setFailedPlan(null);
    setFailedQuoteId(null);
    setPortalFailed(false);
    setChangeReturnHref(null);
    setPendingPlan(planId);
    const resumeAtStart = identity ? readPurchaseResume(identity) : null;
    planChange.mutate(
      { targetPlanId: planId, billingPeriod, quoteId },
      {
        onSuccess: () => {
          setPendingPlan(null);
          setUpgradeTarget(null);
          setDowngradeTarget(null);
          const query = new URLSearchParams({
            change: 'completed',
            plan: planId,
            period: billingPeriod,
          });
          if (identity && typeof globalThis.crypto?.randomUUID === 'function') {
            const nonce = `change_${globalThis.crypto.randomUUID()}`;
            if (
              savePurchaseChangeProof({
                ...identity,
                nonce,
                plan: planId,
                period: billingPeriod,
                createdAt: Date.now(),
              })
            ) {
              query.set('proof', nonce);
              if (resumeAtStart) {
                bindPurchaseResumeSession(identity, resumeAtStart.id, nonce);
              }
            }
          }
          const href = `${ROUTES_FRONT.CHECKOUT_RETURN}?${query}`;
          void router.push(href).then(
            navigated => {
              if (!navigated) {
                setChangeReturnHref(href);
              }
            },
            () => setChangeReturnHref(href)
          );
        },
        // Error toast is owned by usePlanChange; just clear the spinner.
        onError: () => {
          setPendingPlan(null);
          setFailedPlan(planId);
          setFailedQuoteId(quoteId);
        },
      }
    );
  };

  const selectPlan = (planId: PricingPlan): void => {
    if (
      busy ||
      (planId === currentPlan &&
        (currentBillingPeriod === null ||
          billingPeriod === currentBillingPeriod))
    ) {
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
    setUpgradeTarget(planId);
  };

  // No `checkoutSuccess`: the dialog handles ONLY Free→paid, and the only panel branch that calls
  // onSuccess is `free_selected`, unreachable here (selectPlan rejects planId === currentPlan, so Free
  // never "selects Free"). A paid checkout ends in a Stripe redirect to the return page, not a
  // callback.
  const checkoutClose = (): void => {
    setCheckoutPlan(null);
    setPendingPlan(null);
  };

  const confirmDowngrade = (quoteId?: string): void => {
    if (downgradeTarget !== null) {
      const target = downgradeTarget;
      // Pair of downgrade_warning_shown (DowngradeWarningDialog): shown without confirmed = retention
      // save (the loss-aversion dialog worked).
      capturePosthog('downgrade_confirmed', {
        current_plan: currentPlan,
        target_plan: target,
      });

      if (target === PricingPlanValue.FREE) {
        setDowngradeTarget(null);
        openBillingPortal('cancel');
        return;
      }
      if (quoteId) {
        executePlanChange(target, quoteId);
      }
    }
  };

  const cancelDowngrade = (): void => {
    if (!busy) {
      setDowngradeTarget(null);
    }
  };

  return {
    busy,
    pendingPlan,
    openingPortal,
    failedPlan,
    failedQuoteId,
    portalFailed,
    changeReturnHref,
    checkoutPlan,
    downgradeTarget,
    upgradeTarget,
    confirmUpgrade: quoteId => {
      if (upgradeTarget !== null && quoteId) {
        executePlanChange(upgradeTarget, quoteId);
      }
    },
    cancelUpgrade: () => {
      if (!busy) {
        setUpgradeTarget(null);
      }
    },
    selectPlan,
    openBillingPortal: () => openBillingPortal('manage'),
    openCancellationPortal: () => openBillingPortal('cancel'),
    checkoutClose,
    confirmDowngrade,
    cancelDowngrade,
  };
}
