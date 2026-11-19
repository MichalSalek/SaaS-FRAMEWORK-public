/**
 * The email outbox on real Postgres: the intent commits with the webhook
 * transaction, the claim is fenced, and every ledger state has its path (sent, failed, unknown with
 * a Resend-only retry or a dead letter, expired). Crash points: email-outbox.crash.test.ts.
 *
 * Run: `npm run test:outbox:pg` (local dev database only; an isolated schema per run).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import {
  EMAIL_OUTBOX_CONFIG,
  enqueueEmailOutboxTx,
  runEmailOutboxRound,
  type OutboxDeadLetter,
} from '../../src/application/email-handler/outbox/email-outbox.store';
import {
  OUTBOX_TEST_URL,
  createOutboxHarness,
  failFirstProviderMarker,
  intent,
} from './email-outbox.harness';

const holder = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (!holder.client) {
        throw new Error('Test database unavailable');
      }
      return holder.client;
    },
  },
}));
import { reconcileStaleLifecycleMessages_IO } from '@app/email-handler/lifecycle/ledger-reconciliation';

const h = createOutboxHarness(OUTBOX_TEST_URL);

describe.skipIf(!OUTBOX_TEST_URL)(
  'email outbox states on real Postgres',
  () => {
    beforeAll(async () => {
      holder.client = await h.setUp([
        'rollback',
        'dup',
        'lost-kick',
        'tick',
        'network',
        'expired',
        'reconcile',
        'cycle',
        'stale',
        'refused',
      ]);
    }, 60_000);

    afterAll(async () => {
      holder.client = null;
      await h.tearDown();
    });

    it('the intent lives and dies with the webhook transaction; a replayed event creates no second intent', async () => {
      await expect(
        h.db().$transaction(async tx => {
          await enqueueEmailOutboxTx(
            tx,
            intent('rollback', 'invoice:1:attempt:1')
          );
          throw new Error('handler failed after the intent');
        })
      ).rejects.toThrow('handler failed');
      expect(
        await h
          .db()
          .emailLifecycleMessage.count({ where: { userId: 'rollback' } })
      ).toBe(0);

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          h
            .db()
            .$transaction(tx =>
              enqueueEmailOutboxTx(tx, intent('dup', 'invoice:2:attempt:1'))
            )
        )
      );
      expect(results.filter(id => id !== null)).toHaveLength(1);
      expect(
        await h.db().emailLifecycleMessage.count({ where: { userId: 'dup' } })
      ).toBe(1);
      const [stored] = await h.db().emailLifecycleMessage.findMany({
        where: { userId: 'dup' },
      });
      expect(stored).toMatchObject({
        outbox: true,
        status: 'reserved',
        attempts: 0,
        provider: null,
        nonTransactional: false,
      });
    });

    it('crash after commit, before send: the next round sends it exactly once', async () => {
      // The post-commit kick never ran (process gone); only the committed row remains.
      const id = await h.enqueueCommitted(
        intent('lost-kick', 'invoice:3:attempt:1')
      );
      const accepted: string[] = [];
      const first = await runEmailOutboxRound(
        h.deps('resend', 'accept', { accepted }),
        { ids: [id] }
      );
      expect(first.sent).toBe(1);
      const second = await runEmailOutboxRound(h.deps('resend', 'accept'), {
        ids: [id],
      });
      expect(second.scanned).toBe(0);
      expect(await h.deliveries(id)).toHaveLength(1);
      expect(accepted).toEqual([id]);
      expect(await h.row(id)).toMatchObject({
        status: 'accepted',
        provider: 'resend',
        providerMessageId: `resend-${id}`,
        attempts: 1,
        locale: 'pl',
      });
    });

    it('double tick: 8 concurrent rounds send one message once', async () => {
      const id = await h.enqueueCommitted(
        intent('tick', 'invoice:4:attempt:1')
      );
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          runEmailOutboxRound(h.deps('mailgun', 'accept'), { ids: [id] })
        )
      );
      expect(results.reduce((sum, r) => sum + r.sent, 0)).toBe(1);
      // Mailgun has no idempotency: a second claim would have shown as a second delivery.
      expect(await h.deliveries(id)).toHaveLength(1);
      expect((await h.row(id)).attempts).toBe(1);
    });

    it('Resend unknown answers are retried with backoff up to the limit, then dead-lettered, never via Mailgun', async () => {
      const id = await h.enqueueCommitted(
        intent('network', 'invoice:9:attempt:1')
      );
      let clock = Date.now();
      const now = () => new Date(clock);
      const deadLetters: OutboxDeadLetter[] = [];
      for (let i = 0; i < EMAIL_OUTBOX_CONFIG.MAX_ATTEMPTS; i += 1) {
        const round = await runEmailOutboxRound(
          h.deps('resend', 'network-error', { now, deadLetters }),
          { ids: [id] }
        );
        expect(round.unknown).toBe(1);
        // Not due again before its backoff.
        expect(
          (
            await runEmailOutboxRound(h.deps('resend', 'accept', { now }), {
              ids: [id],
            })
          ).scanned
        ).toBe(0);
        clock += EMAIL_OUTBOX_CONFIG.BACKOFF_MAX_MS + 1_000;
      }
      const final = await h.row(id);
      expect(final).toMatchObject({
        status: 'unknown',
        attempts: EMAIL_OUTBOX_CONFIG.MAX_ATTEMPTS,
        reason: 'unknown_unresolved',
      });
      expect(final.deadLetteredAt).not.toBeNull();
      expect(deadLetters).toHaveLength(1);
      expect(await h.deliveries(id)).toHaveLength(0);
    });

    it('a never-sent intent older than its validity is dead-lettered, not sent', async () => {
      const id = await h.enqueueCommitted(
        intent('expired', 'invoice:10:attempt:1')
      );
      const later = () =>
        new Date(Date.now() + EMAIL_OUTBOX_CONFIG.MAX_INTENT_AGE_MS + 60_000);
      const round = await runEmailOutboxRound(
        h.deps('resend', 'accept', { now: later }),
        { ids: [id] }
      );
      expect(round).toMatchObject({ sent: 0, deadLettered: 1 });
      expect(await h.row(id)).toMatchObject({
        status: 'suppressed',
        reason: 'intent_expired',
      });
      expect(await h.deliveries(id)).toHaveLength(0);
    });

    it('the lifecycle reconciliation never expires a pending outbox intent', async () => {
      const id = await h.enqueueCommitted(
        intent('reconcile', 'invoice:11:attempt:1')
      );
      await reconcileStaleLifecycleMessages_IO(
        new Date(Date.now() + 24 * 60 * 60 * 1000)
      );
      expect((await h.row(id)).status).toBe('reserved');
    });
    it('dunning is keyed per invoice: two billing cycles get two intents, a replay of one gets none', async () => {
      const enqueue = (occurrence: string) =>
        h
          .db()
          .$transaction(tx =>
            enqueueEmailOutboxTx(
              tx,
              intent('cycle', occurrence, 'DUNNING_D1_INFO')
            )
          );
      expect(await enqueue('invoice:in_cycle_1')).not.toBeNull();
      expect(await enqueue('invoice:in_cycle_2')).not.toBeNull();
      expect(await enqueue('invoice:in_cycle_1')).toBeNull();
      expect(
        await h.db().emailLifecycleMessage.count({ where: { userId: 'cycle' } })
      ).toBe(2);
    });

    it('a message no longer true for the account is suppressed before the claim (eligibility_changed)', async () => {
      const id = await h.enqueueCommitted(
        intent('stale', 'invoice:14:attempt:1')
      );
      const round = await runEmailOutboxRound(
        h.deps('resend', 'accept', { stillRelevant: () => false }),
        { ids: [id] }
      );
      expect(round).toMatchObject({ sent: 0, suppressed: 1 });
      expect(await h.row(id)).toMatchObject({
        status: 'suppressed',
        reason: 'eligibility_changed',
        attempts: 0,
      });
      expect(await h.deliveries(id)).toHaveLength(0);
    });

    it('Resend refused, then the Mailgun marker hit a transient DB error: the row is NOT held as Resend-only, the next attempt falls back to Mailgun', async () => {
      const id = await h.enqueueCommitted(
        intent('refused', 'invoice:15:attempt:1')
      );
      let clock = Date.now();
      const now = () => new Date(clock);
      const first = await runEmailOutboxRound(
        h.deps('resend', 'resend-refuses', {
          now,
          db: failFirstProviderMarker(h.db(), 'mailgun'),
        }),
        { ids: [id] }
      );
      expect(first).toMatchObject({ sent: 0, retryScheduled: 1 });
      expect(await h.row(id)).toMatchObject({
        status: 'reserved',
        provider: null,
        reason: 'dispatch_error',
      });
      expect(await h.deliveries(id)).toHaveLength(0);
      clock += EMAIL_OUTBOX_CONFIG.BACKOFF_MAX_MS;
      const second = await runEmailOutboxRound(
        h.deps('resend', 'resend-refuses', { now }),
        { ids: [id] }
      );
      expect(second.sent).toBe(1);
      expect(await h.deliveries(id)).toEqual([{ provider: 'mailgun' }]);
      expect(await h.row(id)).toMatchObject({
        status: 'accepted',
        provider: 'mailgun',
      });
    });
  }
);
