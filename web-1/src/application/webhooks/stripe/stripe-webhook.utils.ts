import type { NextApiRequest, NextApiResponse } from 'next';
import type Stripe from 'stripe';
import type { Prisma } from '../../../prisma/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import { isP2002 } from '@app/db/prisma-error';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { ENV_VARS } from '@app/environment/environment.config';
import {
  respondBadRequest,
  respondGeneralError,
  respondSuccess,
} from '@app/http/http.responses.utils';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { STRIPE_WEBHOOK_LOG_NAMESPACE } from '@app/stripe/stripe.config';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';

// DECISION (nie usuwaj tego komentarza):
// Hard cap on raw webhook body. index.ts sets `bodyParser: false`, which disables
// Next.js' default 1MB body limit, and this route is PUBLIC — the Stripe signature
// is verified only AFTER the body is read, so an unauthenticated attacker could POST
// a multi-hundred-MB/GB body and OOM the Node heap (rate-limit caps request COUNT,
// not body SIZE). Real Stripe events are < ~256KB; 1MB is a comfortable ceiling.
// On overflow we throw BEFORE allocating further — the throw lands in
// constructStripeEvent()'s try/catch → respondBadRequest (400/VALIDATION_FAILED),
// never building an event and never leaking a 500.
const MAX_WEBHOOK_BODY_BYTES = 1_048_576; // 1 MB

export const readRawBody = async ({
  req,
}: {
  req: NextApiRequest;
}): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buf.length;
    if (totalBytes > MAX_WEBHOOK_BODY_BYTES) {
      throw new Error('Webhook body exceeds max size');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
};

/**
 * Gate the incoming request BEFORE the raw body is read: method, rate limit, and the
 * presence of the webhook secret. Constructs nothing — the event is built later by
 * {@link constructStripeEvent}. Returns `{ proceed: false }` once a rejection response
 * has already been written, so the caller must return immediately.
 *
 * DECISION (nie usuwaj tego komentarza): the `req.method` check is NOT redundant with
 * `withPublicHandler({ allowedMethods: ['POST'] })` — `allowedMethods` on the raw-handler
 * wrappers is documentation for the W2.4 ratchet and has NO runtime effect. This is the
 * only place the method is actually enforced for this route.
 */
export const verifyWebhookRequest = ({
  req,
  res,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
}): {
  proceed: boolean;
} => {
  // Only allow POST
  if (req.method !== 'POST') {
    respondBadRequest(
      res,
      APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
      undefined
    );
    return { proceed: false };
  }

  // Rate limiting check
  if (!withRateLimitCheck(req, res)) {
    return { proceed: false };
  }

  // Critical security check: webhook secret must be configured
  if (!ENV_VARS.STRIPE_WEBHOOK_SECRET) {
    reportIssueBackend({
      namespace: STRIPE_WEBHOOK_LOG_NAMESPACE,
      message: 'CRITICAL: STRIPE_WEBHOOK_SECRET is not configured',
      payload: {},
      mode: 'error',
    });
    // respondGeneralError is intentional: webhook infra error (missing secret), not OperationResult
    respondGeneralError(res, undefined);
    return { proceed: false };
  }

  return { proceed: true };
};

/**
 * Verify Stripe signature and construct event from raw body.
 * Returns the event or null if verification failed (response already sent).
 */
export const constructStripeEvent = async ({
  req,
  res,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
}): Promise<Stripe.Event | null> => {
  const stripe = getStripe();

  try {
    const rawBody = await readRawBody({ req });
    const signature = req.headers[CUSTOM_HEADERS.stripeSignature];

    // Validate signature exists
    if (signature == null || Array.isArray(signature)) {
      // DECISION (nie usuwaj tego komentarza):
      // Do NOT log req.headers — contains Authorization, cookies, x-internal-secret
      // and any other sensitive headers. Log only diagnostic fields (signature shape,
      // user-agent) so we can debug misconfigured webhook clients without leaking secrets.
      reportIssueBackend({
        namespace: STRIPE_WEBHOOK_LOG_NAMESPACE,
        message: 'Missing stripe-signature header',
        payload: {
          signaturePresent: signature != null,
          signatureIsArray: Array.isArray(signature),
          userAgent:
            typeof req.headers['user-agent'] === 'string'
              ? req.headers['user-agent']
              : null,
          contentType:
            typeof req.headers['content-type'] === 'string'
              ? req.headers['content-type']
              : null,
        },
        mode: 'warn',
      });
      respondBadRequest(
        res,
        APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
        undefined
      );
      return null;
    }

    reportIssueBackend({
      namespace: STRIPE_WEBHOOK_LOG_NAMESPACE,
      message: 'Constructing event',
      payload: { type: 'signature_received' },
      mode: 'info',
    });

    // Verify signature and construct event.
    // Defensive guard: STRIPE_WEBHOOK_SECRET is also checked in verifyWebhookRequest(),
    // but typed `string | undefined` at the kernel level — re-check here for type safety
    // and to fail explicitly if the upstream guard is ever skipped.
    const webhookSecret = ENV_VARS.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      reportIssueBackend({
        namespace: STRIPE_WEBHOOK_LOG_NAMESPACE,
        message:
          'CRITICAL: STRIPE_WEBHOOK_SECRET missing at constructStripeEvent',
        payload: {},
        mode: 'error',
      });
      respondGeneralError(res, undefined);
      return null;
    }
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    reportIssueBackend({
      namespace: 'STRIPE_WEBHOOK_SIGNATURE_ERROR',
      message: 'Invalid Stripe signature',
      payload: error,
      mode: 'warn',
    });
    respondBadRequest(
      res,
      APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
      undefined
    );
    return null;
  }
};

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
      // DECISION (nie usuwaj tego komentarza): P2002 wykrywany STRUKTURALNIE (isP2002), NIE
      // `instanceof Prisma.PrismaClientKnownRequestError` — instanceof zwraca FALSE pod
      // Turbopack (zdublowane tożsamości klasy) → dedup współbieżnego duplikatu webhooka
      // byłby przeskoczony i error rzucony dalej jako 500 zamiast idempotentnego 200 ack.
      // (Import Prisma jest dziś WYŁĄCZNIE typowy — `Prisma.TransactionClient`; `Prisma.sql`
      // zniknęło razem z advisory-lockiem, patrz DECISION w webhooks/stripe/index.ts.)
      // Rationale: @app/db/prisma-error.ts.
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

/**
 * Optimistic-claim the event for processing — FIRST statement inside the webhook $transaction.
 *
 * DECISION (nie usuwaj tego komentarza) — SPAR-006 (duplikat post-commit effects):
 * hot-path idempotencja opierała się na (a) advisory-locku (martwym pod poolingiem) + (b)
 * unique-constraint P2002 w checkIdempotencyAndRecord — a P2002 łapie TYLKO gdy oba racery robią
 * `create`, NIE create-then-read interleave: gdy wiersz JUŻ istnieje (processed=false, pierwszy w
 * locie), drugi tx czyta go, przechodzi handler i BEZWARUNKOWO markProcessed → duplikat maili /
 * drugi autoCancel / duplikat audytu. Fix = optimistic-claim wzorem janitora
 * (stripe-event-janitor.operations:124): `updateMany WHERE {event_id, processed:false}` →
 * `processed:true`. Zwycięzca claimuje (count===1) i przetwarza; przegrany trafia count===0 (drugi
 * pod READ COMMITTED blokuje na row-locku claimu → po commitcie zwycięzcy widzi processed=true →
 * 0 wierszy) i RZUCA sentinel → cała tx rollback (zero side-effectów) → index.ts odpowiada 200
 * idempotentnie. Handler-throw też rolluje claim (processed→false) → janitor retry. Dokładnie-raz.
 *
 * D1 (run 25) — ta sama funkcja jest PIERWSZYM statementem tx po OBU stronach: hot-path
 * (`pages/api/v1/webhooks/stripe/index.ts`) i janitor-sweeper. Nie istnieje wariant
 * nietransakcyjny ani „mark na końcu tx" — claim-first to nie preferencja stylistyczna, tylko
 * warunek dwóch inwariantów naraz: (a) przegrany wyścigu NIE odpala handlera, (b) obie ścieżki
 * biorą StripeEvent row-lock PRZED per-account `acquireAdvisoryXactLock` w handlerze, więc
 * lock-order jest symetryczny i ABBA-deadlock niemożliwy (janitor pisał kiedyś StripeEvent na
 * końcu tx = odwrotna kolejność; patrz DECISION w stripe-event-janitor.operations.ts).
 * Rollback semantics: handler-throw ALBO claim-loss cofa całą tx → row wraca do processed=false
 * → janitor retryuje po STRIPE_EVENT_JANITOR_STALE_MINUTES. Commit jest atomowy → następny
 * Stripe retry widzi processed=true i handler jest pomijany.
 *
 * Trade-off: interaktywna transakcja Prisma trzyma połączenie przez cały czas handlera
 * (ekspansje Stripe API +200-500 ms). Akceptowalne: (a) hot-path webhooka jest rzadki
 * względem ruchu użytkowników; (b) Neon pooled URL ma 100+ połączeń; (c) advisory lock
 * + P2002 nadal odsiewają część współbieżnych duplikatów zanim dojdzie do claimu.
 */
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
      // DECISION (nie usuwaj tego komentarza): czyścimy dead_lettered przy udanym claimie.
      // Janitor dead-letteruje po ~MAX_RETRIES × STALE_MINUTES (domyślnie ~25 min), a Stripe
      // retryuje event do 3 dni — więc późny retry potrafi przetworzyć wiersz, który janitor
      // zdążył odpisać na straty. Bez tego zostawał stan sprzeczny (processed=true +
      // dead_lettered=true) i operator wracał do „manual review required" na czymś, co samo
      // się dopięło. Wiersz przetworzony NIE jest martwy; alert o dead-letterze zostaje w
      // logach jako ślad historyczny, ale stan w DB mówi prawdę.
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
