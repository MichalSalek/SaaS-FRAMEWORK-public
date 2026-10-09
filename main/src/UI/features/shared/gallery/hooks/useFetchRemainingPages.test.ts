import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFetchRemainingPages } from './useFetchRemainingPages';

const state = (
  over: Partial<Parameters<typeof useFetchRemainingPages>[1]>
) => ({
  hasNextPage: true,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  fetchNextPage: vi.fn(() => Promise.resolve()),
  ...over,
});

describe('useFetchRemainingPages', () => {
  it('fetches the next page while active and one exists', () => {
    const s = state({});
    renderHook(() => useFetchRemainingPages(true, s));
    expect(s.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('does nothing when inactive, exhausted or already fetching', () => {
    const inactive = state({});
    renderHook(() => useFetchRemainingPages(false, inactive));
    const exhausted = state({ hasNextPage: false });
    renderHook(() => useFetchRemainingPages(true, exhausted));
    const inFlight = state({ isFetchingNextPage: true });
    renderHook(() => useFetchRemainingPages(true, inFlight));
    expect(inactive.fetchNextPage).not.toHaveBeenCalled();
    expect(exhausted.fetchNextPage).not.toHaveBeenCalled();
    expect(inFlight.fetchNextPage).not.toHaveBeenCalled();
  });

  it('stops on a failed page instead of retrying in a loop', () => {
    const fetchNextPage = vi.fn(() => Promise.resolve());
    const { rerender } = renderHook(
      (props: { fetching: boolean; failed: boolean }) =>
        useFetchRemainingPages(true, {
          hasNextPage: true,
          isFetchingNextPage: props.fetching,
          isFetchNextPageError: props.failed,
          fetchNextPage,
        }),
      { initialProps: { fetching: false, failed: false } }
    );
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    // Request in flight, then it fails: hasNextPage stays true.
    rerender({ fetching: true, failed: false });
    rerender({ fetching: false, failed: true });
    rerender({ fetching: false, failed: true });
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    // A manual retry that succeeds clears the flag and resumes loading.
    rerender({ fetching: false, failed: false });
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });
});
