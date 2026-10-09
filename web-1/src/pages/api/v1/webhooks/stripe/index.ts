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
  checkIdempotencyAndRecord,
  claimEventForProcessingTx,
  STRIPE_EVENT_ALREADY_CLAIMED,
  recordHandlerFailure,
} from '@app/webhooks/stripe/stripe-webhook.utils';
import { routeStripeEvent } from '@app/webhooks/stripe/stripe-event-router';
import { prefetchStripeEventContext } from '@app/webhooks/stripe/stripe-event-prefetch';
import { PRISMA_TX } from '@kernel/application/constants.config';

// D2-F1 (PRMA): SUBSCRIPTION_EVENTS_WITH_PLAN_LOOKUP + prefetch helper moved to
// stripe-event-router.ts so the janitor sweeper shares the same pre-fetch
// pattern (Stripe API call NEVER inside $transaction).

// DECISION (nie usuwaj tego komentarza):
// Disable body parsing - we need raw body for signature verification
// (stripe.webhooks.constructEvent HMAC na surowym body). MUST stay `false` — the
// W2.3 wrapper (withPublicHandler, cors:false/rateLimit:false) is a thin timing/error
// scaffold and NEVER reads req.body, so the raw-body stream reaches readRawBody intact.
export const config = {
  api: {
    bodyParser: false,
  },
};

// BDX W2.3: owinięty w `withPublicHandler({ cors: false, rateLimit: false })` — wrapper
// daje WYŁĄCZNIE timing/error-scaffold. Metoda (POST), rate-limit i secret zostają w
// `verifyWebhookRequest`; signature-verify + idempotencja + advisory-lock VERBATIM.
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

    // DECISION (nie usuwaj tego komentarza) — ZERO ADVISORY LOCKA NA TEJ ŚCIEŻCE:
    // stał tu session-level `pg_try_advisory_lock(hash(event.id))`, zdejmowany w `finally`.
    // Po claim-first (SPAR-006 + parytet janitora) nie dawał ŻADNEJ gwarancji ponad
    // warunkowy row-claim, a kosztował trzy rzeczy naraz: (a) nieudane `acquire` zwracało
    // 500, więc Stripe retryował event, którego nikt nie przetwarzał; (b) pod
    // transaction-poolingiem `unlock` lądował na innym backendzie niż `acquire`, więc lock
    // WYCIEKAŁ i zostawał na idle-sesji — kolejne dostawy tego samego eventu dostawały 500
    // aż do sweepa janitora; (c) wyciekłe locki akumulują się w WSPÓŁDZIELONEJ tablicy
    // locków Postgresa (≈ max_locks_per_transaction × max_connections), więc burst albo
    // replay tysięcy eventów grozi `out of shared memory` na CAŁEJ bazie, nie tylko na
    // webhooku. Klucz był dodatkowo `hash()`, więc kolizja = fałszywa wykluczność między
    // NIEPOWIĄZANYMI eventami. Wykluczenie stoi dziś wyłącznie na
    // `claimEventForProcessingTx` (row-lock, działa pod poolingiem, ten sam po obu
    // stronach). Świadomie zaakceptowany koszt: równoległa duplikat-dostawa tego samego
    // eventu wykona pre-transakcyjny odczyt ze Stripe dwa razy — przegrany i tak rolluje
    // się bez efektów. NIE przywracaj tego locka ani nie dokładaj tu `pg_advisory_xact_lock`
    // (to ten sam row-lock, który claim już bierze).
    try {
      // Check if event was already processed
      const shouldProcess = await checkIdempotencyAndRecord({ event, res });
      if (!shouldProcess) {
        return;
      }

      // DECISION (nie usuwaj tego komentarza):
      // D1 (run 25) — atomic transaction wraps handler + markEventProcessed.
      // Either BOTH commit (event is durably processed) OR NEITHER (row stays
      // processed=false, janitor sweeper will retry after STRIPE_EVENT_JANITOR_STALE_MINUTES).
      // This closes the prior idempotency hole where handler succeeded but the
      // markEventProcessed UPDATE failed on a transient hiccup, leaving the row
      // unprocessed and causing Stripe retry to re-apply side effects.
      // maxWait/timeout: patrz PRISMA_TX — od S89 żaden handler nie woła Stripe pod
      // otwartą transakcją; zapas konsumuje teraz per-account advisory-xact-lock.
      //
      // C1 (post-commit effects collector) — Handlers ZWRACAJA effects[] zamiast
      // schedulować w-trakcie-transakcji. runAfterResponse() jest wywolywany
      // WYLACZNIE po $transaction commit (poniżej, w pętli `for (const effect ...)`).
      // Gwarantuje: jesli tx rolls back -> ZERO emails/cancels fire (D1 atomicity).
      // Pattern: post-commit effects collector. NIE wrzucaj runAfterResponse w handlery
      // ani w router — wylacznie tutaj, po commitie. Effects są self-contained
      // closures: muszą capturować email/userId/etc. PRZED wywołaniem, ponieważ
      // wykonują się dopiero po $transaction (DB row może już być inny niż w tx).
      const collectedEffects: StripeWebhookEffect[] = [];

      // DECISION (nie usuwaj tego komentarza):
      // D2-F1 (PRMA) — Pre-fetch the Stripe context (planId for subscription events,
      // plus the resolved subscription for `subscription_schedule.*`) BEFORE the
      // `$transaction(timeout:25s)` block so no Stripe API call
      // (`stripe.prices.retrieve` inside `extractPlanIdFromSubscription`,
      // `subscriptions.retrieve` behind a schedule) consumes tx budget. Failure path is non-fatal: on Stripe error the
      // pre-fetcher returns `undefined` (logs STRIPE_WEBHOOK_PREFETCH_FAILED)
      // and the handler falls back to `getPricingPlanOrFallback(undefined, ...)`
      // (= keeps current DB plan). This preserves behavior under Stripe outage:
      // tx still commits (the claim already marked the row processed) and Stripe will not
      // retry; the periodic Stripe sync job (`stripe-sync.operations.ts`) will
      // reconcile state when Stripe recovers.
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
