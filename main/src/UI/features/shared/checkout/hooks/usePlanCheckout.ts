// UI/features/checkout/hooks/usePlanCheckout.ts
// SPE (W2): TQ v5 mutation — POST /api/v1/account/checkout-session.
// Returns the discriminated CheckoutSessionResponse (free_selected |
// checkout_elements | hosted_fallback) for PlanCheckoutPanel to switch on.
// Free business conflicts belong to the inline panel; other HTTP errors use
// the interceptor and client-side failures use a fallback toast.
// Cache invalidation for `free_selected` happens in the
// panel's onSuccess (it knows when no Stripe round-trip is pending).
// Stack: TanStack Query v5.

import { payFlow } from '../../../checkout/components/checkout-pay.helpers';
import { useMutation } from '@tanstack/react-query';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type {
  CheckoutSessionRequest,
  CheckoutSessionResponse,
} from '@kernel/domain/user-and-account/account-checkout.types';
import { checkoutSession_IO } from '../../../../../domain/account/accountIO.possibilities.api';
import { isIOError } from '../../../../../application/http/io';
import { pushNewSnackbar } from '../../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../analytics/flowErrorCode';
import { useRef } from 'react';
import { useCurrentUserAccount } from '../../../../shared/hooks/useCurrentUserAccount';
import {
  bindPurchaseResumeSession,
  readPurchaseResume,
} from '../../../../../application/client-device-storage/purchase-resume';

// Client-side bound on the create-session round-trip. The transport already caps
// every call at DEFAULT_REQUEST_TIMEOUT_MS (30s), but 30s of "Przygotowujemy..."
// for a session-mint is poor UX. 22s is the binding limit here: under the 30s
// transport ceiling, yet above the backend's worst-case Stripe retry budget
// (getOrCreateStripeCustomer ~7s + checkout.sessions.create ~7s + DB/overhead),
// so a request that is genuinely recovering is never pre-empted — only a hung
// create trips it.
const CREATE_SESSION_TIMEOUT_MS = 22_000;

/** Marker thrown when the create-session wait exceeds CREATE_SESSION_TIMEOUT_MS. */
class CheckoutTimeoutError extends Error {
  constructor() {
    super('checkout-session create timed out');
    this.name = 'CheckoutTimeoutError';
  }
}

async function checkoutSessionWithTimeout(
  req: CheckoutSessionRequest
): Promise<CheckoutSessionResponse> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new CheckoutTimeoutError());
    }, CREATE_SESSION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      checkoutSession_IO(req, {
        signal: controller.signal,
        // The Free panel owns business-conflict feedback; the interceptor still logs it.
        silentBusinessError: req.planId === PricingPlanValue.FREE,
      }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/* ─── Hook ─── */

export function usePlanCheckout() {
  const { data: user } = useCurrentUserAccount();
  const identity = user?.stylist_account?.account_id
    ? { userId: user.id, accountId: user.stylist_account.account_id }
    : null;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  return useMutation<
    CheckoutSessionResponse,
    unknown,
    CheckoutSessionRequest,
    | { identity: { userId: string; accountId: string }; intentId: string }
    | undefined
  >({
    mutationFn: (req: CheckoutSessionRequest) =>
      checkoutSessionWithTimeout(req),
    onMutate: () => {
      const current = identityRef.current;
      const intent = current && readPurchaseResume(current);
      return current && intent
        ? { identity: current, intentId: intent.id }
        : undefined;
    },
    meta: { suppressGlobalError: true },
    // Hook level, like the failure below: every consumer mints through here
    // (the panel AND onboarding's silent Free start), so success is counted
    // for all of them, not only for the panel.
    onSuccess: (response, req, context) => {
      if (
        context &&
        response.mode !== 'free_selected' &&
        identityRef.current?.userId === context.identity.userId &&
        identityRef.current.accountId === context.identity.accountId
      ) {
        bindPurchaseResumeSession(
          context.identity,
          context.intentId,
          response.checkoutSessionId
        );
      }
      payFlow.sessionCreated(req.planId, response.mode, {
        billingCountry: req.billingCountry,
        currency: req.currency,
        billingPeriod: req.billingPeriod,
      });
    },
    onError: (err: unknown, req) => {
      trackFlowStep('checkout', 'session_failed', {
        plan: req.planId,
        code: flowErrorCode(err, 'client_side'),
      });
      // DECISION: an HTTP error response (IOError) already surfaces its SPECIFIC event via the
      // interceptor event bus, so pushing a generic GENERAL_ERROR here too would DOUBLE-toast a
      // failed session mint. The generic fallback is only for a CLIENT-SIDE throw
      // (CheckoutTimeoutError from the timeout race), which never round-trips an event through the
      // interceptor.
      if (!isIOError(err)) {
        pushNewSnackbar(APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, 'error');
      }
    },
  });
}
