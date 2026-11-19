import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { retrieve, preview } = vi.hoisted(() => ({
  retrieve: vi.fn(),
  preview: vi.fn(),
}));
vi.mock('./adapters/stripe.adapter', () => ({
  getStripe: () => ({
    subscriptions: { retrieve },
    invoices: { createPreview: preview },
  }),
}));
import { readSubscriptionBilling_IO } from './subscription-billing.operations';

const ownedSubscription = (canceling = false) => ({
  metadata: { accountId: 'owned' },
  status: 'trialing',
  cancel_at_period_end: canceling,
  cancel_at: null,
  trial_end: 1800000000,
  items: {
    data: [
      {
        current_period_end: 1800000000,
        price: {
          currency: 'pln',
          recurring: { interval: 'month' },
          product: { metadata: { planId: PLAN_ID_MAP.STUDIO } },
        },
      },
    ],
  },
});

describe('billing read cache and concurrent callers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    retrieve.mockResolvedValue(ownedSubscription());
    preview.mockResolvedValue({ amount_due: 0, currency: 'pln' });
  });
  afterEach(() => vi.useRealTimers());
  it('waits for the same in-flight read instead of inventing an unavailable result for a second browser', async () => {
    let finish:
      ((value: ReturnType<typeof ownedSubscription>) => void) | undefined;
    retrieve.mockReturnValueOnce(
      new Promise<ReturnType<typeof ownedSubscription>>(resolve => {
        finish = resolve;
      })
    );
    const first = readSubscriptionBilling_IO('sub_concurrent', 'owned');
    const second = readSubscriptionBilling_IO('sub_concurrent', 'owned');
    if (!finish) {
      throw new Error('Nie uruchomiono odczytu subskrypcji');
    }
    finish(ownedSubscription());
    const [a, b] = await Promise.all([first, second]);
    expect(a?.nextChargeAmount).toBe(0);
    expect(b).toEqual(a);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledTimes(1);
  });
  it('keeps a confirmed cancellation summary in the cache', async () => {
    retrieve.mockResolvedValueOnce(ownedSubscription(true));
    const first = await readSubscriptionBilling_IO(
      'sub_canceling_cache',
      'owned'
    );
    const second = await readSubscriptionBilling_IO(
      'sub_canceling_cache',
      'owned'
    );
    expect(first).toMatchObject({
      nextChargeAmount: null,
      billingPeriod: 'monthly',
    });
    expect(second).toEqual(first);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalled();
  });
  it('retries a failed read after the existing cache lifetime expires', async () => {
    retrieve.mockRejectedValueOnce(new Error('temporary failure'));
    expect(
      await readSubscriptionBilling_IO('sub_failure_cache', 'owned')
    ).toBeNull();
    expect(
      await readSubscriptionBilling_IO('sub_failure_cache', 'owned')
    ).toBeNull();
    expect(retrieve).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5001);
    expect(
      (await readSubscriptionBilling_IO('sub_failure_cache', 'owned'))
        ?.nextChargeAmount
    ).toBe(0);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });
});
