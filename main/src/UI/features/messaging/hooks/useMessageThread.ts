// UI/features/messaging/hooks/useMessageThread.ts
// TQ v5 — wątek rozmowy (meta + wiadomości ASC). Polling 15s dla near-realtime.
// Mark-read jest osobnym hookiem (useMarkRead) wołanym przy otwarciu wątku.
//
// Paginacja (S82): backend od S75 zwracał next_cursor, ale UI go nie
// konsumował — historia starsza niż 50 wiadomości była NIEOSIĄGALNA.
// Model = chat-store: żywa strona (najnowsze 50, polling) zostaje zwykłym
// useQuery, a KAŻDA widziana wiadomość (żywe strony + starsze batche z
// kursora) trafia do akumulatora po id i renderuje się posortowana
// (created_at, id — ten sam total-order co keyset backendu). Merge po id
// domyka lukę przesuwającego się live-okna: gdy nowe wiadomości wypychają
// starsze poza żywą 50-tkę, te zostają w akumulatorze. Historia jest
// append-only (bez edycji/usuwania), więc merge nigdy nie musi nadpisywać.
// useInfiniteQuery celowo NIE: polling refetchowałby każdą załadowaną
// stronę co 15 s — czysty koszt na stabilnych oknach.
//
// DECISION (nie usuwaj tego komentarza) — S126, 2026-10-08:
// (1) Zwracana lista to akumulator PLUS żywa strona, scalone w renderze.
// Wcześniej żywa strona trafiała na ekran dopiero przez efekt, więc pierwszy
// render z danymi miał `meta` i ZERO wiadomości: wątek na jedną klatkę
// pokazywał „Brak wiadomości”, a przewinięcie do najnowszej szło o klatkę za
// późno. (2) Akumulator nosi `pairId`, do którego należy; stan innej pary
// jest pomijany już w renderze (wzorzec „adjust state on prop change”), a nie
// czyszczony efektem po fakcie: strona zostaje zamontowana przy przejściu
// wątek → wątek i przez klatkę pokazywała wiadomości poprzedniej rozmowy.

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

interface ThreadAccumulator {
  pairId: string;
  byId: ReadonlyMap<string, MessagingMessageDTO>;
  /** undefined = nie ładowano (pierwszy loadOlder bierze kursor żywej strony),
   *  null = koniec historii, string = następne okno. */
  olderCursor: string | null | undefined;
}

const emptyAccumulator = (pairId: string): ThreadAccumulator => ({
  pairId,
  byId: new Map(),
  olderCursor: undefined,
});

export function useMessageThread(pairId: string) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery(
    queryOptions({
      queryKey: queryKeys.messaging.thread(pairId),
      queryFn: ({ signal }) =>
        getMessageThread_IO(
          { pair_id: pairId },
          { signal, silentBusinessError: true }
        ),
      enabled: pairId.length > 0,
      staleTime: 5_000,
      refetchInterval: 15_000,
    })
  );

  const [stored, setStored] = useState<ThreadAccumulator>(() =>
    emptyAccumulator(pairId)
  );
  // Stan innej pary nie istnieje dla tego renderu (DECISION w nagłówku).
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

  // Każda żywa strona dolewa do akumulatora (nowe wiadomości z pollingu), żeby
  // wiadomości wypchnięte później poza żywą 50-tkę zostały na ekranie.
  const liveMessages = data?.messages;
  useEffect(() => {
    if (liveMessages == null || liveMessages.length === 0) {
      return;
    }
    setStored(prev => {
      const base = prev.pairId === pairId ? prev : emptyAccumulator(pairId);
      // Append-only: poll co 15 s zwraca NOWĄ referencję tej samej strony —
      // bez nowych id zwracamy prev (stabilna identyczność = zero churnu
      // renderów; treść wiadomości jest niemutowalna, brak edycji/usuwania).
      if (base === prev && liveMessages.every(m => prev.byId.has(m.id))) {
        return prev;
      }
      const next = new Map(base.byId);
      for (const m of liveMessages) {
        next.set(m.id, m);
      }
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
      // Anti-race: user mógł przejść do innego wątku w trakcie fetcha.
      if (activePairRef.current !== requestedPair) {
        return;
      }
      setStored(prev => {
        const base =
          prev.pairId === requestedPair
            ? prev
            : emptyAccumulator(requestedPair);
        const next = new Map(base.byId);
        for (const m of res.messages) {
          next.set(m.id, m);
        }
        return {
          pairId: requestedPair,
          byId: next,
          olderCursor: res.next_cursor ?? null,
        };
      });
    } catch {
      // Transient (sieć/5xx): interceptor toastuje warstwą 1; kursor
      // nietknięty — przycisk zostaje i user ponowi.
    } finally {
      setLoadingOlderFor(prev => (prev === requestedPair ? null : prev));
    }
  }, [effectiveCursor, isLoadingOlder, pairId]);

  const messages = useMemo(() => {
    const live = liveMessages ?? [];
    if (live.every(m => acc.byId.has(m.id))) {
      return [...acc.byId.values()].sort(byCreatedAtId);
    }
    const merged = new Map(acc.byId);
    for (const m of live) {
      merged.set(m.id, m);
    }
    return [...merged.values()].sort(byCreatedAtId);
  }, [acc.byId, liveMessages]);

  return {
    meta: data?.meta ?? null,
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
