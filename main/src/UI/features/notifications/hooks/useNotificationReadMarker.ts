import { useEffect, useRef } from 'react';
import { useMarkNotificationsRead } from './useNotifications';

export function useNotificationReadMarker({
  newestSeenAt,
  unread,
  dataUpdatedAt,
}: {
  newestSeenAt: string | null;
  unread: number;
  dataUpdatedAt: number;
}) {
  const { mutate: markRead, isPending } = useMarkNotificationsRead();
  const markedFor = useRef<string | null>(null);
  const marking = useRef(false);
  const attempted = useRef<{
    newestSeenAt: string;
    dataUpdatedAt: number;
  } | null>(null);
  useEffect(() => {
    if (newestSeenAt === null || unread === 0 || isPending || marking.current) {
      return;
    }
    if (markedFor.current === newestSeenAt) {
      return;
    }
    // A terminal failure may retry after a new server snapshot, never in a render loop.
    // Test: useNotificationReadMarker.test.ts (bounded failure and snapshot recovery).
    if (
      attempted.current?.newestSeenAt === newestSeenAt &&
      attempted.current.dataUpdatedAt === dataUpdatedAt
    ) {
      return;
    }
    marking.current = true;
    attempted.current = { newestSeenAt, dataUpdatedAt };
    markRead(
      { newest_seen_at: newestSeenAt },
      {
        onSuccess: () => {
          markedFor.current = newestSeenAt;
        },
        onSettled: () => {
          marking.current = false;
        },
      }
    );
  }, [newestSeenAt, unread, dataUpdatedAt, markRead, isPending]);
}
