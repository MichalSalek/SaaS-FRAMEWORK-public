import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const mocks = vi.hoisted(() => ({
  writer: vi.fn(async () => true),
  lock: vi.fn(async () => ({ id: 'user' })),
  advisory: vi.fn(async () => undefined),
  outbox: vi.fn(async () => null),
}));
const account = {
  account_id: 'account',
  created_by_user_id: 'user',
  subscription_id: 'sub_old',
  pricing_plan: 'PRO',
};
vi.mock('@app/db/lock-rows', () => ({
  lockUserRow: mocks.lock,
  acquireAdvisoryXactLock: mocks.advisory,
}));
vi.mock('@app/stripe/webhooks/stripe-webhooks.db', () => ({
  findAccountByCustomerId: vi.fn(async () => account),
}));
vi.mock('@app/stripe/webhooks/stripe-webhooks.utils', () => ({
  extractCustomerId: ({ customer }: { customer: string }) => customer,
  buildCriticalAlertEffect: () => async () => undefined,
}));
vi.mock('@app/stripe/plan-status-update.operations', () => ({
  updateAccountPlanStatus: mocks.writer,
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('@app/email-handler/outbox/email-outbox', () => ({
  enqueueEmailOutboxTx: mocks.outbox,
  kickEmailOutbox: vi.fn(),
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: { user: { findUnique: vi.fn(async () => null) } } },
}));
vi.mock('./subscription-update.utils', () => ({
  handleDowngradeAlert: vi.fn(async () => null),
}));
vi.mock('@domain/pairing/salon-derived-cleanup.operations', () => ({
  reconcileSalonDerivedPairings_IO: vi.fn(),
}));
import { handleSubscriptionDeleted } from './subscription-deleted.handler';

const eventCreatedAt = new Date(1_800_000_000_000);
const partialSubscription: Partial<Stripe.Subscription> = {
  id: 'sub_old',
  customer: 'cus_1',
  status: 'canceled',
  metadata: { attemptId: 'old', accountId: 'account' },
};
const subscription = partialSubscription as Stripe.Subscription;
const makeTx = (attemptId: string) => ({
  $queryRaw: vi.fn(async () => [
    {
      attempt_id: attemptId,
      phase: 'preparing',
      stripe_session_id: null,
      stripe_subscription_id: null,
    },
  ]),
  stylistAccount: {
    findUnique: vi.fn(async () => ({
      subscription_id: 'sub_old',
      subscription_status: 'ACTIVE',
    })),
  },
  user: { findUnique: vi.fn(async () => null) },
});

describe('subscription.deleted checkout generation fence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.subscription_id = 'sub_old';
  });
  it('does not reset the old current pointer or advance its watermark after a new attempt starts', async () => {
    const tx = makeTx('new');
    const result = await handleSubscriptionDeleted({
      subscription,
      eventCreatedAt,
      tx: tx as never,
    });
    expect(result.effects).toEqual([]);
    expect(mocks.writer).not.toHaveBeenCalled();
    expect(mocks.outbox).not.toHaveBeenCalled();
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0] ?? 0
    );
  });
  it('allows a matching current generation', async () => {
    const tx = makeTx('old');
    await handleSubscriptionDeleted({
      subscription,
      eventCreatedAt,
      tx: tx as never,
    });
    expect(mocks.writer).toHaveBeenCalledTimes(1);
  });
  it('preserves the legacy subscription-id fallback for an untagged event', async () => {
    const legacy = { ...subscription, metadata: {} };
    await handleSubscriptionDeleted({ subscription: legacy, eventCreatedAt });
    expect(mocks.writer).toHaveBeenCalledTimes(1);
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it('requires a transaction for tagged events and propagates a failed lookup', async () => {
    await expect(
      handleSubscriptionDeleted({ subscription, eventCreatedAt })
    ).rejects.toThrow('requires a database transaction');
    const tx = makeTx('new');
    tx.$queryRaw.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      handleSubscriptionDeleted({
        subscription,
        eventCreatedAt,
        tx: tx as never,
      })
    ).rejects.toThrow('database unavailable');
    expect(mocks.writer).not.toHaveBeenCalled();
  });
});
