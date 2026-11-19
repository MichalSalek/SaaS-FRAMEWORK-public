import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryWrapper } from '../../../../../test-utils/renderWithProviders';
import { useFavoriteRecords } from './useFavoriteRecords';
import { useBookmarkedStylists } from './useBookmarkedStylists';

const state = vi.hoisted(() => ({
  clientMode: true,
  hasClientProfile: false,
  records: vi.fn(),
  bookmarks: vi.fn(),
}));
vi.mock('../../../../shared/hooks/useSessionRole', () => ({
  useIsClient: () => state.clientMode,
}));
vi.mock('../../../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    data: {
      client_account: state.hasClientProfile ? { account_id: 'client' } : null,
    },
  }),
}));
vi.mock('../../../../../domain/favorites/favoriteIO.possibilities.api', () => ({
  getFavoriteRecords_IO: state.records,
  getBookmarkedStylists_IO: state.bookmarks,
}));

describe.each([
  ['favorite records', () => useFavoriteRecords(), state.records],
  ['bookmarked stylists', () => useBookmarkedStylists(), state.bookmarks],
] as const)('%s access', (_name, useFavorites, request) => {
  beforeEach(() => {
    state.clientMode = true;
    state.hasClientProfile = false;
    vi.clearAllMocks();
    state.records.mockResolvedValue({ records: [], nextCursor: null });
    state.bookmarks.mockResolvedValue({ stylists: [], nextCursor: null });
  });
  it('waits for a confirmed client profile before sending a client-only request', async () => {
    const { rerender } = renderHook(
      () => {
        useFavorites();
      },
      { wrapper: createQueryWrapper() }
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(request).not.toHaveBeenCalled();
    state.hasClientProfile = true;
    rerender();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  });
  it('does not send client-only requests in stylist mode', async () => {
    state.clientMode = false;
    state.hasClientProfile = true;
    renderHook(
      () => {
        useFavorites();
      },
      { wrapper: createQueryWrapper() }
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(request).not.toHaveBeenCalled();
  });
});
