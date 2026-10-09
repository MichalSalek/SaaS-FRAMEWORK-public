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
 * DECISION (nie usuwaj tego komentarza) — 2026-09-24:
 * STOPS on a failed page. After a failed `fetchNextPage` TanStack keeps
 * `hasNextPage === true` and flips `isFetchingNextPage` back to false, so an
 * effect without the `isFetchNextPageError` guard re-requested the failing page
 * in a tight loop (offline = endless network traffic behind a skeleton that
 * never resolved). The caller shows the failure with a manual retry that calls
 * `fetchNextPage` itself; a successful retry clears the flag and resumes.
 * One implementation for every „search the remaining pages" site, because the
 * guard was missing in three of six hand-written copies.
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
