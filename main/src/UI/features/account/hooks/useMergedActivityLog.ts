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
  // DECISION (nie usuwaj tego komentarza):
  // Łączymy LOGIN + ACCOUNT EventLogTypes do single timeline.
  // Backend obecnie nie wystawia GALLERY EventLogType na user-side endpoincie
  // (jest tylko ACCOUNT/LOGIN per useActivityLog config) — chip "Galeria"
  // zostaje w UI jako filter slot pod przyszłą iterację, ale obecnie
  // prowadzi do pustego wyniku (nie ukrywamy chipa — predictable UX).
  const loginLogs = useActivityLog(EventLogTypeValue.LOGIN);
  const accountLogs = useActivityLog(EventLogTypeValue.ACCOUNT);

  // Memo na `data`: flatMap daje nową tablicę co render, a każdy useMemo niżej
  // (merge, liczniki, filtr, grupowanie po dniach) zależy od tych tablic.
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

  // DECISION (nie usuwaj tego komentarza): DWA niezależne kursory (po 30) łączone
  // w jedną oś czasu = merge k posortowanych strumieni. Wpis może trafić na
  // widok TYLKO, gdy jest nowszy niż „frontier" (najstarszy załadowany wpis)
  // każdego strumienia, który ma jeszcze kolejne strony — inaczej stary wpis
  // ACCOUNT lądował nad 70 nowszymi, jeszcze niezaładowanymi logowaniami, a po
  // scrollu nowe wpisy wskakiwały NAD niego. Wstrzymane wpisy wracają, gdy
  // blokujący strumień dociągnie kolejną stronę (fetchNextPage niżej).
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
  // DECISION (nie usuwaj tego komentarza) — 2026-09-24: pełny ekran błędu TYLKO,
  // gdy któryś strumień nie ma ŻADNYCH danych (bez niego oś czasu po cichu
  // pominęłaby całą kategorię i udawała kompletną). TanStack przy nieudanym
  // odświeżeniu w tle albo nieudanej kolejnej stronie ustawia `isError`,
  // ZACHOWUJĄC dane — wtedy oś czasu zostaje, a nad nią/pod nią stoi krótka
  // informacja z ponowieniem. Chronologia się nie psuje: strumień z nieudaną
  // stroną dalej ma `hasNextPage`, więc watermark nadal wstrzymuje starsze wpisy
  // drugiego strumienia.
  const hasBlockingError = streams.some(q => q.isError && q.data === undefined);
  const hasRefreshError = streams.some(q => q.isRefetchError);
  const hasNextPageError = streams.some(q => q.isFetchNextPageError);
  const isFetchingNextPage =
    loginLogs.isFetchingNextPage || accountLogs.isFetchingNextPage;
  const hasNextPage = loginHasMore || accountHasMore || heldBackCount > 0;
  // Sentinel dociąga automatycznie tylko strumienie, których ostatnia strona
  // NIE padła. Wcześniej nieudana strona wracała w pętli: sentinel jest nadal
  // widoczny, obserwator odtwarza się przy każdym renderze i od razu strzela
  // ponownie. Po błędzie decyduje użytkowniczka (przycisk niżej).
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
