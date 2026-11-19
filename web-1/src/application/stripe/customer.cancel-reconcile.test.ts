/**
 * cancelStripeSubscriptionIfExists — reconcile flavor plumbing.
 * Deletion keeps the default 'deletion' row; admin downgrades pass 'duplicate'
 * so the row is not closed by the reactivation guard while the user lives.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockDb } from '../../test-utils/mockApiHandler';

const { retryMock, enqueueMock, resolveMock } = vi.hoisted(() => ({
  retryMock: vi.fn(),
  enqueueMock: vi.fn(async (_arg: unknown) => undefined),
  resolveMock: vi.fn(async (_arg: unknown) => undefined),
}));

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('./adapters/stripe.adapter', () => ({
  getStripe: () => ({ subscriptions: { cancel: vi.fn() } }),
}));
vi.mock('./stripe-retry.utils', () => ({ retryStripeOperation: retryMock }));
vi.mock('./webhooks/stripe-webhooks.utils', () => ({
  dispatchCriticalAlert: vi.fn(),
}));
vi.mock('./cancel-reconcile/stripe-cancel-reconcile.queue', () => ({
  enqueueSubscriptionCancelReconcile: enqueueMock,
  resolveSubscriptionCancelReconcile: resolveMock,
}));

import { cancelStripeSubscriptionIfExists } from './customer.operations';

describe('cancelStripeSubscriptionIfExists — reconcile flavor', () => {
  beforeEach(() => {
    retryMock.mockReset();
    enqueueMock.mockClear();
    resolveMock.mockClear();
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          subscription_id: 'sub_1',
          account_id: 'acc_1',
          stripe_customer_id: 'cus_1',
        }),
      },
    });
  });

  it('closes the default deletion row after a successful cancel', async () => {
    retryMock.mockResolvedValue({ ok: true, attempts: [{}] });

    await cancelStripeSubscriptionIfExists('usr_1');

    expect(resolveMock).toHaveBeenCalledWith({
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      flavor: 'deletion',
    });
  });

  it('enqueues the duplicate flavor on a final failure when the caller asks for it', async () => {
    retryMock.mockResolvedValue({
      ok: false,
      attempts: [{ errorStatus: 500, errorMessage: 'api down' }],
    });

    await cancelStripeSubscriptionIfExists('usr_1', {
      reconcileFlavor: 'duplicate',
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub_1',
        userId: 'usr_1',
        flavor: 'duplicate',
      })
    );
    expect(resolveMock).not.toHaveBeenCalled();
  });
});
