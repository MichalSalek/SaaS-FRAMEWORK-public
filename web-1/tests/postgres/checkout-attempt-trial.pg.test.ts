/** Exact provider trial history is checked before freezing checkout parameters. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { success } from '@kernel/application/result.types';
import { canStartTrial } from '@kernel/domain/pricing/pricing-policy';
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
describe.skipIf(!url)('provider trial history on real Postgres', () => {
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
  it('removes a used exact-account trial, but ignores another project or account', async () => {
    const stripe = new FakeStripe();
    holder.stripe = stripe.api;
    for (const [key, matching, projectId, otherAccount, planId] of [
      ['history_own', true, 'nailfolio', false, 'app-price-1'],
      ['history_foreign_project', false, 'other', false, 'app-price-1'],
      ['history_foreign_account', false, 'nailfolio', true, 'app-price-1'],
      ['history_foreign_plan', false, 'nailfolio', false, 'other-price'],
    ] as const) {
      const a = await createAccount(db, key, true);
      stripe.subs.push({
        id: `sub_${key}`,
        customer: a.customerId,
        status: 'canceled',
        trial_start: 1234567890,
        metadata: {
          projectId,
          planId,
          accountId: otherAccount ? 'different_account' : a.accountId,
        },
      } as unknown as Stripe.Subscription);
      const prepare = async () => {
        const result = await a.prepare();
        if (!result.success) {
          return result;
        }
        return success({
          ...result.data,
          params: {
            ...result.data.params,
            subscription_data: {
              ...result.data.params.subscription_data,
              trial_period_days: 30,
            },
          },
        });
      };
      const result = await runCheckoutAttempt_IO({
        intent: { ...a.intent, expectedTrialDays: matching ? 0 : 30 },
        prepare,
      });
      expect(result.success).toBe(true);
      expect(
        stripe.calls.at(-1)?.params.subscription_data?.trial_period_days
      ).toBe(matching ? undefined : 30);
      const saved = await db.seeder.stylistAccount.findUniqueOrThrow({
        where: { account_id: a.accountId },
        select: { trial_started_at: true },
      });
      expect(saved.trial_started_at?.getTime() ?? null).toBe(
        matching ? 1234567890000 : null
      );
    }
  });
  it('requires confirmation of effective 14 days or zero before minting', async () => {
    for (const [key, trialDays, expected, succeeds] of [
      ['terms_14', 14, 14, true],
      ['terms_zero', 0, 0, true],
      ['terms_missing', 14, undefined, false],
      ['terms_stale', 14, 30, false],
      ['terms_no_trial', 0, 14, false],
    ] as const) {
      const stripe = new FakeStripe();
      holder.stripe = stripe.api;
      const a = await createAccount(db, key, true);
      const prepare = async () => {
        const result = await a.prepare();
        if (!result.success) {
          return result;
        }
        return success({
          ...result.data,
          params: {
            ...result.data.params,
            subscription_data: {
              ...result.data.params.subscription_data,
              ...(trialDays ? { trial_period_days: trialDays } : {}),
            },
          },
        });
      };
      const { expectedTrialDays: _expectedTrialDays, ...legacyIntent } =
        a.intent;
      const result = await runCheckoutAttempt_IO({
        intent: {
          ...legacyIntent,
          ...(expected === undefined ? {} : { expectedTrialDays: expected }),
        },
        prepare,
      });
      expect(result.success).toBe(succeeds);
      if (!result.success) {
        expect(result.error).toEqual({
          type: 'CHECKOUT_TERMS_CHANGED',
          trialDays,
        });
      }
      expect(stripe.create).toHaveBeenCalledTimes(succeeds ? 1 : 0);
      if (result.success) {
        expect(result.data.trialDays).toBe(trialDays);
      }
    }
  });

  it('rejects changed provider eligibility and resumes a frozen 30-day session despite a new expectation', async () => {
    const stripe = new FakeStripe();
    holder.stripe = stripe.api;
    const a = await createAccount(db, 'terms_history_changed', true);
    stripe.subs.push({
      id: 'sub_used',
      customer: a.customerId,
      status: 'canceled',
      trial_start: 123,
      trial_end: 123 + 30 * 86400,
      metadata: {
        projectId: 'nailfolio',
        planId: 'app-price-1',
        accountId: a.accountId,
      },
    } as unknown as Stripe.Subscription);
    const trialPrepare = (days: number) => async () => {
      const result = await a.prepare();
      if (!result.success) {
        return result;
      }
      return success({
        ...result.data,
        params: {
          ...result.data.params,
          subscription_data: {
            ...result.data.params.subscription_data,
            trial_period_days: days,
          },
        },
      });
    };
    const changed = await runCheckoutAttempt_IO({
      intent: { ...a.intent, expectedTrialDays: 14 },
      prepare: trialPrepare(14),
    });
    expect(changed).toEqual({
      success: false,
      error: { type: 'CHECKOUT_TERMS_CHANGED', trialDays: 0 },
    });
    expect(stripe.create).not.toHaveBeenCalled();
    const reloaded = await db.seeder.stylistAccount.findUniqueOrThrow({
      where: { account_id: a.accountId },
      select: {
        trial_started_at: true,
        trial_ends_at: true,
        payment_status: true,
      },
    });
    expect(reloaded.trial_started_at).toEqual(new Date(123000));
    expect(reloaded.trial_ends_at).toEqual(new Date((123 + 30 * 86400) * 1000));
    expect(
      canStartTrial({
        trialStartedAt: reloaded.trial_started_at,
        paymentStatus: reloaded.payment_status,
      })
    ).toBe(false);
    const paid = await runCheckoutAttempt_IO({
      intent: { ...a.intent, expectedTrialDays: 0 },
      prepare: a.prepare,
    });
    expect(paid.success && paid.data.trialDays).toBe(0);
    expect(stripe.create).toHaveBeenCalledTimes(1);

    const b = await createAccount(db, 'terms_frozen_30', true);
    const prepare30 = async () => {
      const result = await b.prepare();
      if (!result.success) {
        return result;
      }
      return success({
        ...result.data,
        params: {
          ...result.data.params,
          subscription_data: {
            ...result.data.params.subscription_data,
            trial_period_days: 30,
          },
        },
      });
    };
    const first = await runCheckoutAttempt_IO({
      intent: { ...b.intent, expectedTrialDays: 30 },
      prepare: prepare30,
    });
    const existingStart = new Date('2026-01-01T00:00:00Z');
    const existingEnd = new Date('2026-01-31T00:00:00Z');
    await db.seeder.stylistAccount.update({
      where: { account_id: b.accountId },
      data: { trial_started_at: existingStart, trial_ends_at: existingEnd },
    });
    const resumed = await runCheckoutAttempt_IO({
      intent: { ...b.intent, expectedTrialDays: 14 },
      prepare: prepare30,
    });
    const { expectedTrialDays: _expectedTrialDays, ...legacyIntent } = b.intent;
    const legacy = await runCheckoutAttempt_IO({
      intent: legacyIntent,
      prepare: prepare30,
    });
    expect(first.success && resumed.success && legacy.success).toBe(true);
    if (first.success && resumed.success && legacy.success) {
      expect(resumed.data.session.id).toBe(first.data.session.id);
      expect(legacy.data.session.id).toBe(first.data.session.id);
      expect(resumed.data.trialDays).toBe(30);
      expect(legacy.data.trialDays).toBe(30);
    }
    expect(stripe.create).toHaveBeenCalledTimes(2);
    const existing = await db.seeder.stylistAccount.findUniqueOrThrow({
      where: { account_id: b.accountId },
      select: { trial_started_at: true, trial_ends_at: true },
    });
    expect(existing).toEqual({
      trial_started_at: existingStart,
      trial_ends_at: existingEnd,
    });
  });
  it.each(['active', 'incomplete'])(
    'never writes a partial provider scan (%s)',
    async kind => {
      const stripe = new FakeStripe();
      holder.stripe = stripe.api;
      const a = await createAccount(db, `partial_${kind}`, true);
      const base = {
        customer: a.customerId,
        metadata: {
          projectId: 'nailfolio',
          planId: 'app-price-1',
          accountId: a.accountId,
        },
      };
      stripe.listSubscriptions.mockResolvedValueOnce({
        object: 'list',
        data: [
          {
            ...base,
            id: 'sub_first',
            status: 'canceled',
            trial_start: 123,
            trial_end: 234,
          } as unknown as Stripe.Subscription,
        ],
        has_more: true,
        url: '/v1/subscriptions',
      });
      stripe.listSubscriptions.mockResolvedValueOnce({
        object: 'list',
        data:
          kind === 'active'
            ? [
                {
                  ...base,
                  id: 'sub_active',
                  status: 'active',
                  trial_start: null,
                } as unknown as Stripe.Subscription,
              ]
            : [],
        has_more: kind === 'incomplete',
        url: '/v1/subscriptions',
      });
      const result = await runCheckoutAttempt_IO({
        intent: { ...a.intent, expectedTrialDays: 14 },
        prepare: a.prepare,
      });
      expect(result.success).toBe(false);
      const saved = await db.seeder.stylistAccount.findUniqueOrThrow({
        where: { account_id: a.accountId },
        select: { trial_started_at: true, trial_ends_at: true },
      });
      expect(saved).toEqual({ trial_started_at: null, trial_ends_at: null });
      expect(stripe.create).not.toHaveBeenCalled();
    }
  );
});
