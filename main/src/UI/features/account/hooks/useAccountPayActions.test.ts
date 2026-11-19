import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { useAccountPayActions } from './useAccountPayActions';

const state = vi.hoisted(() => ({
  createPortal: vi.fn(),
  snackbar: vi.fn(),
  mutate: vi.fn(),
  push: vi.fn(),
}));
vi.mock('next/router', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('../../../hooks/useCurrentLang', () => ({
  useCurrentLang: () => 'pl',
}));
vi.mock('../../../../application/analytics/posthog-client', () => ({
  capturePosthog: vi.fn(),
}));
vi.mock('../../../../domain/account/accountIO.possibilities.api', () => ({
  createPortalSession_IO: state.createPortal,
}));
vi.mock(
  '../../../../application/app-snackbar/appSnackbar.possibilities.api',
  () => ({ pushNewSnackbar: state.snackbar })
);
vi.mock('./usePlanChange', () => ({
  usePlanChange: () => ({ mutate: state.mutate }),
}));

function clickAction(action: () => void) {
  const button = document.createElement('button');
  button.addEventListener('click', action);
  button.click();
}

describe('plan portal actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.createPortal.mockReturnValue(new Promise(() => undefined));
  });
  it('opens management from a click without sending the DOM event as purpose', async () => {
    const { result } = renderHook(() =>
      useAccountPayActions({
        currentPlan: PricingPlanValue.STUDIO,
        billingPeriod: 'month',
      })
    );
    act(() => clickAction(result.current.openBillingPortal));
    await waitFor(() =>
      expect(state.createPortal).toHaveBeenCalledWith({
        purpose: 'manage',
        locale: 'pl',
      })
    );
    expect(result.current.openingPortal).toBe(true);
    expect(state.snackbar).not.toHaveBeenCalled();
  });
  it('keeps the cancellation entry bound to cancellation when clicked', async () => {
    const { result } = renderHook(() =>
      useAccountPayActions({
        currentPlan: PricingPlanValue.STUDIO,
        billingPeriod: 'month',
      })
    );
    act(() => clickAction(result.current.openCancellationPortal));
    await waitFor(() =>
      expect(state.createPortal).toHaveBeenCalledWith({
        purpose: 'cancel',
        locale: 'pl',
      })
    );
  });
});

describe('confirmed billing period changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.push.mockResolvedValue(true);
  });
  it.each(['refused', 'rejected'] as const)(
    'keeps an explicit summary link when successful change navigation is %s',
    async failure => {
      if (failure === 'refused') {
        state.push.mockResolvedValue(false);
      } else {
        state.push.mockRejectedValue(new Error('Route unavailable'));
      }
      const { result } = renderHook(() =>
        useAccountPayActions({
          currentPlan: PricingPlanValue.PRO,
          billingPeriod: 'year',
        })
      );
      act(() => result.current.selectPlan(PricingPlanValue.PRO_PLUS));
      act(() => result.current.confirmUpgrade('confirmed-quote'));
      const callback = state.mutate.mock.calls.at(-1)?.[1]?.onSuccess;
      await act(async () => {
        callback();
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(result.current.changeReturnHref).toContain('change=completed')
      );
      expect(result.current.changeReturnHref).toContain('plan=PRO_PLUS');
      expect(result.current.changeReturnHref).toContain('period=year');
      expect(state.mutate).toHaveBeenCalledOnce();
      expect(result.current.failedPlan).toBeNull();
      expect(result.current.upgradeTarget).toBeNull();
    }
  );
  it('offers the same tier for a different known billing period and forwards the quote', () => {
    const { result } = renderHook(() =>
      useAccountPayActions({
        currentPlan: PricingPlanValue.PRO,
        billingPeriod: 'year',
        currentBillingPeriod: 'month',
      })
    );
    act(() => result.current.selectPlan(PricingPlanValue.PRO));
    expect(result.current.upgradeTarget).toBe(PricingPlanValue.PRO);
    act(() => result.current.confirmUpgrade());
    expect(state.mutate).not.toHaveBeenCalled();
    act(() =>
      result.current.confirmUpgrade('92e0a485-f5fb-451c-848a-851165b7c998')
    );
    expect(state.mutate).toHaveBeenCalledWith(
      {
        targetPlanId: PricingPlanValue.PRO,
        billingPeriod: 'year',
        quoteId: '92e0a485-f5fb-451c-848a-851165b7c998',
      },
      expect.any(Object)
    );
  });
  it.each(['month', null] as const)(
    'does not offer an unchanged or unknown period (%s)',
    period => {
      const { result } = renderHook(() =>
        useAccountPayActions({
          currentPlan: PricingPlanValue.PRO,
          billingPeriod: 'month',
          currentBillingPeriod: period,
        })
      );
      act(() => result.current.selectPlan(PricingPlanValue.PRO));
      expect(result.current.upgradeTarget).toBeNull();
      expect(state.mutate).not.toHaveBeenCalled();
    }
  );
});
