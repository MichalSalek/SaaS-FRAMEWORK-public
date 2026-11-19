/** Changed selection after an ambiguous provider create uses the old immutable key. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import { createAuthDb, type AuthDb } from './auth-db.fixture';
import { createAccount, FakeStripe } from './checkout-attempt-flow.pg.fixture';

const holder = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  stripe: null as unknown,
  report: vi.fn(),
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (!holder.client) {
        throw new Error('No test DB');
      }
      return holder.client;
    },
  },
}));
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => holder.stripe,
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: holder.report,
}));
import { runCheckoutAttempt_IO } from '@domain/account/operations/checkout-attempt.operations';
import { prismaCheckoutAttemptStore as store } from '@domain/account/operations/checkout-attempt.store';

const url =
  process.env.CHECKOUT_ATTEMPT_DATABASE_URL ??
  process.env.CHECKOUT_ATTEMPT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname) ||
    !/^\/nf_(ci|checkout_[a-z0-9_]+)$/.test(parsed.pathname)
  ) {
    throw new Error('Disposable loopback database required');
  }
}
describe.skipIf(!url)(
  'changed checkout after unknown provider response',
  () => {
    let db: AuthDb;
    beforeAll(async () => {
      vi.stubEnv('DIRECT_DATABASE_URL', url ?? '');
      vi.stubEnv('SHADOW_DATABASE_URL', '');
      db = await createAuthDb(url ?? '');
      holder.client = db.seeder;
    }, 120000);
    afterAll(async () => {
      await db?.drop();
      vi.unstubAllEnvs();
    });
    it('replays old params, retires that session, then allows a new generation and redacts the incident', async () => {
      const stripe = new FakeStripe();
      holder.stripe = stripe.api;
      const a = await createAccount(db, 'recovery_changed', true);
      let first = true;
      stripe.beforeCreateHook = async () => {
        if (first) {
          first = false;
          throw Object.assign(new Error('sensitive_body_marker'), {
            statusCode: 500,
            type: 'StripeAPIError',
            code: 'api_error',
            raw: { secret: 'sensitive_payload_marker' },
          });
        }
      };
      const old = await runCheckoutAttempt_IO({
        intent: a.intent,
        prepare: a.prepare,
      });
      expect(old).toMatchObject({
        success: false,
        error: { type: 'CHECKOUT_ATTEMPT_BUSY' },
      });
      const saved = await store.read(a.accountId);
      expect(saved?.stripe_params).not.toBeNull();
      const nextIntent = { ...a.intent, planId: 'PRO_PLUS' as const };
      const next = await runCheckoutAttempt_IO({
        intent: nextIntent,
        prepare: a.prepare,
      });
      expect(next).toMatchObject({
        success: false,
        error: { type: 'CHECKOUT_ATTEMPT_BUSY' },
      });
      expect(stripe.calls).toHaveLength(2);
      expect(stripe.calls[1]?.params).toEqual(stripe.calls[0]?.params);
      expect(stripe.calls[1]?.options.idempotencyKey).toBe(
        stripe.calls[0]?.options.idempotencyKey
      );
      expect([...stripe.sessions.values()][0]?.status).toBe('expired');
      expect((await store.read(a.accountId))?.phase).toBe('expired');
      const final = await runCheckoutAttempt_IO({
        intent: nextIntent,
        prepare: a.prepare,
      });
      expect(final.success).toBe(true);
      expect(stripe.calls).toHaveLength(3);
      expect(stripe.calls[2]?.options.idempotencyKey).not.toBe(
        stripe.calls[0]?.options.idempotencyKey
      );
      expect(holder.report).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'CHECKOUT_ATTEMPT_CREATE_UNCERTAIN',
          payload: expect.objectContaining({
            accountId: a.accountId,
            attemptId: saved?.attempt_id,
            type: 'StripeAPIError',
            code: 'api_error',
            status: 500,
          }),
        })
      );
      expect(JSON.stringify(holder.report.mock.calls)).not.toContain(
        'sensitive_body_marker'
      );
      expect(JSON.stringify(holder.report.mock.calls)).not.toContain(
        'sensitive_payload_marker'
      );
    });
  }
);
