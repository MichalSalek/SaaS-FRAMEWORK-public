import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  unread: undefined as number | undefined,
}));
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: () => ({
    data: {
      conversations: [{ pair_id: 'live', unread_count: 2 }],
      next_cursor: 'first',
      unread_count: state.unread,
    },
  }),
}));
vi.mock(
  '../../../../../domain/messaging/messagingIO.possibilities.api',
  () => ({ getConversations_IO: state.get })
);
import { useConversations, useUnreadMessagesCount } from './useConversations';

function deferred() {
  let resolve!: (value: {
    conversations: { pair_id: string }[];
    next_cursor: string | null;
  }) => void;
  const promise = new Promise<{
    conversations: { pair_id: string }[];
    next_cursor: string | null;
  }>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('conversation pagination identity', () => {
  beforeEach(() => {
    state.get.mockReset();
    state.unread = undefined;
  });
  it('does not append a visible-list response to the hidden list', async () => {
    const page = deferred();
    state.get.mockReturnValueOnce(page.promise);
    const view = renderHook(({ hidden }) => useConversations(hidden), {
      initialProps: { hidden: false },
    });
    let pending!: Promise<void>;
    act(() => {
      pending = view.result.current.loadOlder();
    });
    view.rerender({ hidden: true });
    await act(async () => {
      page.resolve({
        conversations: [{ pair_id: 'visible-only' }],
        next_cursor: 'wrong',
      });
      await pending;
    });
    expect(view.result.current.conversations.map(c => c.pair_id)).not.toContain(
      'visible-only'
    );
    state.get.mockResolvedValueOnce({ conversations: [], next_cursor: null });
    await act(async () => {
      await view.result.current.loadOlder();
    });
    expect(state.get.mock.calls[1]?.[0]).toEqual({
      cursor: 'first',
      hidden: true,
    });
  });
  it('does not apply an old mode page, cursor or finalizer after an ABA switch', async () => {
    const stale = deferred(),
      current = deferred();
    state.get
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    const view = renderHook(({ hidden }) => useConversations(hidden), {
      initialProps: { hidden: false },
    });
    let first!: Promise<void>, second!: Promise<void>;
    act(() => {
      first = view.result.current.loadOlder();
    });
    view.rerender({ hidden: true });
    view.rerender({ hidden: false });
    act(() => {
      second = view.result.current.loadOlder();
    });
    await act(async () => {
      stale.resolve({
        conversations: [{ pair_id: 'stale' }],
        next_cursor: 'bad',
      });
      await first;
    });
    expect(view.result.current.isLoadingOlder).toBe(true);
    expect(view.result.current.conversations.map(c => c.pair_id)).not.toContain(
      'stale'
    );
    await act(async () => {
      current.resolve({
        conversations: [{ pair_id: 'current' }],
        next_cursor: 'good',
      });
      await second;
    });
    expect(view.result.current.conversations.map(c => c.pair_id)).toContain(
      'current'
    );
    state.get.mockResolvedValueOnce({ conversations: [], next_cursor: null });
    await act(async () => {
      await view.result.current.loadOlder();
    });
    expect(state.get.mock.calls[2]?.[0]).toEqual({ cursor: 'good' });
  });
  it('uses the backend total, falling back only when absent', () => {
    state.unread = 17;
    const view = renderHook(() => useUnreadMessagesCount());
    expect(view.result.current).toBe(17);
    state.unread = 0;
    view.rerender();
    expect(view.result.current).toBe(0);
    state.unread = undefined;
    view.rerender();
    expect(view.result.current).toBe(2);
  });
});
