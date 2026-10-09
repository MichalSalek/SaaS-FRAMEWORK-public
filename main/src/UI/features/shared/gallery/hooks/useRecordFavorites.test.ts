// useRecordFavorites — out-of-order settle of parallel heart taps.
// Each tap fires its own request; only the NEWEST tap on a record may roll
// back the optimistic override when it fails.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecordFavorites } from './useRecordFavorites';

interface Deferred {
  resolve: () => void;
  reject: () => void;
}

const calls: Deferred[] = [];
const mutateAsync = vi.fn(
  () =>
    new Promise<void>((resolve, reject) => {
      calls.push({ resolve, reject: () => reject(new Error('fail')) });
    })
);

vi.mock('../../favorites/hooks/useToggleFavorite', () => ({
  useToggleFavorite: () => ({ mutateAsync }),
}));

const RECORD = 'rec-1';
const pages = [
  { records: [{ gallery_record_id: RECORD, is_favorited: false }] },
];

async function settle(fn: () => void) {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
}

describe('useRecordFavorites', () => {
  beforeEach(() => {
    calls.length = 0;
    mutateAsync.mockClear();
  });

  it('an older tap failing last does not undo a newer tap', async () => {
    const { result } = renderHook(() => useRecordFavorites(pages));

    act(() => result.current.handleFavoriteToggle(RECORD)); // add
    act(() => result.current.handleFavoriteToggle(RECORD)); // remove
    act(() => result.current.handleFavoriteToggle(RECORD)); // add again
    expect(result.current.favoritedIds.has(RECORD)).toBe(true);

    await settle(() => calls[2]?.resolve());
    await settle(() => calls[0]?.reject());
    await settle(() => calls[1]?.reject());

    expect(result.current.favoritedIds.has(RECORD)).toBe(true);
  });

  it('the newest tap failing rolls back to server truth', async () => {
    const { result } = renderHook(() => useRecordFavorites(pages));

    act(() => result.current.handleFavoriteToggle(RECORD));
    expect(result.current.favoritedIds.has(RECORD)).toBe(true);

    await settle(() => calls[0]?.reject());

    expect(result.current.favoritedIds.has(RECORD)).toBe(false);
  });
});
