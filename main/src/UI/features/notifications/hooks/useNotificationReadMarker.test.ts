import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markNotificationsRead_IO } from '../../../../domain/notifications/notificationsIO.possibilities.api';
import {
  createQueryWrapper,
  makeTestQueryClient,
} from '../../../../test-utils/renderWithProviders';
import { useNotificationReadMarker } from './useNotificationReadMarker';

vi.mock(
  '../../../../domain/notifications/notificationsIO.possibilities.api',
  () => ({
    getRecentNotifications_IO: vi.fn(),
    getUnreadNotificationsCount_IO: vi.fn(),
    markNotificationsRead_IO: vi.fn(),
  })
);

const newestSeenAt = '2026-10-24T10:00:00.000Z';

beforeEach(() => vi.resetAllMocks());

describe('useNotificationReadMarker', () => {
  it('bounds failures without loops and retries the same watermark after a new server snapshot', async () => {
    vi.mocked(markNotificationsRead_IO).mockRejectedValue(new Error('offline'));
    const client = makeTestQueryClient();
    const { rerender } = renderHook(
      ({ updatedAt }) =>
        useNotificationReadMarker({
          newestSeenAt,
          unread: 1,
          dataUpdatedAt: updatedAt,
        }),
      { wrapper: createQueryWrapper(client), initialProps: { updatedAt: 1 } }
    );
    await waitFor(
      () =>
        expect(client.getMutationCache().getAll()[0]?.state.status).toBe(
          'error'
        ),
      { timeout: 4_000 }
    );
    expect(markNotificationsRead_IO).toHaveBeenCalledTimes(3);

    rerender({ updatedAt: 1 });
    expect(markNotificationsRead_IO).toHaveBeenCalledTimes(3);
    vi.mocked(markNotificationsRead_IO).mockResolvedValue({ marked: 1 });
    rerender({ updatedAt: 2 });

    await waitFor(() =>
      expect(markNotificationsRead_IO).toHaveBeenCalledTimes(4)
    );
  });

  it('deduplicates successful snapshots and marks a newer snapshot after the in-flight one settles', async () => {
    const completions: Array<(value: { marked: number }) => void> = [];
    vi.mocked(markNotificationsRead_IO).mockImplementation(
      () => new Promise(resolve => completions.push(resolve))
    );
    const { rerender } = renderHook(
      ({ newest, updatedAt }) =>
        useNotificationReadMarker({
          newestSeenAt: newest,
          unread: 1,
          dataUpdatedAt: updatedAt,
        }),
      {
        wrapper: createQueryWrapper(makeTestQueryClient()),
        initialProps: { newest: newestSeenAt, updatedAt: 1 },
      }
    );
    await waitFor(() =>
      expect(markNotificationsRead_IO).toHaveBeenCalledTimes(1)
    );
    await act(async () => {
      rerender({ newest: '2026-10-24T10:01:00.000Z', updatedAt: 2 });
    });
    expect(markNotificationsRead_IO).toHaveBeenCalledTimes(1);

    await act(async () => completions[0]?.({ marked: 1 }));
    await waitFor(() =>
      expect(markNotificationsRead_IO).toHaveBeenCalledTimes(2)
    );
    expect(markNotificationsRead_IO).toHaveBeenLastCalledWith(
      { newest_seen_at: '2026-10-24T10:01:00.000Z' },
      { silentBusinessError: true }
    );
    await act(async () => completions[1]?.({ marked: 1 }));
    rerender({ newest: '2026-10-24T10:01:00.000Z', updatedAt: 3 });
    expect(markNotificationsRead_IO).toHaveBeenCalledTimes(2);
  });
});
