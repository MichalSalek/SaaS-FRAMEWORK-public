import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusManager } from '@tanstack/react-query';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import {
  onAppStateChange,
  type AppStateListener,
} from '../../../../application/platform/app-state';
import {
  getRecentNotifications_IO,
  getUnreadNotificationsCount_IO,
  markNotificationsRead_IO,
} from '../../../../domain/notifications/notificationsIO.possibilities.api';
import {
  createQueryWrapper,
  makeTestQueryClient,
} from '../../../../test-utils/renderWithProviders';
import {
  useMarkNotificationsRead,
  useRecentNotifications,
  useUnreadNotificationsCount,
} from './useNotifications';

vi.mock(
  '../../../../domain/notifications/notificationsIO.possibilities.api',
  () => ({
    getRecentNotifications_IO: vi.fn(),
    getUnreadNotificationsCount_IO: vi.fn(),
    markNotificationsRead_IO: vi.fn(),
  })
);
vi.mock('../../../../application/platform/app-state', () => ({
  onAppStateChange: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(onAppStateChange).mockResolvedValue(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe('notification refresh and read mutation', () => {
  it('retries an idempotent marker after one failed POST', async () => {
    vi.mocked(markNotificationsRead_IO)
      .mockRejectedValueOnce(new Error('temporary connection failure'))
      .mockResolvedValue({ marked: 2 });
    const { result } = renderHook(() => useMarkNotificationsRead(), {
      wrapper: createQueryWrapper(makeTestQueryClient()),
    });

    await act(async () => {
      await result.current.mutateAsync({
        newest_seen_at: '2026-10-24T10:00:00.000Z',
      });
    });

    expect(markNotificationsRead_IO).toHaveBeenCalledTimes(2);
    expect(markNotificationsRead_IO).toHaveBeenLastCalledWith(
      { newest_seen_at: '2026-10-24T10:00:00.000Z' },
      { silentBusinessError: true }
    );
  });

  it('invalidates the unread count without erasing newer unread arrivals', async () => {
    vi.mocked(markNotificationsRead_IO).mockResolvedValue({ marked: 2 });
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.notifications.unreadCount, {
      unread_count: 1,
    });
    const { result } = renderHook(() => useMarkNotificationsRead(), {
      wrapper: createQueryWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        newest_seen_at: '2026-10-24T10:00:00.000Z',
      });
    });

    expect(client.getQueryData(queryKeys.notifications.unreadCount)).toEqual({
      unread_count: 1,
    });
    expect(
      client.getQueryState(queryKeys.notifications.unreadCount)?.isInvalidated
    ).toBe(true);
  });

  it('refreshes the notification list and count on native resume and disposes the listener', async () => {
    let listener: AppStateListener | undefined;
    const dispose = vi.fn();
    vi.mocked(onAppStateChange).mockImplementation(async next => {
      listener = next;
      return dispose;
    });
    vi.mocked(getUnreadNotificationsCount_IO).mockResolvedValue({
      unread_count: 2,
    });
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.notifications.recent, {
      notifications: [],
      unread_count: 0,
    });
    const { result, unmount } = renderHook(
      () => useUnreadNotificationsCount(),
      {
        wrapper: createQueryWrapper(client),
      }
    );
    await waitFor(() => expect(result.current.count).toBe(2));

    await act(async () => {
      listener?.({ isActive: false });
    });
    expect(
      client.getQueryState(queryKeys.notifications.recent)?.isInvalidated
    ).toBe(false);
    await act(async () => {
      listener?.({ isActive: true });
    });
    expect(
      client.getQueryState(queryKeys.notifications.recent)?.isInvalidated
    ).toBe(true);

    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('removes a native listener that finishes registering after unmount', async () => {
    let finishRegistration: ((dispose: () => void) => void) | undefined;
    const dispose = vi.fn();
    vi.mocked(onAppStateChange).mockImplementation(
      () =>
        new Promise(resolve => {
          finishRegistration = resolve;
        })
    );
    const { unmount } = renderHook(() => useUnreadNotificationsCount(), {
      wrapper: createQueryWrapper(makeTestQueryClient()),
    });
    unmount();

    await act(async () => finishRegistration?.(dispose));

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('refreshes the mounted recent list every minute and on focus despite the global focus opt-out', async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    vi.mocked(getRecentNotifications_IO).mockResolvedValue({
      notifications: [],
      unread_count: 0,
    });
    const client = makeTestQueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
          refetchOnWindowFocus: false,
        },
      },
    });
    const { unmount } = renderHook(() => useRecentNotifications(), {
      wrapper: createQueryWrapper(client),
    });
    await act(async () => {});
    expect(getRecentNotifications_IO).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getRecentNotifications_IO).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    await act(async () => focusManager.setFocused(false));
    await act(async () => focusManager.setFocused(true));
    expect(getRecentNotifications_IO).toHaveBeenCalledTimes(3);
    unmount();
  });
});
