// UI/features/admin/hooks/useAdminLogsPage.ts
// State and data of the admin logs page: URL state, the two queries (stream,
// groups), cursor paging and the verbose switch. The page
// only renders what this returns.

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LOG_STREAM_DEFAULT_TAKE } from '@kernel/domain/admin/log-triage.config';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { adminTickDebugSwitch_IO } from '../../../../domain/admin/health/adminHealthIO.possibilities.api';
import { useUrlSyncedState } from '../../../shared/hooks/useUrlSyncedState';
import { useAdminLogs } from './useAdminLogs';
import { useAdminLogGroups } from './useAdminLogGroups';
import { useAdminConfig } from './useAdminConfig';
import {
  activeQuickFilterIds,
  ADMIN_LOGS_URL_CODEC,
  EMPTY_LOCAL_FILTERS,
  EMPTY_SCOPE,
  filterGroupRows,
  toggleQuickFilter,
  type LogsLocalFilters,
  type LogsScope,
  type LogsViewMode,
  type QuickFilterId,
} from '../logs-filters.model';

export function useAdminLogsPage() {
  const t = useTranslations('admin.logs');
  const [state, setState, isUrlReady] = useUrlSyncedState(ADMIN_LOGS_URL_CODEC);
  const [debouncedSearch, setDebouncedSearch] = useState(state.local.search);
  const [pageIndex, setPageIndex] = useState(0);
  const [cursorStack, setCursorStack] = useState<Array<number | null>>([null]);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(state.local.search), 300);
    return () => clearTimeout(timer);
  }, [state.local.search]);

  const { view, scope, local, logId, attention } = state;
  const filterSignature = JSON.stringify({
    view,
    attention,
    scope,
    dateFrom: local.dateFrom,
    dateTo: local.dateTo,
    hideStartupNoise: local.hideStartupNoise,
    search: debouncedSearch,
  });

  useEffect(() => {
    setPageIndex(0);
    setCursorStack([null]);
  }, [filterSignature]);

  const cursor = cursorStack[pageIndex] ?? null;
  const trimmedSearch = debouncedSearch.trim();
  const streamRequest: LogsScope = {
    ...(scope.environment !== undefined && { environment: scope.environment }),
    ...(scope.application !== undefined && { application: scope.application }),
    ...(scope.type !== undefined && { type: scope.type }),
    ...(trimmedSearch.length > 0 && { search: trimmedSearch }),
    ...(local.dateFrom.length > 0 && { date_from: local.dateFrom }),
    ...(local.dateTo.length > 0 && { date_to: local.dateTo }),
    ...(local.hideStartupNoise && { hide_startup_noise: true }),
    ...(cursor !== null && { cursor }),
    take: LOG_STREAM_DEFAULT_TAKE,
  };
  // DECISION (nie usuwaj tego komentarza): the attention list sends ONLY
  // `attention: true`. The server ignores the dimension filters then, and
  // sending them anyway would split the cache key from the one the dashboard
  // preview uses for the same list.
  const groupsScope = attention
    ? { attention: true }
    : {
        ...(scope.environment !== undefined && {
          environment: scope.environment,
        }),
        ...(scope.application !== undefined && {
          application: scope.application,
        }),
        ...(scope.type !== undefined && { type: scope.type }),
      };

  const stream = useAdminLogs(streamRequest, isUrlReady && view === 'stream');
  const groupsQuery = useAdminLogGroups(
    groupsScope,
    isUrlReady && view === 'groups'
  );
  const {
    configs,
    isLoading: configsLoading,
    refetch: refetchConfigs,
  } = useAdminConfig();

  const verboseOn =
    configs?.find(c => c.key === 'VERBOSE_LOG_MODE')?.value === 'true';
  // The pill sends the TARGET state (the server is a setter since s34): with the
  // config read failed, „off" would be a guess, so the pill stays unknown.
  const verboseUnknown = !configsLoading && configs === undefined;

  const handleToggleVerbose = async () => {
    setToggling(true);
    try {
      await adminTickDebugSwitch_IO({ enabled: !verboseOn });
      await refetchConfigs();
    } catch {
      pushNewSnackbar(t('verboseToggleError'), 'error');
    } finally {
      setToggling(false);
    }
  };

  const now = new Date();

  // The attention list is the server's list as it stands: a local narrowing
  // would make the rows disagree with the count on the badge.
  const filteredGroups = useMemo(
    () =>
      attention
        ? (groupsQuery.groups ?? [])
        : filterGroupRows(groupsQuery.groups ?? [], local),
    [groupsQuery.groups, local, attention]
  );

  const returnedGroups = groupsQuery.groups?.length ?? 0;
  const truncatedInfo =
    groupsQuery.totalGroups > returnedGroups
      ? { shown: returnedGroups, total: groupsQuery.totalGroups }
      : null;

  // Only a failure with NOTHING on screen replaces the list; a failed refresh
  // keeps the last rows and shows the retry above them.
  const showStreamError =
    view === 'stream' && stream.isError && !stream.isLoading;
  const showGroupsError =
    view === 'groups' && groupsQuery.isError && !groupsQuery.isLoading;
  const showError = showStreamError || showGroupsError;
  // An EMPTY last read counts as nothing on screen: under a failed refresh
  // its emptiness is unconfirmed.
  const hasRowsOnScreen =
    view === 'stream'
      ? stream.records !== null && stream.records.length > 0
      : groupsQuery.groups !== null && groupsQuery.groups.length > 0;

  return {
    isUrlReady,
    view,
    scope,
    local,
    logId,
    attention,
    stream,
    groups: {
      rows: filteredGroups,
      /** True once the server answered (the count is a fact, not a default). */
      isKnown: groupsQuery.groups !== null,
      totalGroups: groupsQuery.totalGroups,
      truncatedInfo,
      isLoading: groupsQuery.isLoading,
      isFetching: groupsQuery.isFetching,
      isError: groupsQuery.isError,
      refetch: groupsQuery.refetch,
    },
    showError,
    // Nothing was read: the stats strip and the list would say „0" and „no
    // logs", which is a guess, so they step aside for the error.
    hideResults: showError && !hasRowsOnScreen,
    retry: () =>
      void (view === 'groups' ? groupsQuery.refetch() : stream.refetch()),
    isRetrying: view === 'groups' ? groupsQuery.isFetching : stream.isFetching,
    verbose: {
      on: verboseOn,
      toggling,
      loading: configsLoading,
      unknown: verboseUnknown,
      toggle: () => void handleToggleVerbose(),
    },
    activeQuickFilters: activeQuickFilterIds(scope, local, now),
    // Leaving the attention list is part of choosing another view.
    setView: (next: LogsViewMode) =>
      setState(prev => ({ ...prev, view: next, attention: false })),
    setScope: (next: LogsScope) => setState(prev => ({ ...prev, scope: next })),
    setLocal: (next: LogsLocalFilters) =>
      setState(prev => ({ ...prev, local: next })),
    setAttention: (next: boolean) =>
      setState(prev => ({
        ...prev,
        attention: next,
        ...(next && { view: 'groups' as const }),
      })),
    toggleQuickFilter: (id: QuickFilterId) => {
      const next = toggleQuickFilter(id, scope, local, now);
      setState(prev => ({ ...prev, scope: next.scope, local: next.local }));
    },
    clearFilters: () =>
      setState(prev => ({
        ...prev,
        scope: EMPTY_SCOPE,
        local: EMPTY_LOCAL_FILTERS,
      })),
    openLog: (id: string) => setState(prev => ({ ...prev, logId: id })),
    closeLog: () => setState(prev => ({ ...prev, logId: null })),
    pagination: {
      hasPrev: pageIndex > 0,
      hasNext: stream.nextCursor !== null,
      onPrev: () => setPageIndex(index => Math.max(0, index - 1)),
      onNext: () => {
        const nextCursor = stream.nextCursor;
        if (nextCursor === null) {
          return;
        }
        setCursorStack(stack =>
          stack[pageIndex + 1] === undefined ? [...stack, nextCursor] : stack
        );
        setPageIndex(index => index + 1);
      },
    },
  };
}
