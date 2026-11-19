// TQ v5: the conversation thread (meta + messages ASC), polled every 15s. Mark-read is a
// separate hook (useMarkRead). Older history comes through next_cursor. Model = chat store: the
// live page (newest 50) stays a plain useQuery, and EVERY message seen (live pages + older
// cursor batches) goes into an accumulator keyed by id, rendered sorted (created_at, id: the
// backend keyset order), so a moving live window loses nothing. History is append-only, so a
// merge updates revised cards. useInfiniteQuery is NOT used: polling would refetch every loaded
// page every 15 s.
//
// DECISION: (1) the returned list is the accumulator PLUS the live page, merged at render; an
// effect would leave the first render with data showing `meta` and ZERO messages ("Brak
// wiadomości" for a frame, scroll to the newest a frame late). (2) The accumulator carries its
// `pairId`; another pair's state is skipped at render ("adjust state on prop change") instead of
// cleared by an effect, since the page stays mounted across thread -> thread navigation and
// would show the previous conversation for a frame.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { getMessageThread_IO } from '../../../../domain/messaging/messagingIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { MessagingMessageDTO } from '@kernel/models/messaging/messaging.dto';

function byCreatedAtId(a: MessagingMessageDTO, b: MessagingMessageDTO): number {
  const ta = String(a.created_at);
  const tb = String(b.created_at);
  if (ta !== tb) {
    return ta < tb ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Keep newer card revisions when an older cursor request finishes after a poll. */
export function mergeThreadMessages(
  previous: ReadonlyMap<string, MessagingMessageDTO>,
  incoming: readonly MessagingMessageDTO[],
  allowSameRevision = true
): Map<string, MessagingMessageDTO> {
  const result = new Map(previous);
  for (const message of incoming) {
    const old = result.get(message.id);
    if (
      !old ||
      (message.revision ?? 1) > (old.revision ?? 1) ||
      (allowSameRevision && (message.revision ?? 1) === (old.revision ?? 1))
    ) {
      result.set(message.id, message);
    }
  }
  return result;
}

interface ThreadAccumulator {
  pairId: string;
  byId: ReadonlyMap<string, MessagingMessageDTO>;
  /** undefined = not loaded (the first loadOlder takes the live page's cursor),
   *  null = end of history, string = the next window. */
  olderCursor: string | null | undefined;
}

const emptyAccumulator = (pairId: string): ThreadAccumulator => ({
  pairId,
  byId: new Map(),
  olderCursor: undefined,
});

export function useMessageThread(pairId: string) {
  const loadedWindows = useRef<{ pairId: string; cursors: string[] }>({
    pairId,
    cursors: [],
  });
  const { data, isLoading, isError, refetch, isFetching } = useQuery(
    queryOptions({
      queryKey: queryKeys.messaging.thread(pairId),
      queryFn: async ({ signal }) => {
        const latest = await getMessageThread_IO(
          { pair_id: pairId },
          { signal, silentBusinessError: true }
        );
        const cursors =
          loadedWindows.current.pairId === pairId
            ? [...loadedWindows.current.cursors]
            : [];
        let byId = mergeThreadMessages(new Map(), latest.messages);
        // Media permissions can change without a new message/revision. Refresh
        // every loaded window, preserving the user's history and read boundary.
        for (const cursor of cursors) {
          const older = await getMessageThread_IO(
            { pair_id: pairId, cursor },
            { signal, silentBusinessError: true }
          );
          byId = mergeThreadMessages(byId, older.messages);
        }
        return { ...latest, messages: [...byId.values()] };
      },
      enabled: pairId.length > 0,
      staleTime: 5_000,
      refetchInterval: 15_000,
    })
  );

  const [stored, setStored] = useState<ThreadAccumulator>(() =>
    emptyAccumulator(pairId)
  );
  // Another pair's state does not exist for this render (the DECISION in the file header).
  const acc = useMemo(
    () => (stored.pairId === pairId ? stored : emptyAccumulator(pairId)),
    [stored, pairId]
  );
  const [loadingOlderFor, setLoadingOlderFor] = useState<string | null>(null);
  const isLoadingOlder = loadingOlderFor === pairId;

  const activePairRef = useRef(pairId);
  useEffect(() => {
    activePairRef.current = pairId;
  }, [pairId]);

  // Every live page feeds the accumulator (new messages from polling), so messages
  // later pushed out of the live 50 stay on screen.
  const liveMessages = data?.messages;
  useEffect(() => {
    if (liveMessages == null || liveMessages.length === 0) {
      return;
    }
    setStored(prev => {
      const base = prev.pairId === pairId ? prev : emptyAccumulator(pairId);
      const next = mergeThreadMessages(base.byId, liveMessages);
      return { ...base, byId: next };
    });
  }, [liveMessages, pairId]);

  const liveNextCursor = data?.next_cursor ?? null;
  const effectiveCursor =
    acc.olderCursor !== undefined ? acc.olderCursor : liveNextCursor;
  const hasOlder = effectiveCursor != null;

  const loadOlder = useCallback(async () => {
    if (effectiveCursor == null || isLoadingOlder) {
      return;
    }
    const requestedPair = pairId;
    setLoadingOlderFor(requestedPair);
    try {
      const res = await getMessageThread_IO(
        { pair_id: requestedPair, cursor: effectiveCursor },
        { silentBusinessError: true }
      );
      // Stale-response guard: the user may have moved to another thread during the fetch.
      if (activePairRef.current !== requestedPair) {
        return;
      }
      const windows = loadedWindows.current;
      loadedWindows.current =
        windows.pairId === requestedPair
          ? {
              pairId: requestedPair,
              cursors: [...new Set([...windows.cursors, effectiveCursor])],
            }
          : { pairId: requestedPair, cursors: [effectiveCursor] };
      setStored(prev => {
        const base =
          prev.pairId === requestedPair
            ? prev
            : emptyAccumulator(requestedPair);
        const next = mergeThreadMessages(base.byId, res.messages, false);
        return {
          pairId: requestedPair,
          byId: next,
          olderCursor: res.next_cursor ?? null,
        };
      });
    } catch {
      // Transient (network/5xx): the interceptor toasts at layer 1; the cursor is
      // untouched, so the button stays and the user retries.
    } finally {
      setLoadingOlderFor(prev => (prev === requestedPair ? null : prev));
    }
  }, [effectiveCursor, isLoadingOlder, pairId]);

  const messages = useMemo(() => {
    const live = liveMessages ?? [];
    const merged = mergeThreadMessages(acc.byId, live);
    return [...merged.values()].sort(byCreatedAtId);
  }, [acc.byId, liveMessages]);

  return {
    meta: data?.meta ?? null,
    readThrough: data?.read_through ?? null,
    messages,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    isLoading,
    isFetching,
    isError,
    refetch,
  };
}
