import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  respondGeneralError,
  respondSuccess,
} from '@app/http/http.responses.utils';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { withPublicHandler } from '@app/http/define-raw-handler';
import { runAfterResponse } from '@app/runtime/run-after-response';
import type { StripeWebhookEffect } from '@app/stripe/webhooks/stripe-effects.types';
import {
  verifyWebhookRequest,
  constructStripeEvent,
} from '@app/stripe/webhooks/stripe-webhook-signature';
import {
  checkIdempotencyAndRecord,
  claimEventForProcessingTx,
  STRIPE_EVENT_ALREADY_CLAIMED,
  recordHandlerFailure,
} from '@app/stripe/webhooks/stripe-webhook-claim';
import { routeStripeEvent } from '@app/stripe/webhooks/stripe-event-router';
import { prefetchStripeEventContext } from '@app/stripe/webhooks/stripe-event-prefetch';
import { PRISMA_TX } from '@kernel/application/constants.config';

// DECISION: body parsing is disabled because stripe.webhooks.constructEvent verifies the HMAC signature
// over the RAW body. It MUST stay `false`: the withPublicHandler wrapper (cors:false, rateLimit:false) is a
// thin timing/error scaffold and never reads req.body, so the raw stream reaches readRawBody intact.
export const config = {
  api: {
    bodyParser: false,
  },
};

// Wrapped in `withPublicHandler({ cors: false, rateLimit: false })`. The wrapper
// only times the request and scaffolds errors. POST, the rate limit and the secret
// stay in `verifyWebhookRequest`, with the signature check and the processing claim.
export default withPublicHandler({
  allowedMethods: ['POST'],
  cors: false,
  rateLimit: false,
  handle: async (req, res) => {
    // Validate request (method, rate limit, secret)
    const { proceed } = verifyWebhookRequest({ req, res });
    if (!proceed) {
      return;
    }

    // Verify Stripe signature and construct event
    const event = await constructStripeEvent({ req, res });
    if (!event) {
      return;
    }

    // DECISION: NO advisory lock on this path, and it must not come back (rationale:
    // web-1/src/application/stripe/webhooks/janitor/stripe-event-janitor.operations.ts).
    // Exclusion rests on `claimEventForProcessingTx` (row lock). Accepted cost: a parallel
    // duplicate delivery of one event does the pre-transaction Stripe read twice; the loser rolls
    // back without effects.
    try {
      // Check if event was already processed
      const shouldProcess = await checkIdempotencyAndRecord({ event, res });
      if (!shouldProcess) {
        return;
      }

      // DECISION: handler + markEventProcessed run in ONE atomic transaction: BOTH commit (the event is
      // durably processed) or NEITHER (the row stays processed=false and the janitor retries after
      // STRIPE_EVENT_JANITOR_STALE_MINUTES). This closed the hole where the handler succeeded but the
      // markEventProcessed UPDATE failed on a transient hiccup, so a Stripe retry re-applied side effects.
      // maxWait/timeout: see PRISMA_TX (no handler calls Stripe under an open transaction).
      //
      // Post-commit effects collector: handlers RETURN effects[] instead of scheduling in-transaction;
      // runAfterResponse() is called ONLY after the $transaction commits (the loop below), so a rollback
      // fires ZERO e-mails/cancels. Do NOT put runAfterResponse in handlers or the router. Effects are
      // self-contained closures: they must capture email/userId/etc. BEFORE the call, since they run after
      // the $transaction (the DB row may differ by then).
      const collectedEffects: StripeWebhookEffect[] = [];

      // DECISION: pre-fetch the Stripe context (planId for subscription events, plus the resolved
      // subscription for `subscription_schedule.*`) BEFORE the `$transaction(timeout:25s)` so no Stripe API
      // call (`stripe.prices.retrieve` in `extractPlanIdFromSubscription`, `subscriptions.retrieve` behind a
      // schedule) consumes tx budget. The result is tri-state (details: StripeEventPrefetch in
      // stripe-event-prefetch.ts): on a Stripe failure the field is `null` ("attempted, no result"), the
      // handler keeps the current DB plan and does NOT call Stripe again inside the tx, and the periodic
      // Stripe sync job (`stripe-sync.operations.ts`) reconciles state once Stripe recovers.
      const prefetch = await prefetchStripeEventContext(event);

      await DB_CLIENT.use.$transaction(async tx => {
        // SPAR-006: optimistic-claim FIRST. A concurrent tx for the SAME event loses the
        // claim (count===0) → throws STRIPE_EVENT_ALREADY_CLAIMED and never runs the handler,
        // so no duplicate effects. The claim sets processed=true; if routeStripeEvent throws,
        // the whole tx rolls back (processed→false) → janitor retries. Ta sama funkcja i ta
        // sama pozycja (pierwszy statement tx) po stronie janitora — lock-order parity.
        await claimEventForProcessingTx(tx, event.id);
        const result = await routeStripeEvent(event, tx, prefetch);
        collectedEffects.push(...result.effects);
      }, PRISMA_TX);

      // Post-commit: schedule effects ONLY after successful commit.
      // If the transaction above threw and rolled back, we never reach this point —
      // every queued email/cancel/alert is silently discarded (the intended behavior).
      for (const effect of collectedEffects) {
        runAfterResponse(effect);
      }

      respondSuccess(res, undefined, APP_EVENTS.INFO.APPLICATION.SUCCESS);
    } catch (error) {
      // SPAR-006: benign concurrent-claim loss — another transaction is processing this
      // exact event. The tx rolled back (zero side-effects, no effects scheduled), so ack
      // 200 idempotently WITHOUT recording a failure or emitting a 5xx (which would make
      // Stripe retry a duplicate). Structural message-check (sentinel is our own throw).
      if (
        error instanceof Error &&
        error.message === STRIPE_EVENT_ALREADY_CLAIMED
      ) {
        reportIssueBackend({
          namespace: 'STRIPE_WEBHOOK_IDEMPOTENCY',
          message:
            'Concurrent claim lost — event handled by another tx, idempotent 200',
          payload: { eventId: event.id, eventType: event.type },
          mode: 'info',
        });
        respondSuccess(res, undefined, APP_EVENTS.INFO.APPLICATION.SUCCESS);
        return;
      }
      reportIssueBackend({
        namespace: 'STRIPE_WEBHOOK_ERROR',
        message: 'Error processing webhook',
        payload: error,
        mode: 'error',
      });
      // Record failure on the row so janitor decides retry vs dead-letter.
      // Fire-and-forget — never block the 5xx ack to Stripe.
      void recordHandlerFailure(event.id, error);
      // respondGeneralError is intentional: webhook uses raw try/catch, not OperationResult
      respondGeneralError(res, undefined);
    }
  },
});
