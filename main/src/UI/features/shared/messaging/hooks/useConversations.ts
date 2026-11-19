// UI/features/messaging/hooks/useConversations.ts
// TQ v5 — the messenger's conversation list (union of client + stylist pages) plus the
// derived unread count (navigation badge). Polling 30s.
//
// Pagination: the backend returns next_cursor, so the list is not capped at 50
// conversations. Model as in useMessageThread: a live page (polling) + a local
// accumulator of older pages, deduped by pair_id (the live one wins: a conversation
// that got a new message jumps into the live page on the next poll).
//
// Hide = mute: TWO lists under separate cache keys, the default (visible) and
// „Pokaż ukryte” (hidden=true). The unread badge counts ONLY the visible list
// (hidden = muted), whichever list the inbox is showing. The accumulator of older
// pages is reset when switching lists so the pages of the two never mix.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { getConversations_IO } from '../../../../../domain/messaging/messagingIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type { MessagingConversationDTO } from '@kernel/models/messaging/messaging.dto';

const conversationsQueryOptions = (hidden: boolean) =>
  queryOptions({
    queryKey: queryKeys.messaging.conversations(hidden),
    queryFn: ({ signal }) =>
      getConversations_IO(hidden ? { hidden: true } : {}, {
        signal,
        silentBusinessError: true,
      }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

export function useConversations(hidden = false) {
  const { data, isLoading, isError, isFetching, refetch } = useQuery(
    conversationsQueryOptions(hidden)
  );

  const [older, setOlder] = useState<MessagingConversationDTO[]>([]);
  // undefined = not loaded (the first loadOlder takes the live page's cursor),
  // null = end of the list, string = the next window.
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(
    undefined
  );
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const generation = useRef(0);
  const loadingRef = useRef(false);

  // Switching visible <-> hidden = a clean accumulator (pages of the other list).
  useLayoutEffect(() => {
    generation.current += 1;
    loadingRef.current = false;
    setOlder([]);
    setOlderCursor(undefined);
    setIsLoadingOlder(false);
    return () => {
      generation.current += 1;
      loadingRef.current = false;
    };
  }, [hidden]);

  const liveConversations = data?.conversations;
  const liveNextCursor = data?.next_cursor ?? null;
  const effectiveCursor =
    olderCursor !== undefined ? olderCursor : liveNextCursor;
  const hasOlder = effectiveCursor != null;

  const loadOlder = useCallback(async () => {
    if (effectiveCursor == null || loadingRef.current) {
      return;
    }
    const current = generation.current;
    loadingRef.current = true;
    setIsLoadingOlder(true);
    try {
      const res = await getConversations_IO(
        hidden
          ? { cursor: effectiveCursor, hidden: true }
          : { cursor: effectiveCursor },
        { silentBusinessError: true }
      );
      if (current === generation.current) {
        setOlder(prev => [...prev, ...res.conversations]);
        setOlderCursor(res.next_cursor ?? null);
      }
    } catch {
      // Transient: the interceptor toasts; the cursor is untouched, the user retries.
    } finally {
      if (current === generation.current) {
        loadingRef.current = false;
        setIsLoadingOlder(false);
      }
    }
  }, [effectiveCursor, hidden]);

  // Hide/restore moves a conversation to the other list. The live page is
  // refetched by the mutation's invalidation, but a conversation that came from
  // an OLDER page sits in this local accumulator, which no refetch touches: it
  // stayed on screen after a successful hide, as if nothing had happened.
  const dropLocal = useCallback((pairId: string) => {
    setOlder(prev => prev.filter(c => c.pair_id !== pairId));
  }, []);

  const conversations = useMemo(() => {
    const live = liveConversations ?? [];
    if (older.length === 0) {
      return live;
    }
    const liveIds = new Set(live.map(c => c.pair_id));
    return [...live, ...older.filter(o => !liveIds.has(o.pair_id))];
  }, [liveConversations, older]);

  return {
    conversations,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    dropLocal,
    isLoading,
    isError,
    isFetching,
    /** A page is cached: an error is then a failed background poll, not "no inbox". */
    hasData: data !== undefined,
    refetch,
  };
}

/**
 * Derived unread count (sum over VISIBLE conversations) for the navigation
 * badge. Reuses the SAME key/cache as the default list (one query, one
 * polling). Hidden conversations are muted, so they NEVER count toward the
 * badge. `enabled` lets the global polling be switched off for logged-out users.
 */
export function useUnreadMessagesCount(enabled = true) {
  const { data } = useQuery({ ...conversationsQueryOptions(false), enabled });
  return (
    data?.unread_count ??
    (data?.conversations ?? []).reduce(
      (sum, c) => sum + (c.unread_count ?? 0),
      0
    )
  );
}
