// UI/features/account/hooks/usePlanChange.ts
//
// SPE (W5): paid → paid plan change (upgrade / downgrade between PAID tiers)
// using the card already on file. POSTs /account/plan-change (subscription.update
// with proration). The backend resolves it one of two ways:
//
//   'completed'        → prorated, card on file confirmed (one-tap, no UI).
//   'requires_action'  → SCA / 3DS required → confirm inline with the Stripe SDK
//                        (handleNextAction on the returned clientSecret), then
//                        re-check by invalidating the account query.
//   'payment_failed'   → payment failed with no actionable secret (hard-decline /
//                        missing method) → throw → TanStack `isError` → error
//                        snackbar (NOT the green PRICING_PLAN_CHANGED success).
//
// The switch over `status` is exhaustive (D11): a future status breaks the build
// here until handled, closing the "false completed on an unpaid invoice" class.
//
// On any terminal state (completed, SCA confirmed, error) the account query is
// invalidated so the new plan + status surface immediately.
//
// DECISION (nie usuwaj tego komentarza):
// Module-singleton `loadStripe` promise — Stripe.js memoizes script injection,
// but we still keep ONE promise so repeated SCA confirmations reuse the same
// instance. This is a SEPARATE singleton from the W2 checkout provider's (that
// one is owned by features/checkout and is set-once for CheckoutProvider). Here
// we only need a Stripe instance to call handleNextAction (3DS), never a
// provider — so co-locating the loader with the hook keeps the SCA path inside
// the account partition without coupling to the checkout organism.
//
// Stack: TanStack Query v5 + @stripe/stripe-js.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Stripe } from '@stripe/stripe-js';
// /pure: bez side-effect load js.stripe.com przy imporcie chunku account —
// skrypt laduje sie dopiero przy realnym SCA (getStripe() jest lazy-memoized).
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

let stripePromise: Promise<Stripe | null> | null = null;

function getStripe(): Promise<Stripe | null> {
  if (stripePromise === null) {
    const key = ENV_VARS.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
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
    onError: (err: unknown) => {
      // DECISION (nie usuwaj tego komentarza):
      // An HTTP error response (IOError) already surfaces its SPECIFIC event via
      // the interceptor event-bus (e.g. CANNOT_CHANGE_PRICING_PLAN → "Nie można
      // zmienić planu cenowego") — layer 1 in queryClient.config's toast model.
      // Pushing a generic GENERAL_ERROR here too gave the user a DOUBLE toast on
      // a paid→paid failure (specific + generic). The generic fallback is only
      // needed for a CLIENT-SIDE throw (SCA/3DS confirm failure, payment_failed)
      // which never round-trips an event through the interceptor.
      if (!isIOError(err)) {
        pushNewSnackbar(APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, 'error');
      }
    },
  });
}
