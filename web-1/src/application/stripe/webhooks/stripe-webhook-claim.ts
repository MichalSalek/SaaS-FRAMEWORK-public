import type { NextApiResponse } from 'next';
import type Stripe from 'stripe';
import type { Prisma } from '../../../prisma/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import { isP2002 } from '@app/db/prisma-error';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

// Stripe webhook ingress, step 2: idempotency record and the claim-first of the StripeEvent row
// (hot path in pages/api/v1/webhooks/stripe/index.ts and the janitor sweeper).

/**
 * Check idempotency — returns true if the event should be processed.
 * Creates the event record if it doesn't exist.
 * Sends response and returns false if already processed.
 */
export const checkIdempotencyAndRecord = async ({
  event,
  res,
}: {
  event: Stripe.Event;
  res: NextApiResponse;
}): Promise<boolean> => {
  const existingEvent = await DB_CLIENT.use.stripeEvent.findUnique({
    where: { event_id: event.id },
    select: { processed: true },
  });

  if (existingEvent?.processed === true) {
    reportIssueBackend({
      namespace: 'STRIPE_WEBHOOK_IDEMPOTENCY',
      message: 'Event already processed, skipping',
      payload: { eventId: event.id, eventType: event.type },
      mode: 'info',
    });
    respondSuccess(res, undefined, APP_EVENTS.INFO.APPLICATION.SUCCESS);
    return false;
  }

  // Create event record if not exists (marks as processing)
  if (!existingEvent) {
    try {
      await DB_CLIENT.use.stripeEvent.create({
        data: {
          event_id: event.id,
          event_type: event.type,
          processed: false,
        },
      });
    } catch (error) {
      // DECISION: P2002 is detected STRUCTURALLY (isP2002), never with
      // `instanceof Prisma.PrismaClientKnownRequestError`: instanceof is FALSE under Turbopack
      // (duplicated class identity), which would skip the dedup of a concurrent duplicate webhook
      // and rethrow it as a 500 instead of an idempotent 200 ack. See @app/db/prisma-error.ts.
      if (isP2002(error)) {
        reportIssueBackend({
          namespace: 'STRIPE_WEBHOOK_IDEMPOTENCY',
          message: 'Concurrent duplicate detected via P2002 — skipping',
          payload: { eventId: event.id },
          mode: 'info',
        });
        respondSuccess(res, undefined, APP_EVENTS.INFO.APPLICATION.SUCCESS);
        return false;
      }
      throw error;
    }
  }

  return true;
};

/**
 * Sentinel thrown by claimEventForProcessingTx when the event was already claimed by a
 * concurrent transaction. Caught in index.ts → idempotent 200 ack (NOT a 5xx failure).
 */
export const STRIPE_EVENT_ALREADY_CLAIMED = '__STRIPE_EVENT_ALREADY_CLAIMED__';

export const claimEventForProcessingTx = async (
  tx: Prisma.TransactionClient,
  eventId: string
): Promise<void> => {
  const claimed = await tx.stripeEvent.updateMany({
    where: { event_id: eventId, processed: false },
    data: {
      processed: true,
      processed_at: new Date(),
      last_error: null,
      // DECISION: dead_lettered is cleared on a successful claim. The janitor dead-letters after
      // ~MAX_RETRIES x STALE_MINUTES (default ~25 min) while Stripe retries an event for up to 3
      // days, so a late retry can process a row the janitor already gave up on. Without this the
      // row stayed contradictory (processed=true + dead_lettered=true) and an operator went back to
      // "manual review required" on something that had healed itself. The dead-letter alert stays
      // in the logs as history, but the DB state tells the truth.
      dead_lettered: false,
    },
  });
  if (claimed.count === 0) {
    throw new Error(STRIPE_EVENT_ALREADY_CLAIMED);
  }
};

/**
 * Record handler failure on the StripeEvent row so the janitor can decide
 * whether to retry or dead-letter. Called from the outer catch in index.ts
 * AFTER the $transaction rollback — meaning the row is back to processed=false
 * but with no breadcrumb. This writes a separate non-transactional UPDATE to
 * stamp last_error + last_attempt_at; retry_count is bumped by the janitor on
 * each retry attempt, not here (avoids double-count if Stripe retry races).
 *
 * Fire-and-forget — if this write fails the janitor still sweeps based on
 * created_at age, so we don't block the 5xx ack.
 */
export const recordHandlerFailure = async (
  eventId: string,
  error: unknown
): Promise<void> => {
  try {
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    // Cap to fit reasonable DB column size — no need for full stack trace here,
    // event logs already captured the full payload via reportIssueBackend.
    const truncated =
      message.length > 2_000 ? `${message.slice(0, 2_000)}…` : message;
    await DB_CLIENT.use.stripeEvent.update({
      where: { event_id: eventId },
      data: {
        last_error: truncated,
        last_attempt_at: new Date(),
      },
    });
  } catch (writeError) {
    reportIssueBackend({
      namespace: 'STRIPE_WEBHOOK_RECORD_FAILURE_ERROR',
      message: 'Failed to record handler failure on StripeEvent row',
      payload: { eventId, writeError },
      mode: 'error',
    });
  }
};
