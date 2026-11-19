// UI/features/admin/AdminAiCrawlersPage/AdminAiCrawlersPage.composition.tsx
// Admin AI crawler analytics: the figures of the last 30 days, their
// breakdowns, and the raw event list they lead to.
// Stack: TQ v5 + CSS Modules. Zero chart libs (CSS bars).

import { useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { AdminPageLayoutComposition } from '../../../layouts/AdminPageLayout.composition';
import { AdminPanelMolecule } from '../components/AdminPanel.molecule';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { useAiCrawlerStats } from '../hooks/useAiCrawlerStats';
import { useAiCrawlerList } from '../hooks/useAiCrawlerList';
import type { AiCrawlerListRequest } from '../hooks/useAiCrawlerList';
import {
  AdminAiCrawlersDashboardOrganism,
  type CrawlerDoor,
} from './components/AdminAiCrawlersDashboard.organism';
import { AdminAiCrawlersDailyChartOrganism } from './components/AdminAiCrawlersDailyChart.organism';
import { AdminAiCrawlersTopBotsOrganism } from './components/AdminAiCrawlersTopBots.organism';
import { AdminAiCrawlersByPathOrganism } from './components/AdminAiCrawlersByPath.organism';
import { AdminAiCrawlersByCategoryOrganism } from './components/AdminAiCrawlersByCategory.organism';
import { AdminAiCrawlersListOrganism } from './components/AdminAiCrawlersList.organism';
import { useAiCrawlerUrlState } from './useAiCrawlerUrlState';
import { crawlerFilterOptions } from './crawler-filter-options';
import {
  countCrawlerFilters,
  crawlerDoorParams,
  isCrawlerDoorOpen,
  type CrawlerFilterKey,
} from './crawler-stats-window';
import styles from './AdminAiCrawlersPage.module.css';

type DoorDimension = Partial<
  Pick<AiCrawlerListRequest, 'bot_category' | 'bot_name' | 'path'>
>;

/**
 * DECISION: filters are URL-synced to keep deep links and back/forward navigation. The shared
 * useUrlSyncedState owns hydration and tracks own asynchronous writes; the local codec preserves
 * unrelated query parameters.
 *
 * DECISION: a count opens the records it counts: a tile or breakdown row narrows the event list to
 * the stats window plus one dimension. The boundary is not exact: stats count a rolling 30x24 h
 * while the list filters from the start of the day, so the list can show up to a day more. Aligning
 * them needs the backend.
 */
export function AdminAiCrawlersPageComposition() {
  const t = useTranslations('admin.aiCrawlers');
  const listRef = useRef<HTMLDivElement>(null);
  // One „now” per visit: the doors and their pressed state agree with each
  // other for as long as the page is open.
  const now = useMemo(() => new Date(), []);

  const {
    stats,
    isLoading: statsLoading,
    isError: statsError,
    isFetching: statsFetching,
    refetch: refetchStats,
  } = useAiCrawlerStats();

  const [listParams, setListParams] = useAiCrawlerUrlState();

  const {
    data: listData,
    isLoading: listLoading,
    isError: listError,
    isFetching: listFetching,
    refetch: refetchList,
  } = useAiCrawlerList(listParams);

  const setPage = useCallback(
    (page: number) => setListParams(prev => ({ ...prev, page })),
    [setListParams]
  );

  const setPageSize = useCallback(
    (page_size: number) =>
      setListParams(prev => ({ ...prev, page_size, page: 1 })),
    [setListParams]
  );

  const setFilter = useCallback(
    (key: CrawlerFilterKey, value: string | null) =>
      setListParams(prev => ({
        ...prev,
        [key]: value && value.length > 0 ? value : null,
        page: 1,
      })),
    [setListParams]
  );

  // Clearing filters keeps the page size: it is a view setting, not a filter.
  const resetFilters = useCallback(
    () => setListParams(prev => ({ page: 1, page_size: prev.page_size })),
    [setListParams]
  );

  /** Narrow the list to what a statistic counts and bring it into view. */
  const openDoor = useCallback(
    (dimension: DoorDimension) => {
      setListParams(prev => crawlerDoorParams(prev, now, dimension));
      listRef.current?.scrollIntoView({ block: 'start' });
    },
    [setListParams, now]
  );

  /** A tile is a toggle: pressed again, it lets the list go. */
  const toggleDoor = useCallback(
    (dimension: DoorDimension) => {
      if (isCrawlerDoorOpen(listParams, now, dimension)) {
        resetFilters();
        return;
      }
      openDoor(dimension);
    },
    [listParams, now, openDoor, resetFilters]
  );

  const topBotName = stats?.crawls_by_bot[0]?.bot_name;
  const topPath = stats?.crawls_by_path[0]?.path;
  const pressedDoor: CrawlerDoor = isCrawlerDoorOpen(listParams, now, {})
    ? 'all'
    : topBotName !== undefined &&
        isCrawlerDoorOpen(listParams, now, { bot_name: topBotName })
      ? 'topBot'
      : topPath !== undefined &&
          isCrawlerDoorOpen(listParams, now, { path: topPath })
        ? 'topPath'
        : null;

  const botNameOptions = useMemo(
    () =>
      crawlerFilterOptions(
        stats?.crawls_by_bot.map(b => b.bot_name) ?? [],
        listParams.bot_name
      ),
    [stats, listParams.bot_name]
  );

  const pathOptions = useMemo(
    () =>
      crawlerFilterOptions(
        stats?.crawls_by_path.map(p => p.path) ?? [],
        listParams.path
      ),
    [stats, listParams.path]
  );

  const categoryOptions = useMemo(
    () =>
      crawlerFilterOptions(
        stats?.crawls_by_category.map(c => c.bot_category) ?? [],
        listParams.bot_category
      ),
    [stats, listParams.bot_category]
  );

  const statsReadError = {
    message: t('error.title'),
    retryLabel: t('error.retry'),
    onRetry: () => void refetchStats(),
    isRetrying: statsFetching,
  };
  const listReadError = {
    message: t('error.title'),
    retryLabel: t('error.retry'),
    onRetry: () => void refetchList(),
    isRetrying: listFetching,
  };

  // Nothing in the window: four tiles of zeros and four panels of „Brak …”
  // would say one thing eight times. The overview steps aside and the list
  // below says it once (its empty state), with its filters still on screen.
  const windowIsEmpty = stats !== null && stats.total_crawls === 0;
  const listHasRows = (listData?.items.length ?? 0) > 0;

  return (
    <AdminPageLayoutComposition
      documentTitle={t('title')}
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}>
      {/* A failed read stands where the figures would; a failed refresh keeps
          the last figures under it. */}
      {statsError && <ErrorStateMolecule {...statsReadError} />}

      {(statsError && stats === null) || windowIsEmpty ? null : (
        <>
          <AdminAiCrawlersDashboardOrganism
            stats={stats}
            isLoading={statsLoading}
            openDoor={pressedDoor}
            onToggleAll={() => toggleDoor({})}
            onToggleBot={bot_name => toggleDoor({ bot_name })}
            onTogglePath={path => toggleDoor({ path })}
          />
          <AdminAiCrawlersDailyChartOrganism
            data={stats?.crawls_by_day ?? []}
            isLoading={statsLoading}
          />
          <div className={styles.grid3}>
            <AdminAiCrawlersTopBotsOrganism
              data={stats?.crawls_by_bot ?? []}
              isLoading={statsLoading}
              onOpen={bot_name => openDoor({ bot_name })}
            />
            <AdminAiCrawlersByPathOrganism
              data={stats?.crawls_by_path ?? []}
              isLoading={statsLoading}
              onOpen={path => openDoor({ path })}
            />
            <AdminAiCrawlersByCategoryOrganism
              data={stats?.crawls_by_category ?? []}
              isLoading={statsLoading}
              onOpen={bot_category => openDoor({ bot_category })}
            />
          </div>
        </>
      )}

      <div ref={listRef} className={styles.listAnchor}>
        <AdminPanelMolecule
          title={t('list.title')}
          {...(listData !== null &&
            listData.total > 0 && {
              aside: t('list.summary', { count: listData.total }),
            })}
          {...(windowIsEmpty &&
            listHasRows &&
            countCrawlerFilters(listParams) === 0 && {
              note: t('olderNote'),
            })}>
          {listError && listHasRows && (
            <ErrorStateMolecule {...listReadError} size='inline' />
          )}
          <AdminAiCrawlersListOrganism
            response={listData}
            params={listParams}
            isLoading={listLoading}
            isFetching={listFetching}
            isError={listError}
            error={listReadError}
            categoryOptions={categoryOptions}
            botNameOptions={botNameOptions}
            pathOptions={pathOptions}
            onFilter={setFilter}
            onPage={setPage}
            onPageSize={setPageSize}
            onReset={resetFilters}
          />
        </AdminPanelMolecule>
      </div>
    </AdminPageLayoutComposition>
  );
}
