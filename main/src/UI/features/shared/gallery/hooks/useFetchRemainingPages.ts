// UI/features/shared/gallery/hooks/useFetchRemainingPages.ts
// Eagerly pulls the next page of an infinite query while `active`.

import { useEffect } from 'react';

interface InfinitePageState {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown>;
}

/**
 * Loads the next page whenever `active` and one exists, one at a time.
 *
 * DECISION: STOPS on a failed page. After a failed `fetchNextPage` TanStack keeps
 * `hasNextPage === true` and resets `isFetchingNextPage`, so without the
 * `isFetchNextPageError` guard the effect re-requests the failing page in a tight
 * loop (offline = endless traffic behind a skeleton). The caller offers a manual
 * retry; a successful one clears the flag and resumes. Use this hook for every
 * „load the remaining pages" site instead of a hand-written effect.
 */
export function useFetchRemainingPages(
  active: boolean,
  {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  }: InfinitePageState
) {
  useEffect(() => {
    if (active && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [
    active,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  ]);
}
