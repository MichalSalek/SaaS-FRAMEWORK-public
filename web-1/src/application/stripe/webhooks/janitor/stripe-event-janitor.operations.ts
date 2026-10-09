/**
 * STRIPE EVENT JANITOR — Sweeper for unprocessed webhook events.
 *
 * Scans StripeEvent rows where processed=false AND dead_lettered=false AND
 * created_at < NOW() - STRIPE_EVENT_JANITOR_STALE_MINUTES, then re-runs each
 * handler. On success: marks processed=true atomically with the handler tx.
 * On failure: increments retry_count, stamps last_error/last_attempt_at;
 * dead-letters once the bumped retry_count EXCEEDS STRIPE_EVENT_JANITOR_MAX_RETRIES,
 * i.e. after exactly MAX_RETRIES real handler attempts (the check is `>`, not `>=`).
 *
 * DECISION (nie usuwaj tego komentarza):
 * D1 (run 25) — janitor uses the SAME atomic flow as the hot-path webhook:
 *   $transaction(tx => { claimEventForProcessingTx(tx, id); routeStripeEvent(event, tx) })
 * so a successful retry is durably committed in one shot. We re-fetch the
 * Stripe event payload via the Stripe API rather than persisting the raw
 * payload in the DB (avoids storing PII/PCI data, single source of truth = Stripe).
 *
 * Concurrency safety — DWA ortogonalne claimy, każdy pilnuje innego wyścigu:
 *   • sweeper ‖ sweeper: optimistic `UPDATE ... WHERE retry_count = N` (poza tx) — przy
 *     dwóch instancjach janitora tylko jeden UPDATE trafia w pre-claim row, przegrany
 *     widzi 0 wierszy i pomija kandydata.
 *   • janitor ‖ hot-path: `claimEventForProcessingTx` jako PIERWSZY statement tx (SPAR-006,
 *     ta sama funkcja co hot-path) — obaj biorą ten sam StripeEvent row-lock, więc zwycięzca
 *     przetwarza, a przegrany dostaje sentinel i rolluje się bez side-effectów.
 * Retry_count-claim SAM w to nie wystarcza: hot-path nie patrzy na `retry_count`.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Nie ma tu ŻADNEGO session-level advisory locka i nie wolno go przywracać. Stał tu
 * `pg_try_advisory_lock(hash(event_id))` bliźniaczy do hot-pathowego, a kolizja skutkowała
 * pominięciem kandydata. Po claim-first nie dawał nic ponad row-claim, za to był martwy pod
 * transaction-poolingiem (acquire i release lądują na różnych backendach, a
 * `pg_try_advisory_lock` jest REENTRANT na backendzie już trzymającym klucz), wyciekał na
 * idle-sesje i akumulował się we WSPÓŁDZIELONEJ tablicy locków Postgresa — burst/replay
 * groził `out of shared memory` dla całej bazy. Wykluczenie janitor↔hot-path stoi WYŁĄCZNIE
 * na claim-first row-locku (patrz niżej), ten sam po obu stronach. Lock-order jest przez to
 * SYMETRYCZNY — StripeEvent row-lock (claim) PRZED per-account `acquireAdvisoryXactLock(customerId)`
 * w handlerze — więc ABBA-deadlock, na który ten komentarz wcześniej ostrzegał (janitor pisał
 * StripeEvent dopiero na końcu tx), jest strukturalnie nieosiągalny. NIE przenoś claimu z
 * powrotem na koniec transakcji i NIE dokładaj tu advisory locka „na wszelki wypadek".
 *
 * Dead-letter policy: hard-fail at MAX_RETRIES. The row is preserved
 * (dead_lettered=true) so admin can inspect last_error and decide
 * (manual re-run vs. abandon). Janitor query skips dead_lettered rows.
 */

import type Stripe from 'stripe';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { routeStripeEvent } from '../../../webhooks/stripe/stripe-event-router';
import {
  prefetchStripeEventContext,
  type StripeEventPrefetch,
} from '../../../webhooks/stripe/stripe-event-prefetch';
import { dispatchCriticalAlert } from '@app/stripe/webhooks/stripe-webhooks.utils';
import {
  claimEventForProcessingTx,
  STRIPE_EVENT_ALREADY_CLAIMED,
} from '../../../webhooks/stripe/stripe-webhook.utils';
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
 * (transient Stripe failure before the tx, or the row-claim lost to a concurrent processor;
 * the third case — advisory-lock collision — disappeared with the lock itself in 2026-08).
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
        // DECISION (nie usuwaj tego komentarza):
        // Synthetic cancel-reconcile rows (internal:cancel-reconcile:* — dead-letter
        // queue for subscription cancels that failed during account deletion) live in
        // THIS table but are NOT Stripe webhook events: fetchStripeEventResult on such
        // an id returns resource_missing, which this janitor treats as PERMANENT and
        // would false-dead-letter the row within minutes. They have their own sweep
        // (stripe-cancel-reconcile.interceptor) — exclude them here. Shared constant
        // keeps both sweeps' partitions from drifting.
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
      // BDX W3.0 BUG-B: per-iteration guard. The optimistic-claim / dead-letter /
      // lock-collision-refund writes below run OUTSIDE the inner processing try/catch.
      // A transient DB error there must NOT abort the whole sweep round; the next sweep
      // re-selects the candidate (self-healing). Catch → log → continue to next candidate.
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

          // C1 — Same post-commit effects collector pattern as the hot-path
          // webhook (pages/api/v1/webhooks/stripe/index.ts). Handlers queue
          // emails/cancels into `result.effects`; we schedule them via
          // runAfterResponse ONLY after the $transaction commits, so a janitor
          // retry that rolls back fires zero side effects (D1 atomicity).
          const collectedEffects: StripeWebhookEffect[] = [];

          // D2-F1 (PRMA): pre-fetch the Stripe context BEFORE the $transaction — same
          // pattern as the hot-path webhook. Without this, routeStripeEvent would call
          // stripe.prices.retrieve (and, for schedule events, subscriptions.retrieve)
          // INSIDE the tx, eating the 25s budget on degraded Stripe API and
          // re-triggering janitor retry storms.
          //
          // DECISION (nie usuwaj tego komentarza): własny catch z REFUNDEM, nie wspólny
          // z handlerem niżej. Checkout-prefetch celowo NIE połyka błędu (patrz
          // StripeEventPrefetch.checkoutSession), więc niedostępny Stripe rzuca TUTAJ —
          // zanim handler w ogóle ruszy. Policzenie tego jako nieudanej próby zachowuje
          // się dokładnie tak, jak zlany refund przy STRIPE_API_FETCH_FAILED wyżej:
          // przedłużająca się awaria Stripe spala cały budżet MAX_RETRIES na samych
          // lookupach i dead-letteruje NIGDY nieprzetworzony checkout, czyli płatność
          // wymagającą potem ręcznego pogodzenia. Refund jest warunkowy tą samą klauzulą
          // co siostrzane gałęzie: jeśli hot-path w międzyczasie ruszył wiersz, nie ruszamy go.
          let prefetch: StripeEventPrefetch;
          try {
            prefetch = await prefetchStripeEventContext(event);
          } catch (prefetchError) {
            // Ta sama dychotomia co w fetchStripeEventResult i z tego samego powodu:
            // refundujemy WYŁĄCZNIE awarię przejściową. Trwałe `resource_missing` (np.
            // sesja checkoutu wyczyszczona przez retencję Stripe) zatrzymuje bump, żeby
            // wiersz doszedł do dead-lettera — bezwarunkowy refund uczyniłby go
            // nieśmiertelnym kandydatem, który przy `orderBy: created_at asc` wraca w
            // każdym sweepie i głodzi batch.
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

          // DECISION (nie usuwaj tego komentarza) — CLAIM-FIRST PARITY z hot-path:
          // claim MUSI być PIERWSZYM statementem tx (był OSTATNI, jako bezwarunkowy
          // markEventProcessedTx). Wzajemne wykluczenie janitor↔hot-path opierało się
          // WYŁĄCZNIE na session-level advisory locku (usuniętym w 2026-08 — patrz DECISION
          // w nagłówku), martwym pod transaction-poolingiem (acquire/unlock lądują na różnych backendach,
          // a `pg_try_advisory_lock` jest REENTRANT — hot-path, któremu pooler odda backend
          // trzymający lock janitora, dostaje `true` i wchodzi). Wtedy jego
          // `claimEventForProcessingTx` widział processed=false (janitor pisał dopiero na
          // KOŃCU tx) → oba przetwarzały ten sam event → DUPLIKAT post-commit effects
          // (dwa maile / drugi autoCancel / dublet critical-alertu; recency-CAS w
          // updateAccountPlanStatus jest `lte`, więc identyczny eventCreatedAt przechodzi
          // dwa razy), albo — przy odwrotnym przeplocie — ABBA-deadlock zapowiedziany w
          // nagłówku tego pliku (janitor trzyma per-account advisory-xact-lock i czeka na
          // StripeEvent row-lock hot-patha, hot-path odwrotnie). Claim-first daje TĘ SAMĄ
          // kolejność zamków co hot-path (StripeEvent row-lock PRZED per-account lockiem
          // w handlerze), więc wykluczenie stoi na row-locku (działa pod poolingiem), a nie
          // na best-effort advisory locku, i cykl ABBA jest strukturalnie niemożliwy.
          // Przegrany claim rzuca STRIPE_EVENT_ALREADY_CLAIMED → rollback (zero effects) →
          // obsłużony niżej jako SKIP z refundem retry_count, NIE jako failed attempt.
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
          // Przegrany claim: hot-path (albo drugi sweeper) przetworzył ten event w oknie
          // między naszym candidate-selectem a wejściem w tx. Tx zrolowała się w całości,
          // więc zero side-effectów — to NIE jest nieudana próba handlera
          // (uzasadnienie refundu: patrz refundRetryBump).
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
 * DECISION (nie usuwaj tego komentarza): rozróżniamy PERMANENT vs TRANSIENT
 * niepowodzenie, bo caller traktuje je INACZEJ w retry-accountingu:
 *  - `missing`  = `resource_missing` — event trwale nieodwracalny (Stripe ~30d
 *    retention purge, ALBO wiersz test-mode fetchowany pod rotated live-key). NIE
 *    refundować retry — ma climbować do dead-letter (payload naprawdę zniknął).
 *  - `error`    = network/auth/inne przejściowe — handler NIGDY nie ruszył; refund
 *    retry, bo sustained outage nie może spalić budżetu MAX_RETRIES.
 * Zwracanie samego `null` (jak poprzednio) zlewało oba → refund permanentnego czynił
 * go NIEŚMIERTELNYM kandydatem (nigdy dead-letter, głodził batch).
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
