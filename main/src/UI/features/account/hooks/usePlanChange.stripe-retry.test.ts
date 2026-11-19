import { describe, expect, it, vi } from 'vitest';
import type * as ReactQuery from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  loadStripe: vi.fn(),
  change: vi.fn(async () => ({
    status: 'requires_action',
    clientSecret: 'secret',
  })),
}));
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...(await importOriginal<typeof ReactQuery>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (req: unknown) => Promise<unknown>;
  }) => ({ mutateAsync: mutationFn }),
}));
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: mocks.loadStripe }));
vi.mock('../../../../application/environment/environment.config', () => ({
  ENV_VARS: { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_example' },
}));
vi.mock('../../../../domain/account/accountIO.possibilities.api', () => ({
  planChange_IO: mocks.change,
}));
import { usePlanChange } from './usePlanChange';

describe('plan change Stripe recovery', () => {
  it('can load Stripe on a later attempt after its script failed', async () => {
    mocks.loadStripe
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        handleNextAction: async () => ({ error: null }),
      });
    const mutation = usePlanChange();
    const request = {
      targetPlanId: 'PRO',
      billingPeriod: 'month',
      quoteId: 'q',
    } as Parameters<typeof mutation.mutateAsync>[0];
    await expect(mutation.mutateAsync(request)).rejects.toThrow('offline');
    await expect(mutation.mutateAsync(request)).resolves.toBe(true);
    expect(mocks.loadStripe).toHaveBeenCalledTimes(2);
  });
});
