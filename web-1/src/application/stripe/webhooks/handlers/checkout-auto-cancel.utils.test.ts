/**
 * autoCancelOldSubscription — closes the write-ahead reconcile row on success and
 * re-arms it on a final failure (SPAR-001).
 */
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { retryMock, enqueueMock, resolveMock, alertMock } = vi.hoisted(() => ({
  retryMock: vi.fn(),
  enqueueMock: vi.fn(async (_arg: unknown) => undefined),
  resolveMock: vi.fn(async (_arg: unknown) => undefined),
  alertMock: vi.fn((_arg: unknown) => undefined),
}));

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({ subscriptions: { cancel: vi.fn() } }),
}));
vi.mock('@app/stripe/stripe-retry.utils', () => ({
  retryStripeOperation: retryMock,
}));
vi.mock('@app/stripe/cancel-reconcile/stripe-cancel-reconcile.queue', () => ({
  enqueueSubscriptionCancelReconcile: enqueueMock,
  resolveSubscriptionCancelReconcile: resolveMock,
}));
vi.mock('@app/stripe/webhooks/stripe-webhooks.utils', () => ({
  dispatchCriticalAlert: alertMock,
}));
vi.mock('@app/stripe/stripe-dashboard.links', () => ({
  stripeDashboardLinkProp: () => ({}),
}));

import { autoCancelOldSubscription } from './checkout-auto-cancel.utils';

const input = {
  accountId: 'acc_1',
  userId: 'usr_1',
  userEmail: null,
  oldSubscriptionId: 'sub_old',
  newSubscriptionId: 'sub_new',
  session: { id: 'cs_1', customer: 'cus_1' } as Stripe.Checkout.Session,
};

const ROW = { subscriptionId: 'sub_old', userId: 'usr_1', flavor: 'duplicate' };

describe('autoCancelOldSubscription — write-ahead row lifecycle', () => {
  beforeEach(() => {
    retryMock.mockReset();
    enqueueMock.mockClear();
    resolveMock.mockClear();
    alertMock.mockClear();
  });

  it('closes the duplicate row after a successful cancel', async () => {
    retryMock.mockResolvedValue({ ok: true, attempts: [{}] });

    await autoCancelOldSubscription(input);

    expect(resolveMock).toHaveBeenCalledWith(ROW);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('closes the duplicate row when Stripe says the subscription is already gone', async () => {
    retryMock.mockResolvedValue({
      ok: false,
      attempts: [{ errorCode: 'resource_missing', errorStatus: 404 }],
    });

    await autoCancelOldSubscription(input);

    expect(resolveMock).toHaveBeenCalledWith(ROW);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('re-arms the row and alerts on a final failure, leaving it open', async () => {
    retryMock.mockResolvedValue({
      ok: false,
      attempts: [{ errorStatus: 500, errorMessage: 'api down' }],
    });

    await autoCancelOldSubscription(input);

    expect(resolveMock).not.toHaveBeenCalled();
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ ...ROW, reason: 'api down' })
    );
    expect(alertMock).toHaveBeenCalledTimes(1);
  });
});
