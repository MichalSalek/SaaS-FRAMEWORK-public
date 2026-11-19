import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePendingPaymentRefresh } from './usePendingPaymentRefresh';
const payment = () => ({
  reason: 'plan_change' as const,
  invoiceId: 'in_pending',
  url: 'https://invoice.stripe.com/i/qa',
  amountRemaining: 1200,
  currency: 'pln',
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
});
describe('unfinished invoice refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('keeps ordinary accounts quiet', async () => {
    const refresh = vi.fn();
    renderHook(() => usePendingPaymentRefresh(undefined, refresh));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(refresh).not.toHaveBeenCalled();
  });
  it('refreshes a visible invoice and finishes bounded settling reads when the invoice disappears', async () => {
    const refresh = vi.fn();
    const p = payment();
    const { rerender, unmount } = renderHook(
      ({ active }) => usePendingPaymentRefresh(active ? p : undefined, refresh),
      { initialProps: { active: true } }
    );
    expect(refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(refresh).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(refresh).toHaveBeenCalledTimes(3);
    unmount();
  });
  it('does not poll a hidden tab and disables an expired attempt', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const refresh = vi.fn();
    const p = payment();
    const { result, unmount } = renderHook(() =>
      usePendingPaymentRefresh(p, refresh)
    );
    await act(() => vi.advanceTimersByTimeAsync(30_001));
    expect(refresh).not.toHaveBeenCalled();
    expect(result.current).toBe(true);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(refresh).not.toHaveBeenCalled();
  });
  it('does not immediately retry every cached expired response', async () => {
    const refresh = vi.fn();
    const p = {
      ...payment(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    };
    const { rerender } = renderHook(
      ({ value }) => usePendingPaymentRefresh(value, refresh),
      { initialProps: { value: p } }
    );
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ value: { ...p } });
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
