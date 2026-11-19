import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlanPortalReturn } from './usePlanPortalReturn';
vi.mock('./useCheckoutPortalResume', () => ({
  useCheckoutPortalResume: () => ({
    waiting: false,
    failed: false,
    retry: () => {},
  }),
}));

const state = vi.hoisted(() => ({
  marker: 'canceled' as string | undefined,
  kind: 'active',
  isError: false,
  updatedAt: 1,
  refetch: vi.fn(),
}));
vi.mock('next/router', () => ({
  useRouter: () => ({ query: { portal: state.marker } }),
}));
vi.mock('../../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    data: { stylist_account: { kind: state.kind } },
    isError: state.isError,
    dataUpdatedAt: state.updatedAt,
    refetch: state.refetch,
  }),
}));
vi.mock('../AccountPayPage.helpers', () => ({
  resolvePlanStatusSummary: (account: { kind: string }) => ({
    kind: account.kind,
  }),
}));
function response(kind = 'active', isError = false) {
  return {
    data: { stylist_account: { kind } },
    isError,
    dataUpdatedAt: state.updatedAt,
  };
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('portal return truth and bounded polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.marker = 'canceled';
    state.kind = 'active';
    state.isError = false;
    state.updatedAt = 1;
    state.refetch.mockReset().mockResolvedValue(response());
  });
  afterEach(() => vi.useRealTimers());

  it('renders a plain Plan visit without a marker', async () => {
    state.marker = undefined;
    const { result } = renderHook(usePlanPortalReturn);
    await flush();
    expect(result.current.returned).toBe(false);
    expect(result.current.waiting).toBe(false);
    expect(state.refetch).not.toHaveBeenCalled();
  });
  it('does not poll an unknown marker', async () => {
    state.marker = 'invented';
    const { result } = renderHook(usePlanPortalReturn);
    await flush();
    expect(state.refetch).not.toHaveBeenCalled();
    expect(result.current.returned).toBe(false);
  });
  it('waits for the webhook instead of treating a cancellation marker as proof', async () => {
    state.refetch
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response('canceling'));
    const { result } = renderHook(usePlanPortalReturn);
    await flush();
    expect(result.current.waiting).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.waiting).toBe(false);
    expect(result.current.timedOut).toBe(false);
  });
  it('a back marker does not claim a successful refresh after a query failure', async () => {
    state.marker = 'back';
    state.refetch.mockResolvedValue(response('active', true));
    const { result } = renderHook(usePlanPortalReturn);
    await flush();
    expect(result.current.timedOut).toBe(true);
  });
  it('bounds a stalled request and starts a fresh polling window on retry', async () => {
    state.refetch.mockImplementationOnce(() => new Promise(() => undefined));
    const { result } = renderHook(usePlanPortalReturn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(result.current.timedOut).toBe(true);
    state.refetch.mockResolvedValue(response('canceling'));
    act(() => result.current.retry());
    expect(result.current.waiting).toBe(true);
    await flush();
    expect(result.current.timedOut).toBe(false);
  });
  it('clears a timeout when a later successful account read observes cancellation', async () => {
    const { result, rerender } = renderHook(usePlanPortalReturn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(result.current.timedOut).toBe(true);
    state.kind = 'canceling';
    state.updatedAt = Date.now() + 1;
    rerender();
    expect(result.current.timedOut).toBe(false);
  });
  it('resets completion when the return marker changes', async () => {
    state.marker = 'back';
    const { result, rerender } = renderHook(usePlanPortalReturn);
    await flush();
    expect(result.current.waiting).toBe(false);
    state.marker = 'canceled';
    rerender();
    expect(result.current.waiting).toBe(true);
    await flush();
    expect(result.current.waiting).toBe(true);
  });
});
