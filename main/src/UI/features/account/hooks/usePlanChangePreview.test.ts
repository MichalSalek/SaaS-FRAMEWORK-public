import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { createQueryWrapper } from '../../../../test-utils/renderWithProviders';
import { usePlanChangePreview } from './usePlanChangePreview';
const { preview } = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('../../../../domain/account/accountIO.possibilities.api', () => ({
  previewPlanChange_IO: preview,
}));
const quote = () => ({
  quoteId: '92e0a485-f5fb-451c-848a-851165b7c998',
  expiresAt: new Date(Date.now() + 10000).toISOString(),
  amountDue: 0,
  total: 0,
  taxAmount: 0,
  currency: 'pln',
  billingPeriod: 'month',
  trialEndsAt: null,
  cancelAt: null,
});
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}
describe('read-only plan-change preview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    preview.mockResolvedValue(quote());
  });
  afterEach(() => vi.useRealTimers());
  it.each([null, PricingPlanValue.FREE])(
    'does not request a price for %s',
    plan => {
      renderHook(() => usePlanChangePreview(plan, 'month'), {
        wrapper: createQueryWrapper(),
      });
      expect(preview).not.toHaveBeenCalled();
    }
  );
  it('permits a confirmed zero quote, disables it when expired, and never refreshes silently', async () => {
    const { result } = renderHook(
      () => usePlanChangePreview(PricingPlanValue.STUDIO, 'month'),
      { wrapper: createQueryWrapper() }
    );
    await settle();
    await settle();
    expect(result.current.data?.amountDue).toBe(0);
    expect(result.current.canConfirm).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10001);
    });
    expect(result.current.expired).toBe(true);
    expect(result.current.canConfirm).toBe(false);
    expect(preview).toHaveBeenCalledTimes(1);
  });
  it('does not reuse another target quote while its new price is pending', async () => {
    const { result, rerender } = renderHook<
      ReturnType<typeof usePlanChangePreview>,
      { plan: PricingPlan }
    >(
      ({ plan }: { plan: PricingPlan }) => usePlanChangePreview(plan, 'month'),
      {
        initialProps: { plan: PricingPlanValue.PRO },
        wrapper: createQueryWrapper(),
      }
    );
    await settle();
    await settle();
    expect(result.current.canConfirm).toBe(true);
    preview.mockReturnValueOnce(new Promise(() => undefined));
    rerender({ plan: PricingPlanValue.STUDIO });
    await settle();
    expect(result.current.canConfirm).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
  it('explains a canceled subscription cycle rejection without offering confirmation', async () => {
    preview.mockRejectedValue(
      Object.assign(new Error('VALIDATION_FAILED'), {
        httpError: { data: { field: 'quoteId', reason: 'canceling' } },
      })
    );
    const { result } = renderHook(
      () => usePlanChangePreview(PricingPlanValue.STUDIO, 'year'),
      { wrapper: createQueryWrapper() }
    );
    await settle();
    await settle();
    expect(result.current.canceling).toBe(true);
    expect(result.current.canConfirm).toBe(false);
  });
});
