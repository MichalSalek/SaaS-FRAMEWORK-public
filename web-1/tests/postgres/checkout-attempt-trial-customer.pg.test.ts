/** Exact provider trial history is checked before freezing checkout parameters. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { PrismaClient } from '../../src/prisma/js-client';
import { createAuthDb, type AuthDb } from './auth-db.fixture';
import { createAccount, FakeStripe } from './checkout-attempt-flow.pg.fixture';

const holder = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  stripe: null as unknown,
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
import { runCheckoutAttempt_IO } from '@domain/account/operations/checkout-attempt.operations';

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
  'provider subscription customer scope on real Postgres',
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
    it('ignores a subscription whose customer does not match even with matching metadata', async () => {
      const stripe = new FakeStripe();
      holder.stripe = stripe.api;
      const a = await createAccount(db, 'history_wrong_customer', true);
      stripe.listSubscriptions.mockResolvedValue({
        object: 'list',
        data: [
          {
            id: 'sub_wrong_customer',
            customer: 'cus_other',
            status: 'canceled',
            trial_start: 123,
            trial_end: 234,
            metadata: {
              projectId: 'nailfolio',
              planId: 'app-price-1',
              accountId: a.accountId,
            },
          } as unknown as Stripe.Subscription,
        ],
        has_more: false,
        url: '/v1/subscriptions',
      });
      const result = await runCheckoutAttempt_IO({
        intent: { ...a.intent, expectedTrialDays: 0 },
        prepare: a.prepare,
      });
      expect(result.success).toBe(true);
      const saved = await db.seeder.stylistAccount.findUniqueOrThrow({
        where: { account_id: a.accountId },
        select: { trial_started_at: true, trial_ends_at: true },
      });
      expect(saved).toEqual({ trial_started_at: null, trial_ends_at: null });
    });
  }
);
