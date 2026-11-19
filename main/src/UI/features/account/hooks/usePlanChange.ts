// UI/features/account/hooks/usePlanChange.ts
// Paid → paid plan change using the card on file: POST /account/plan-change (subscription.update
// with proration). The backend answers one of:
//   'completed'       → prorated, confirmed (one-tap, no UI).
//   'requires_action' → SCA / 3DS: confirm inline with the Stripe SDK (handleNextAction on the
//                       returned clientSecret), then invalidate the account query.
//   'payment_failed'  → no actionable secret → throw → `isError` → error snackbar (NOT the
//                       green PRICING_PLAN_CHANGED success).
// The switch over `status` is exhaustive: a new status breaks the build until handled. On any
// terminal state the account query is invalidated so the new plan + status surface at once.
// DECISION: module-singleton `loadStripe` promise, separate from the checkout provider's (owned by
// features/checkout). Here only a Stripe instance for handleNextAction (3DS) is needed, never a
// provider, so the loader stays beside the hook and the SCA path does not couple to the checkout
// organism.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Stripe } from '@stripe/stripe-js';
// /pure: no side-effect load of js.stripe.com on import of the account chunk; the script loads
// only on a real SCA (getStripe() is lazy-memoized).
import { loadStripe } from '@stripe/stripe-js/pure';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type {
  PlanChangeRequest,
  PlanChangeResponse,
} from '@kernel/domain/user-and-account/account-checkout.types';
import { ENV_VARS } from '../../../../application/environment/environment.config';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { planChange_IO } from '../../../../domain/account/accountIO.possibilities.api';
import { isIOError } from '../../../../application/http/io';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../shared/analytics/flowErrorCode';

let stripePromise: Promise<Stripe | null> | null = null;

function getStripe(): Promise<Stripe | null> {
  if (stripePromise === null) {
    const key = ENV_VARS.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key
      ? loadStripe(key).catch(error => {
          stripePromise = null;
          throw error;
        })
      : Promise.resolve(null);
  }
  return stripePromise;
}

/**
 * Runs the paid→paid plan change and, when the backend reports SCA is needed,
 * drives the 3DS confirmation inline. Resolves true on a confirmed change,
 * throws on a hard failure (so TanStack Query's `isError` lights up).
 */
async function changePlan(req: PlanChangeRequest): Promise<true> {
  const result: PlanChangeResponse = await planChange_IO(req);

  switch (result.status) {
    case 'completed':
      return true;

    case 'requires_action': {
      // SCA / 3DS. Confirm the latest invoice via its Basil confirmation_secret
      // (NOT a PaymentIntent client_secret — Basil API surfaces it on the invoice).
      // `clientSecret` is required on this branch by the union, but the IO boundary
      // can still hand back malformed data — keep the guard as runtime defence.
      if (!result.clientSecret) {
        throw new Error('plan-change requires_action without clientSecret');
      }
      const stripe = await getStripe();
      if (stripe === null) {
        throw new Error('Stripe.js unavailable for SCA confirmation');
      }
      const { error } = await stripe.handleNextAction({
        clientSecret: result.clientSecret,
      });
      if (error) {
        throw new Error(error.message ?? 'SCA confirmation failed');
      }
      return true;
    }

    case 'payment_failed':
      // No actionable secret (hard-decline / missing method) — surface as an error
      // so the onError snackbar fires instead of the success path.
      throw new Error(
        `plan-change payment failed${result.reason ? `: ${result.reason}` : ''}`
      );

    default: {
      // Exhaustiveness guard — a new status forces a compile error here.
      const _exhaustive: never = result;
      throw new Error(
        `plan-change unhandled status: ${String((_exhaustive as { status?: unknown }).status)}`
      );
    }
  }
}

/* ─── Hook ─── */

export function usePlanChange() {
  const queryClient = useQueryClient();
  return useMutation<true, unknown, PlanChangeRequest>({
    mutationFn: changePlan,
    meta: { suppressGlobalError: true },
    onSettled: () => {
      // Re-read the account regardless of outcome — a partially-applied change
      // (e.g. SCA abandoned) must reflect the true server state, not optimism.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
      // Plan limits changed → usage-vs-limit view (UsageStatsSection, downgrade
      // warning counts) must re-derive against the new plan, not the cached one.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.usageStats,
      });
    },
    onSuccess: (_data, req) => {
      trackFlowStep('checkout', 'plan_changed', {
        plan: req.targetPlanId,
        period: req.billingPeriod,
      });
    },
    onError: (err: unknown, req) => {
      trackFlowStep('checkout', 'plan_change_failed', {
        plan: req.targetPlanId,
        code: flowErrorCode(err, 'client_side'),
      });
      // DECISION: an HTTP error response (IOError) already surfaces its SPECIFIC event via the
      // interceptor event-bus (e.g. CANNOT_CHANGE_PRICING_PLAN), layer 1 of queryClient.config's
      // toast model; pushing a generic GENERAL_ERROR too double-toasted a paid→paid failure. The
      // generic fallback is needed only for a CLIENT-SIDE throw (SCA/3DS confirm failure,
      // payment_failed), which never round-trips an event through the interceptor.
      if (!isIOError(err)) {
        pushNewSnackbar(APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, 'error');
      }
    },
  });
}
