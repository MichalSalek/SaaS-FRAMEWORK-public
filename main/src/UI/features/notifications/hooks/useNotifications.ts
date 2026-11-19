// UI/features/notifications/hooks/useNotifications.ts
// TQ v5 hooks of the notification centre: the bell's unread count (polled), the
// list (on the screen only) and the read marker.
//
// DECISION:
// One light COUNT every 60 s replaces the three queries the v1 bell summed
// (dashboard feed, pending requests, salon invitations). refetchOnWindowFocus
// is off globally (Capacitor fires focus on every resume and keyboard), so the
// notifications refresh on the native resume signal explicitly, plus whenever a
// mutation that creates or closes a notification invalidates it.

import { useEffect } from 'react';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { NOTIFICATIONS_DTO_API_V1 } from '@kernel/models/notifications/notifications.dto';
import {
  getRecentNotifications_IO,
  getUnreadNotificationsCount_IO,
  markNotificationsRead_IO,
} from '../../../../domain/notifications/notificationsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { onAppStateChange } from '../../../../application/platform/app-state';

const UNREAD_POLL_MS = 60_000;

export const unreadNotificationsQueryOptions = (enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: ({ signal }) =>
      getUnreadNotificationsCount_IO(undefined, { signal }),
    enabled,
    staleTime: 30_000,
    refetchInterval: UNREAD_POLL_MS,
  });

export function useUnreadNotificationsCount(enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery(unreadNotificationsQueryOptions(enabled));

  // Native resume: the app may have been in the background for hours.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void onAppStateChange(({ isActive }) => {
      if (isActive) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.all,
        });
      }
    }).then(remove => {
      if (cancelled) {
        remove();
      } else {
        dispose = remove;
      }
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [enabled, queryClient]);

  return {
    /** Undefined until the first read; a failed read keeps the last value. */
    count: query.data?.unread_count,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export const recentNotificationsQueryOptions = (enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.notifications.recent,
    queryFn: ({ signal }) => getRecentNotifications_IO(undefined, { signal }),
    enabled,
    staleTime: 15_000,
    refetchInterval: UNREAD_POLL_MS,
    refetchOnWindowFocus: true,
  });

export function useRecentNotifications(enabled = true) {
  return useQuery(recentNotificationsQueryOptions(enabled));
}

/**
 * Opening the list marks what it showed as read. Silent on purpose (Style
 * Policy 46: a read marker celebrates nothing). The server refreshes the badge;
 * rows keep their unread emphasis until the next list fetch.
 */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input: NOTIFICATIONS_DTO_API_V1['NOTIFICATIONS_MARK_READ']['REQUEST']
    ) => markNotificationsRead_IO(input, { silentBusinessError: true }),
    retry: 2,
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.unreadCount,
      });
    },
  });
}
