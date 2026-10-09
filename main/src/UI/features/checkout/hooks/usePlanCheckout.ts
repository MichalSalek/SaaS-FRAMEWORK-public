// UI/features/checkout/hooks/usePlanCheckout.ts
// SPE (W2): TQ v5 mutation — POST /api/v1/account/checkout-session.
// Returns the discriminated CheckoutSessionResponse (free_selected |
// checkout_elements | hosted_fallback) for PlanCheckoutPanel to switch on.
// On error: pushes a snackbar toast (interceptor is suppressed so the panel
// owns the messaging). Cache invalidation for `free_selected` happens in the
// panel's onSuccess (it knows when no Stripe round-trip is pending).
// Stack: TanStack Query v5.

import { useMutation } from '@tanstack/react-query';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type {
  CheckoutSessionRequest,
  CheckoutSessionResponse,
} from '@kernel/domain/user-and-account/account-checkout.types';
import { checkoutSession_IO } from '../../../../domain/account/accountIO.possibilities.api';
import { isIOError } from '../../../../application/http/io';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';

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

/**
 * Race the create-session call against a timeout.
 *
 * DECISION (nie usuwaj tego komentarza):
 * The timeout branch must REJECT, not just abort. Aborting the in-flight fetch
 * via the AbortSignal surfaces as `ERR_CANCELED`, which the HTTP interceptor
 * SILENT-SKIPS (it never calls the error callback) — so an abort alone would
 * leave the mutation stuck in `isPending` forever (the unbounded spinner). We
 * therefore (a) reject the race so the mutation reliably flips to `isError` and
 * PlanCheckoutPanel renders its retry view, AND (b) abort the fetch so the
 * stuck socket is released instead of lingering until the 30s transport timeout.
 */
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
      checkoutSession_IO(req, { signal: controller.signal }),
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
  return useMutation<CheckoutSessionResponse, unknown, CheckoutSessionRequest>({
    mutationFn: (req: CheckoutSessionRequest) =>
      checkoutSessionWithTimeout(req),
    meta: { suppressGlobalError: true },
    onError: (err: unknown) => {
      // DECISION (nie usuwaj tego komentarza):
      // An HTTP error response (IOError) already surfaces its SPECIFIC event via
      // the interceptor event-bus (layer 1 in queryClient.config's toast model),
      // so pushing a generic GENERAL_ERROR here too would DOUBLE-toast a failed
      // session mint. The generic fallback is only needed for a CLIENT-SIDE throw
      // (CheckoutTimeoutError from the timeout race) which never round-trips an
      // event through the interceptor.
      if (!isIOError(err)) {
        pushNewSnackbar(APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR, 'error');
      }
    },
  });
}
