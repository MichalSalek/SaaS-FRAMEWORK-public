// UI/features/messaging/hooks/useConversations.ts
// TQ v5 — lista rozmów komunikatora (unia stron client+stylist) + pochodny
// licznik nieprzeczytanych (badge nawigacji). Polling 30s.
//
// Paginacja (S82): backend zwracał next_cursor od S75, ale lista była twardo
// ucięta do 50 rozmów. Model jak useMessageThread: żywa strona (polling) +
// lokalny akumulator starszych, dedup po pair_id (żywa wygrywa — rozmowa,
// która dostała nową wiadomość, wskakuje do żywej strony na kolejnym pollu).
//
// D2 (2026-09-05, hide = mute): DWIE listy pod osobnymi kluczami cache —
// domyślna (widoczne) i „Pokaż ukryte" (hidden=true). Badge nieprzeczytanych
// liczy WYŁĄCZNIE listę widoczną (ukryte = wyciszone), niezależnie od tego,
// którą listę pokazuje właśnie skrzynka. Akumulator starszych stron jest
// resetowany przy przełączeniu listy, żeby strony obu list się nie mieszały.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { getConversations_IO } from '../../../../domain/messaging/messagingIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
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
  // undefined = nie ładowano (pierwszy loadOlder bierze kursor żywej strony),
  // null = koniec listy, string = następne okno.
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(
    undefined
  );
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  // Przełączenie widoczne ↔ ukryte = czysty akumulator (strony innej listy).
  useEffect(() => {
    setOlder([]);
    setOlderCursor(undefined);
    setIsLoadingOlder(false);
  }, [hidden]);

  const liveConversations = data?.conversations;
  const liveNextCursor = data?.next_cursor ?? null;
  const effectiveCursor =
    olderCursor !== undefined ? olderCursor : liveNextCursor;
  const hasOlder = effectiveCursor != null;

  const loadOlder = useCallback(async () => {
    if (effectiveCursor == null || isLoadingOlder) {
      return;
    }
    setIsLoadingOlder(true);
    try {
      const res = await getConversations_IO(
        hidden
          ? { cursor: effectiveCursor, hidden: true }
          : { cursor: effectiveCursor },
        { silentBusinessError: true }
      );
      setOlder(prev => [...prev, ...res.conversations]);
      setOlderCursor(res.next_cursor ?? null);
    } catch {
      // Transient: interceptor toastuje; kursor nietknięty — user ponowi.
    } finally {
      setIsLoadingOlder(false);
    }
  }, [effectiveCursor, isLoadingOlder, hidden]);

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
 * Pochodny licznik nieprzeczytanych (suma po rozmowach WIDOCZNYCH) do badge'a
 * nawigacji. Reużywa TEN SAM klucz/cache co domyślna lista (jedno zapytanie,
 * jeden polling). Ukryte rozmowy są wyciszone, więc NIGDY nie liczą się do
 * badge'a (D2). `enabled` pozwala wyłączyć globalny polling dla wylogowanych.
 */
export function useUnreadMessagesCount(enabled = true) {
  const { data } = useQuery({ ...conversationsQueryOptions(false), enabled });
  return (data?.conversations ?? []).reduce(
    (sum, c) => sum + (c.unread_count ?? 0),
    0
  );
}
