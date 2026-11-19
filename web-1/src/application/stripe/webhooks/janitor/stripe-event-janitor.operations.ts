import type Stripe from 'stripe';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { routeStripeEvent } from '@app/stripe/webhooks/stripe-event-router';
import {
  prefetchStripeEventContext,
  type StripeEventPrefetch,
} from '@app/stripe/webhooks/stripe-event-prefetch';
import { dispatchCriticalAlert } from '@app/stripe/webhooks/stripe-webhooks.utils';
import {
  claimEventForProcessingTx,
  STRIPE_EVENT_ALREADY_CLAIMED,
} from '@app/stripe/webhooks/stripe-webhook-claim';
import { runAfterResponse } from '@app/runtime/run-after-response';
import type { StripeWebhookEffect } from '@app/stripe/webhooks/stripe-effects.types';
import { getRuntimeConfigValue } from '@domain/admin/operations/admin-runtime-config.operations';
import type { RuntimeConfigKey } from '@kernel/domain/admin/runtime-config.config';
import { PRISMA_TX } from '@kernel/application/constants.config';
import { CANCEL_RECONCILE_EVENT_TYPE } from '@app/stripe/cancel-reconcile/stripe-cancel-reconcile.resolver';
import { stripeDashboardLinkProp } from '@app/stripe/stripe-dashboard.links';

const STALE_MINUTES_KEY: RuntimeConfigKey =
  'STRIPE_EVENT_JANITOR_STALE_MINUTES';
const MAX_RETRIES_KEY: RuntimeConfigKey = 'STRIPE_EVENT_JANITOR_MAX_RETRIES';
const BATCH_SIZE_KEY: RuntimeConfigKey = 'STRIPE_EVENT_JANITOR_BATCH_SIZE';

type JanitorSweepResult = {
  scanned: number;
  retried: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
};

/**
 * `resource_missing` = the object is PERMANENTLY gone (Stripe's ~30d retention purge, or a
 * test-mode row read under a rotated live key). Distinguished from transient network/auth
 * failures because the two drive OPPOSITE retry accounting: a transient failure refunds the
 * optimistic bump (a sustained outage must not burn MAX_RETRIES), while a permanent one KEEPS
 * it so the row climbs to dead-letter. Refunding a permanent failure mints an immortal
 * candidate — it can never age out, and `orderBy: created_at asc` re-serves it every sweep,
 * starving the batch.
 */
const isPermanentStripeError = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  (error as { code?: string }).code === 'resource_missing';

/**
 * Undo the optimistic `retry_count` bump for a candidate whose handler NEVER ran
 * (transient Stripe failure before the tx, or the row-claim lost to a concurrent processor).
 * Without the refund a run of innocent races or a sustained Stripe outage would spend
 * the whole MAX_RETRIES budget on attempts that never touched the business logic and
 * dead-letter a perfectly processable event.
 *
 * Conditional by construction: the WHERE still pins the bumped `retry_count` and an
 * untouched row, so if the hot path meanwhile processed or dead-lettered it, the refund
 * matches zero rows and leaves it alone. Do NOT relax that clause.
 */
const refundRetryBump = async (
  candidate: { event_id: string; retry_count: number },
  lastError?: string
): Promise<void> => {
  await DB_CLIENT.use.stripeEvent.updateMany({
    where: {
      event_id: candidate.event_id,
      retry_count: candidate.retry_count + 1,
      processed: false,
      dead_lettered: false,
    },
    data: {
      retry_count: candidate.retry_count,
      ...(lastError !== undefined && { last_error: lastError }),
    },
  });
};

export const sweepUnprocessedStripeEvents =
  async (): Promise<JanitorSweepResult> => {
    const [staleMinutesRaw, maxRetriesRaw, batchSizeRaw] = await Promise.all([
      getRuntimeConfigValue(STALE_MINUTES_KEY, '5'),
      getRuntimeConfigValue(MAX_RETRIES_KEY, '5'),
      getRuntimeConfigValue(BATCH_SIZE_KEY, '10'),
    ]);
    const staleMinutes = Number(staleMinutesRaw);
    const maxRetries = Number(maxRetriesRaw);
    const batchSize = Number(batchSizeRaw);

    const staleCutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

    const candidates = await DB_CLIENT.use.stripeEvent.findMany({
      where: {
        processed: false,
        dead_lettered: false,
        created_at: { lt: staleCutoff },
        // DECISION: synthetic cancel-reconcile rows (internal:cancel-reconcile:*) live in THIS
        // table but are not Stripe webhook events: fetchStripeEventResult on such an id returns
        // resource_missing, which this janitor treats as PERMANENT and would false-dead-letter the
        // row within minutes. They have their own sweep (stripe-cancel-reconcile), so exclude them
        // here; the shared constant keeps both sweeps' partitions from drifting.
        event_type: { not: CANCEL_RECONCILE_EVENT_TYPE },
      },
      orderBy: { created_at: 'asc' },
      take: batchSize,
      select: {
        id: true,
        event_id: true,
        event_type: true,
        retry_count: true,
      },
    });

    const result: JanitorSweepResult = {
      scanned: candidates.length,
      retried: 0,
      succeeded: 0,
      failed: 0,
      deadLettered: 0,
    };

    if (candidates.length === 0) {
      return result;
    }

    reportIssueBackend({
      namespace: 'STRIPE_EVENT_JANITOR',
      message: `Found ${candidates.length} stale unprocessed events`,
      payload: {
        candidates: candidates.map(c => ({
          eventId: c.event_id,
          retryCount: c.retry_count,
        })),
        staleCutoff: staleCutoff.toISOString(),
      },
      mode: 'info',
    });

    for (const candidate of candidates) {
      // Per-iteration guard: the optimistic-claim / dead-letter / refund writes below run OUTSIDE
      // the inner processing try/catch. A transient DB error there must NOT abort the sweep
      // round; the next sweep re-selects the candidate. Catch, log, continue.
      try {
        // Optimistic claim: bump retry_count atomically. If another janitor
        // instance already bumped this row, our update matches zero rows.
        const claimed = await DB_CLIENT.use.stripeEvent.updateMany({
          where: {
            event_id: candidate.event_id,
            retry_count: candidate.retry_count,
            processed: false,
            dead_lettered: false,
          },
          data: {
            retry_count: candidate.retry_count + 1,
            last_attempt_at: new Date(),
          },
        });

        if (claimed.count === 0) {
          // Another sweeper instance got there first, or row was processed
          // since we read it. Skip without incrementing counts.
          continue;
        }

        result.retried += 1;

        // Dead-letter check happens AFTER the optimistic bump so retry_count
        // accurately reflects "we tried N+1 times and gave up".
        const nextRetryCount = candidate.retry_count + 1;
        if (nextRetryCount > maxRetries) {
          await DB_CLIENT.use.stripeEvent.update({
            where: { event_id: candidate.event_id },
            data: {
              dead_lettered: true,
              last_error: `MAX_RETRIES_EXCEEDED (retry_count=${nextRetryCount}, limit=${maxRetries})`,
            },
          });
          result.deadLettered += 1;
          reportIssueBackend({
            namespace: 'STRIPE_EVENT_JANITOR_DEAD_LETTER',
            message: 'Event exceeded max retries — dead-lettered',
            payload: {
              eventId: candidate.event_id,
              eventType: candidate.event_type,
              retryCount: nextRetryCount,
            },
            mode: 'error',
          });
          // Dead-letter = a billing-relevant Stripe event was NEVER applied and
          // will not be retried automatically — account state may be out of sync
          // with Stripe (missed upgrade/cancel/payment). Operator must inspect
          // last_error and decide: manual re-run vs reconcile via Stripe sync.
          // Janitor runs outside any $transaction, so fire-and-forget dispatch
          // is the correct channel (H7) — no effects[] collector here.
          dispatchCriticalAlert({
            context: 'STRIPE_EVENT_JANITOR_DEAD_LETTER',
            diagnostic: {
              eventId: candidate.event_id,
              eventType: candidate.event_type,
            },
            alert: {
              alertTitle:
                'Stripe: zdarzenie webhooka odłożone po wyczerpaniu prób',
              ...stripeDashboardLinkProp('events', candidate.event_id),
              alertMessage:
                `Zdarzenie ${candidate.event_id} (${candidate.event_type}) przekroczyło limit prób (${maxRetries}) ` +
                'i trafiło do odłożonych. Nie zostało przetworzone, więc stan konta może się rozjechać ze Stripe. ' +
                'Sprawdź StripeEvent.last_error i przetwórz je ręcznie albo uruchom synchronizację ze Stripe.',
              details: {
                eventId: candidate.event_id,
                eventType: candidate.event_type,
                retryCount: nextRetryCount,
                maxRetries,
                timestamp: new Date().toISOString(),
              },
            },
          });
          continue;
        }

        try {
          const fetchResult = await fetchStripeEventResult(candidate.event_id);
          if (fetchResult.status !== 'found') {
            if (fetchResult.status === 'error') {
              // TRANSIENT fetch failure (network/auth/other) — the handler never ran, so
              // this is NOT a real attempt (refund rationale: see refundRetryBump).
              await refundRetryBump(candidate, 'STRIPE_API_FETCH_FAILED');
            } else {
              // PERMANENT resource_missing (Stripe 30d retention purge, or a test-mode
              // row fetched under a rotated live key). The payload is genuinely gone —
              // KEEP the retry_count bump so it climbs to MAX_RETRIES and dead-letters
              // cleanly (correct terminal state: operator alert, and the row stops being
              // swept). Refunding here would mint an immortal candidate that starves the
              // batch, since nothing else ages a row out of the candidate set.
              await DB_CLIENT.use.stripeEvent.update({
                where: { event_id: candidate.event_id },
                data: { last_error: 'STRIPE_EVENT_PERMANENTLY_MISSING' },
              });
            }
            result.failed += 1;
            continue;
          }
          const event = fetchResult.event;

          // Same post-commit effects collector as the hot-path webhook
          // (pages/api/v1/webhooks/stripe/index.ts). Handlers queue emails/cancels into
          // `result.effects`; we schedule them via runAfterResponse ONLY after the
          // $transaction commits, so a janitor retry that rolls back fires no side effects.
          const collectedEffects: StripeWebhookEffect[] = [];

          // Pre-fetch the Stripe context BEFORE the $transaction — same
          // pattern as the hot-path webhook. Without this, routeStripeEvent would call
          // stripe.prices.retrieve (and, for schedule events, subscriptions.retrieve)
          // INSIDE the tx, eating the 25s budget on degraded Stripe API and
          // re-triggering janitor retry storms.
          //
          // DECISION: its own catch WITH a refund, not shared with the handler below. The
          // checkout prefetch deliberately does NOT swallow errors (StripeEventPrefetch.checkoutSession),
          // so an unavailable Stripe throws HERE before the handler runs. Counting that as a failed
          // attempt would let a prolonged Stripe outage burn the whole MAX_RETRIES budget on lookups
          // and dead-letter a never-processed checkout (a payment needing manual reconciliation).
          // The refund is conditional on the same clause as the sibling branches: if the hot path
          // touched the row meanwhile, we leave it alone.
          let prefetch: StripeEventPrefetch;
          try {
            prefetch = await prefetchStripeEventContext(event);
          } catch (prefetchError) {
            // Same dichotomy as in fetchStripeEventResult: refund ONLY a transient failure. A
            // permanent `resource_missing` (e.g. a checkout session purged by Stripe retention)
            // keeps the bump so the row reaches the dead letter; an unconditional refund would make
            // it an immortal candidate that returns every sweep (`orderBy: created_at asc`) and
            // starves the batch.
            const prefetchPermanent = isPermanentStripeError(prefetchError);
            if (prefetchPermanent) {
              await DB_CLIENT.use.stripeEvent.update({
                where: { event_id: candidate.event_id },
                data: { last_error: 'STRIPE_PREFETCH_PERMANENTLY_MISSING' },
              });
            } else {
              await refundRetryBump(candidate, 'STRIPE_API_PREFETCH_FAILED');
            }
            result.failed += 1;
            reportIssueBackend({
              namespace: 'STRIPE_EVENT_JANITOR_PREFETCH_FAILED',
              message: prefetchPermanent
                ? 'Pre-transaction Stripe lookup hit a permanently missing object — retry budget kept, row will dead-letter'
                : 'Pre-transaction Stripe lookup failed transiently — retry budget refunded, handler never ran',
              payload: {
                eventId: candidate.event_id,
                eventType: candidate.event_type,
                prefetchError,
              },
              mode: 'error',
            });
            continue;
          }

          // DECISION: CLAIM-FIRST parity with the hot path: the claim MUST be the FIRST statement
          // of the tx (it used to be LAST, as an unconditional markEventProcessedTx), so janitor vs
          // hot-path exclusion rests on the row-lock (works under pooling), not on an advisory lock
          // (see the header). Otherwise both could process the same event and duplicate post-commit
          // effects (two mails, a second autoCancel; the recency-CAS is `lte`, so an identical
          // eventCreatedAt passes twice) or deadlock ABBA. A lost claim throws
          // STRIPE_EVENT_ALREADY_CLAIMED, rolls back (zero effects) and is handled below as a SKIP
          // with a retry_count refund, not a failed attempt.
          await DB_CLIENT.use.$transaction(async tx => {
            await claimEventForProcessingTx(tx, candidate.event_id);
            const handlerResult = await routeStripeEvent(event, tx, prefetch);
            collectedEffects.push(...handlerResult.effects);
          }, PRISMA_TX);

          for (const effect of collectedEffects) {
            runAfterResponse(effect);
          }

          result.succeeded += 1;
          reportIssueBackend({
            namespace: 'STRIPE_EVENT_JANITOR',
            message: 'Successfully retried previously failed event',
            payload: {
              eventId: candidate.event_id,
              eventType: candidate.event_type,
              finalRetryCount: nextRetryCount,
            },
            mode: 'info',
          });
        } catch (error) {
          // Lost claim: the hot path (or another sweeper) processed this event between our
          // candidate select and the tx. The tx rolled back whole, so no side effects; this is NOT
          // a failed handler attempt (refund rationale: see refundRetryBump).
          if (
            error instanceof Error &&
            error.message === STRIPE_EVENT_ALREADY_CLAIMED
          ) {
            await refundRetryBump(candidate);
            reportIssueBackend({
              namespace: 'STRIPE_EVENT_JANITOR',
              message:
                'Skipping retry — event claimed by a concurrent processor (hot-path or sibling sweeper)',
              payload: { eventId: candidate.event_id },
              mode: 'info',
            });
            continue;
          }
          result.failed += 1;
          const message =
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error);
          const truncated =
            message.length > 2_000 ? `${message.slice(0, 2_000)}…` : message;
          // Record failure breadcrumb. retry_count was already bumped above.
          try {
            await DB_CLIENT.use.stripeEvent.update({
              where: { event_id: candidate.event_id },
              data: { last_error: truncated },
            });
          } catch (writeError) {
            reportIssueBackend({
              namespace: 'STRIPE_EVENT_JANITOR_FAILURE_WRITE_ERROR',
              message: 'Failed to record janitor retry failure',
              payload: { eventId: candidate.event_id, writeError },
              mode: 'error',
            });
          }
          reportIssueBackend({
            namespace: 'STRIPE_EVENT_JANITOR_RETRY_FAILED',
            message: 'Retry attempt failed',
            payload: {
              eventId: candidate.event_id,
              eventType: candidate.event_type,
              retryCount: nextRetryCount,
              error: truncated,
            },
            mode: 'error',
          });
        }
      } catch (candidateError) {
        result.failed += 1;
        reportIssueBackend({
          namespace: 'STRIPE_EVENT_JANITOR_CANDIDATE_ERROR',
          message:
            'Janitor candidate threw outside the processing guard — skipped (self-healing next sweep)',
          payload: { eventId: candidate.event_id, candidateError },
          mode: 'error',
        });
      }
    }

    return result;
  };

/**
 * Re-fetch the original Stripe event by ID.
 *
 * DECISION: distinguish PERMANENT from TRANSIENT failure, because the caller treats them
 * differently in retry accounting:
 *  - `missing` = `resource_missing`: the event is permanently gone (Stripe ~30d retention purge,
 *    or a test-mode row fetched under a rotated live key). Do NOT refund the retry; it must climb
 *    to dead-letter.
 *  - `error` = network/auth/other transient: the handler never ran; refund the retry so a
 *    sustained outage cannot burn the MAX_RETRIES budget.
 * A bare `null` conflated both, and refunding a permanent one made it an IMMORTAL candidate
 * (never dead-lettered, starved the batch).
 */
type StripeEventFetchResult =
  | { status: 'found'; event: Stripe.Event }
  | { status: 'missing' }
  | { status: 'error' };

const fetchStripeEventResult = async (
  eventId: string
): Promise<StripeEventFetchResult> => {
  try {
    return {
      status: 'found',
      event: await getStripe().events.retrieve(eventId),
    };
  } catch (error) {
    if (isPermanentStripeError(error)) {
      reportIssueBackend({
        namespace: 'STRIPE_EVENT_JANITOR_EVENT_PURGED',
        message:
          'Event no longer exists in Stripe (retention expired or wrong key-mode)',
        payload: { eventId },
        mode: 'warn',
      });
      return { status: 'missing' };
    }
    reportIssueBackend({
      namespace: 'STRIPE_EVENT_JANITOR_FETCH_ERROR',
      message: 'Failed to fetch Stripe event for retry',
      payload: { eventId, error },
      mode: 'error',
    });
    return { status: 'error' };
  }
};
