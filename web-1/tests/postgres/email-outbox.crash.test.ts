/**
 * The four failure points of the outbox on real Postgres: crash after commit before send, crash
 * during the provider call, provider accepted before the DB ACK, and (in email-outbox.test.ts)
 * the double tick. Two of them kill a separate OS process with SIGKILL.
 *
 * Run: `npm run test:outbox:pg` (local dev database only; an isolated schema per run).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import {
  runEmailOutboxRound,
  type OutboxDeadLetter,
} from '../../src/application/email-handler/outbox/email-outbox.store';
import {
  OUTBOX_TEST_URL,
  createOutboxHarness,
  intent,
  later,
  waitFor,
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
const audit = vi.hoisted(() => ({ record: vi.fn(async () => undefined) }));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: audit.record,
}));
import { recordLifecycleDelivery } from '@app/email-handler/lifecycle/ledger-delivery';

const h = createOutboxHarness(OUTBOX_TEST_URL);

describe.skipIf(!OUTBOX_TEST_URL)(
  'email outbox crash points on real Postgres',
  () => {
    beforeAll(async () => {
      holder.client = await h.setUp([
        'hang-resend',
        'accepted-resend',
        'accepted-mailgun',
        'null-provider',
        'kill-commit',
        'kill-send',
        'webhook-race',
      ]);
    }, 60_000);

    afterAll(async () => {
      holder.client = null;
      await h.tearDown();
    });

    it('crash during the Resend call: unknown, then ONE Resend-only retry with the same key', async () => {
      const id = await h.enqueueCommitted(
        intent('hang-resend', 'invoice:5:attempt:1')
      );
      // Worker A reaches Resend and never answers (abandoned promise = dead process).
      void runEmailOutboxRound(h.deps('resend', 'hang'), { ids: [id] });
      await waitFor(
        async () => (await h.row(id)).provider === 'resend',
        5_000,
        'provider marker'
      );
      expect((await h.row(id)).status).toBe('sending');
      // Before the stale threshold nobody touches it.
      expect(
        (await runEmailOutboxRound(h.deps('resend', 'accept'), { ids: [id] }))
          .scanned
      ).toBe(0);
      const retry = await runEmailOutboxRound(
        h.deps('resend', 'accept', { now: later }),
        { ids: [id] }
      );
      expect(retry).toMatchObject({ interrupted: 1, sent: 1 });
      expect(await h.deliveries(id)).toHaveLength(1);
      expect(await h.row(id)).toMatchObject({
        status: 'accepted',
        attempts: 2,
      });
    });

    it('Resend accepted, process died before the DB ACK: the retry gets the SAME message back, no second copy', async () => {
      const id = await h.enqueueCommitted(
        intent('accepted-resend', 'invoice:6:attempt:1')
      );
      void runEmailOutboxRound(h.deps('resend', 'accept-then-hang'), {
        ids: [id],
      });
      await waitFor(
        async () => (await h.deliveries(id)).length === 1,
        5_000,
        'provider acceptance'
      );
      const retry = await runEmailOutboxRound(
        h.deps('resend', 'accept', { now: later }),
        { ids: [id] }
      );
      expect(retry.sent).toBe(1);
      expect(await h.deliveries(id)).toHaveLength(1);
      expect((await h.row(id)).providerMessageId).toBe(`resend-${id}`);
    });

    it('Mailgun accepted, process died before the DB ACK: never re-sent, dead-lettered, then resolved by the delivery webhook', async () => {
      const id = await h.enqueueCommitted(
        intent('accepted-mailgun', 'invoice:7:attempt:1')
      );
      void runEmailOutboxRound(h.deps('mailgun', 'accept-then-hang'), {
        ids: [id],
      });
      await waitFor(
        async () => (await h.deliveries(id)).length === 1,
        5_000,
        'provider acceptance'
      );
      const deadLetters: OutboxDeadLetter[] = [];
      const round = await runEmailOutboxRound(
        h.deps('mailgun', 'accept', { now: later, deadLetters }),
        { ids: [id] }
      );
      expect(round).toMatchObject({ interrupted: 1, sent: 0, deadLettered: 1 });
      expect(await h.deliveries(id)).toHaveLength(1);
      const held = await h.row(id);
      expect(held).toMatchObject({
        status: 'unknown',
        provider: 'mailgun',
        reason: 'unknown_unresolved',
      });
      expect(held.deadLetteredAt).not.toBeNull();
      expect(deadLetters.map(entry => entry.messageId)).toEqual([id]);
      const failed = await h.db().failedEmail.findMany({
        where: { recipient: 'user:accepted-mailgun' },
      });
      expect(failed).toHaveLength(1);
      expect(failed[0]?.error).toContain('UNKNOWN DELIVERY via mailgun');
      // Further rounds leave it alone.
      expect(
        (
          await runEmailOutboxRound(
            h.deps('mailgun', 'accept', { now: later }),
            {
              ids: [id],
            }
          )
        ).scanned
      ).toBe(0);
      // Explicit resolution path: Mailgun's delivery event (tagged with the ledger id) settles it.
      expect(
        await recordLifecycleDelivery({
          provider: 'mailgun',
          providerEventId: `evt-${id}`,
          providerMessageId: `mailgun-${id}`,
          messageId: id,
          kind: 'delivered',
          occurredAt: new Date(),
        })
      ).toBe(true);
      expect((await h.row(id)).status).toBe('accepted');
      // The side that settles the row writes the EMAIL_*_SENT audit row, here the webhook.
      expect(audit.record).toHaveBeenCalledWith({
        eventName: 'EMAIL_PAYMENT_FAILED_SENT',
        user: { id: 'accepted-mailgun' },
        responseBody: { templateId: 'payment-failed', lifecycleMessageId: id },
      });
    });

    it('claimed but died before any provider was contacted: retried normally (no provider can hold it)', async () => {
      const id = await h.enqueueCommitted(
        intent('null-provider', 'invoice:8:attempt:1')
      );
      await h.db().emailLifecycleMessage.update({
        where: { id },
        data: { status: 'sending', attempts: 1, startedAt: new Date() },
      });
      const round = await runEmailOutboxRound(
        h.deps('mailgun', 'accept', { now: later }),
        { ids: [id] }
      );
      expect(round).toMatchObject({ interrupted: 1, sent: 1 });
      expect(await h.deliveries(id)).toHaveLength(1);
    });

    it('SIGKILL right after the commit: the intent survives and the next worker sends it once', async () => {
      const child = h.spawnWorker([
        'enqueue',
        'kill-commit',
        'acc-kill-commit',
        'invoice:12:attempt:1',
      ]);
      await new Promise<void>((resolve, reject) => {
        let out = '';
        child.stdout.on('data', chunk => {
          out += String(chunk);
          if (out.includes('COMMITTED')) {
            resolve();
          }
        });
        child.on('exit', code => reject(new Error(`worker exited ${code}`)));
      });
      child.kill('SIGKILL');
      const [stored] = await h.db().emailLifecycleMessage.findMany({
        where: { userId: 'kill-commit' },
      });
      expect(stored?.status).toBe('reserved');
      const id = stored?.id ?? '';
      const round = await runEmailOutboxRound(h.deps('resend', 'accept'), {
        ids: [id],
      });
      expect(round.sent).toBe(1);
      expect(await h.deliveries(id)).toHaveLength(1);
    }, 30_000);

    it('SIGKILL after Resend accepted, before the DB ACK: the next worker resolves it without a second copy', async () => {
      const id = await h.enqueueCommitted(
        intent('kill-send', 'invoice:13:attempt:1')
      );
      const child = h.spawnWorker(['send', 'resend', 'accept-then-hang', id]);
      await waitFor(
        async () => (await h.deliveries(id)).length === 1,
        20_000,
        'worker acceptance'
      );
      child.kill('SIGKILL');
      await new Promise(resolve => child.on('exit', resolve));
      expect(await h.row(id)).toMatchObject({
        status: 'sending',
        provider: 'resend',
      });
      const round = await runEmailOutboxRound(
        h.deps('resend', 'accept', { now: later }),
        { ids: [id] }
      );
      expect(round).toMatchObject({ interrupted: 1, sent: 1 });
      expect(await h.deliveries(id)).toHaveLength(1);
      expect((await h.row(id)).status).toBe('accepted');
    }, 30_000);
    it('a delivery webhook for a row still `sending` records the delivery but leaves the transition (and its audit) to the worker', async () => {
      const id = await h.enqueueCommitted(
        intent('webhook-race', 'invoice:16:attempt:1')
      );
      void runEmailOutboxRound(h.deps('resend', 'hang'), { ids: [id] });
      await waitFor(
        async () => (await h.row(id)).provider === 'resend',
        5_000,
        'provider marker'
      );
      expect(
        await recordLifecycleDelivery({
          provider: 'resend',
          providerEventId: `evt-${id}`,
          providerMessageId: `resend-${id}`,
          messageId: id,
          kind: 'delivered',
          occurredAt: new Date(),
        })
      ).toBe(true);
      expect(await h.row(id)).toMatchObject({
        status: 'sending',
        deliveryStatus: 'delivered',
      });
      expect(audit.record).not.toHaveBeenCalledWith(
        expect.objectContaining({
          responseBody: expect.objectContaining({ lifecycleMessageId: id }),
        })
      );
      const accepted: string[] = [];
      const round = await runEmailOutboxRound(
        h.deps('resend', 'accept', { now: later, accepted }),
        { ids: [id] }
      );
      expect(round).toMatchObject({ interrupted: 1, sent: 1 });
      expect(accepted).toEqual([id]);
      expect(await h.row(id)).toMatchObject({ status: 'accepted' });
      expect(await h.deliveries(id)).toHaveLength(1);
    });
  }
);
