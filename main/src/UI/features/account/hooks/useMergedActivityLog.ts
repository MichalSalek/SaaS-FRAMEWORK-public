// UI/features/account/hooks/useMergedActivityLog.ts
// The two activity streams (LOGIN + ACCOUNT, each with its own cursor) merged
// into one newest-first list, with the paging and retry handlers of the pair.
// Split out of AccountActivityPanel to keep the panel under 300 lines.

import { useMemo } from 'react';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import type { UserActivityLogRecord } from '@kernel/models/event-log/event_log.dto';
import { toTime } from '../AccountActivityPanel.helpers';
import { useActivityLog, flattenActivityPages } from './useActivityLog';

export function useMergedActivityLog() {
  // LOGIN + ACCOUNT EventLogTypes are merged into one timeline. The backend does not expose the
  // GALLERY EventLogType on the user-side endpoint (only ACCOUNT/LOGIN per the useActivityLog
  // config); the "Galeria" chip stays as a filter slot for a future iteration and currently leads
  // to an empty result (the chip is not hidden: predictable UX).
  const loginLogs = useActivityLog(EventLogTypeValue.LOGIN);
  const accountLogs = useActivityLog(EventLogTypeValue.ACCOUNT);

  // Memo on `data`: flatMap yields a new array each render, and every useMemo below (merge, counts,
  // filter, grouping by day) depends on those arrays.
  const loginEntries = useMemo(
    () => flattenActivityPages(loginLogs.data),
    [loginLogs.data]
  );
  const accountEntries = useMemo(
    () => flattenActivityPages(accountLogs.data),
    [accountLogs.data]
  );
  const loginHasMore = loginLogs.hasNextPage === true;
  const accountHasMore = accountLogs.hasNextPage === true;

  // DECISION: TWO independent cursors (30 each) merged into one timeline = a merge of k sorted
  // streams. An entry may appear in the view ONLY when it is newer than the "frontier" (the oldest
  // loaded entry) of every stream that still has more pages; otherwise an old ACCOUNT entry landed
  // above 70 newer, not yet loaded logins and, after a scroll, new entries jumped ABOVE it.
  // Held-back entries return when the blocking stream pulls its next page (fetchNextPage below).
  const { allEntries, heldBackCount } = useMemo(() => {
    const merged = [...loginEntries, ...accountEntries];
    // Newest first — preserve user-perceived chronology.
    merged.sort((a, b) => toTime(b.created_at) - toTime(a.created_at));
    const frontier = (
      entries: readonly UserActivityLogRecord[],
      hasMore: boolean
    ): number => {
      if (!hasMore || entries.length === 0) {
        return Number.NEGATIVE_INFINITY;
      }
      return Math.min(...entries.map(e => toTime(e.created_at)));
    };
    const watermark = Math.max(
      frontier(loginEntries, loginHasMore),
      frontier(accountEntries, accountHasMore)
    );
    const visible = merged.filter(e => toTime(e.created_at) >= watermark);
    return {
      allEntries: visible,
      heldBackCount: merged.length - visible.length,
    };
  }, [loginEntries, accountEntries, loginHasMore, accountHasMore]);

  const streams = [loginLogs, accountLogs] as const;
  const isLoading = loginLogs.isLoading || accountLogs.isLoading;
  // DECISION: the full error screen appears ONLY when a stream has NO data at all (without it the
  // timeline would silently omit a whole category and pose as complete). On a failed background
  // refresh or a failed next page TanStack sets `isError` while KEEPING data: then the timeline
  // stays and a short notice with a retry stands above/below it. Chronology holds: a stream with a
  // failed page still has `hasNextPage`, so the watermark keeps holding back the older entries of
  // the other stream.
  const hasBlockingError = streams.some(q => q.isError && q.data === undefined);
  const hasRefreshError = streams.some(q => q.isRefetchError);
  const hasNextPageError = streams.some(q => q.isFetchNextPageError);
  const isFetchingNextPage =
    loginLogs.isFetchingNextPage || accountLogs.isFetchingNextPage;
  const hasNextPage = loginHasMore || accountHasMore || heldBackCount > 0;
  // The sentinel auto-loads only streams whose last page did NOT fail. Before, a failed page came
  // back in a loop: the sentinel is still visible, the observer is recreated on every render and
  // fires again at once. After an error the user decides (button below).
  const canAutoFetch = streams.some(
    q => q.hasNextPage === true && !q.isFetchNextPageError
  );

  const fetchNextPage = () => {
    for (const q of streams) {
      if (
        q.hasNextPage === true &&
        !q.isFetchingNextPage &&
        !q.isFetchNextPageError
      ) {
        void q.fetchNextPage();
      }
    }
  };

  const retryNextPage = () => {
    for (const q of streams) {
      if (q.isFetchNextPageError && !q.isFetchingNextPage) {
        void q.fetchNextPage();
      }
    }
  };

  const retry = () => {
    for (const q of streams) {
      if (q.isError && !q.isFetchNextPageError) {
        void q.refetch();
      }
    }
  };
  const isRetrying = streams.some(q => q.isFetching && !q.isFetchingNextPage);

  return {
    allEntries,
    loginEntries,
    isLoading,
    hasBlockingError,
    hasRefreshError,
    hasNextPageError,
    hasNextPage,
    canAutoFetch,
    isFetchingNextPage,
    isRetrying,
    fetchNextPage,
    retryNextPage,
    retry,
  };
}
