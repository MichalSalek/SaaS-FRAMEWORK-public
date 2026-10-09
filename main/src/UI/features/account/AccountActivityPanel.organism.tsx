// UI/features/account/AccountActivityPanel.organism.tsx
// Section „Aktywność”: the last sign-in in one line, the category filter and
// the day-grouped log, with loading / error / empty states. NO AppHero, NO
// AppLayout shell: the host already supplies the screen title.
//
// Data: useActivityLog (TQ v5 infinite) for LOGIN + ACCOUNT EventLogTypes.
//
// Sub-files:
//   UserActivityPage.parts.organism.tsx    — the category filter (chips)
//   UserActivityPage.timeline.organism.tsx — day groups, folded repeats, rows
//   UserActivityPage.events.tsx            — TimelineTx + resolveEventVisual
//   UserActivityPage.events-map.tsx        — pure event → VisualSpec table
//   AccountActivityPanel.helpers.ts        — toTime, lastLoginFrom, tx bag
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { UserActivityLogRecord } from '@kernel/models/event-log/event_log.dto';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { InfiniteScrollTriggerComposition } from '../../components/InfiniteScrollTrigger.composition';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { useMergedActivityLog } from './hooks/useMergedActivityLog';
import { buildTimelineTx, lastLoginFrom } from './AccountActivityPanel.helpers';
import {
  ActivityFilterOrganism,
  type ActivityFilter,
  type FilterOption,
} from './UserActivityPage.parts.organism';
import {
  ActivityTimelineOrganism,
  groupByDay,
  type ActivityTimelineLabels,
} from './UserActivityPage.timeline.organism';
import { resolveEventVisual } from './UserActivityPage.events';
import styles from './UserActivityPage.module.css';

/* ============================================================
 *  Panel
 * ============================================================ */

export function AccountActivityPanelOrganism() {
  const t = useTranslations('account.activity');
  const lang = useCurrentLang();

  const log = useMergedActivityLog();
  const {
    allEntries,
    loginEntries,
    hasNextPage,
    canAutoFetch,
    isFetchingNextPage,
    fetchNextPage,
  } = log;

  const [activeFilter, setActiveFilter] = useState<ActivityFilter>('all');

  const tx = useMemo(() => buildTimelineTx(t), [t]);

  const totalCount = allEntries.length;
  const lastLogin = useMemo(
    () => lastLoginFrom(loginEntries, lang),
    [loginEntries, lang]
  );

  // Filter projection.
  const filteredEntries = useMemo<UserActivityLogRecord[]>(() => {
    if (activeFilter === 'all') {
      return allEntries;
    }
    return allEntries.filter(e => {
      const visual = resolveEventVisual(e.event, tx);
      // LOGIN filter → login + security categories
      if (activeFilter === 'LOGIN') {
        return (
          visual.categoryKey === 'login' || visual.categoryKey === 'security'
        );
      }
      if (activeFilter === 'ACCOUNT') {
        return visual.categoryKey === 'account';
      }
      if (activeFilter === 'GALLERY') {
        return visual.categoryKey === 'gallery';
      }
      return true;
    });
  }, [activeFilter, allEntries, tx]);

  const dayGroups = useMemo(
    () => groupByDay(filteredEntries),
    [filteredEntries]
  );

  const filterOptions: readonly FilterOption[] = [
    { id: 'all', label: t('filterAll') },
    { id: 'LOGIN', label: t('filterLogin') },
    { id: 'ACCOUNT', label: t('filterAccount') },
    { id: 'GALLERY', label: t('filterGallery') },
  ];

  /* ── Loading: the final geometry (summary line, filter, one day box) ── */
  if (log.isLoading) {
    return (
      <div className={styles.panelRoot} aria-busy='true'>
        <SkeletonAtom variant='rect' width='70%' height={24} />
        <SkeletonAtom variant='rect' width='100%' height={36} />
        <SkeletonAtom variant='rect' width='40%' height={20} />
        <SkeletonAtom variant='rect' width='100%' height={224} />
      </div>
    );
  }

  /* ── Error (no data to fall back on) ── */
  if (log.hasBlockingError) {
    return (
      <div className={styles.panelRoot}>
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retryCta')}
          onRetry={log.retry}
          isRetrying={log.isRetrying}
        />
      </div>
    );
  }

  const isFiltered = activeFilter !== 'all';
  const timelineLabels: ActivityTimelineLabels = {
    day: (relative, date) =>
      relative === 'today'
        ? t('groupTodayWithDate', { date })
        : t('groupYesterdayWithDate', { date }),
    repeat: (count, firstTime) => t('repeatMeta', { count, time: firstTime }),
  };
  const showEmpty = filteredEntries.length === 0;

  const nextPageErrorNotice = log.hasNextPageError && (
    <div className={styles.inlineNotice} role='status'>
      <span>{t('loadMoreError')}</span>
      <ButtonAtom
        variant='text'
        size='sm'
        disabled={isFetchingNextPage}
        onClick={log.retryNextPage}>
        {t('retryCta')}
      </ButtonAtom>
    </div>
  );

  return (
    <div className={styles.panelRoot}>
      {log.hasRefreshError && (
        <div className={styles.inlineNotice} role='status'>
          <span>{t('refreshError')}</span>
          <ButtonAtom
            variant='text'
            size='sm'
            disabled={log.isRetrying}
            onClick={log.retry}>
            {t('retryCta')}
          </ButtonAtom>
        </div>
      )}

      {/* One fact, stated once. The old three tiles also showed the number of
          LOADED entries and repeated the selected filter. */}
      <p className={styles.summary}>
        {lastLogin !== null
          ? t('lastLoginLine', { date: lastLogin })
          : t('lastLoginNone')}
      </p>

      <ActivityFilterOrganism
        options={filterOptions}
        active={activeFilter}
        onSelect={setActiveFilter}
        ariaLabel={t('filterAriaLabel')}
      />

      {showEmpty ? (
        <>
          <EmptyStateAtom
            icon={<ClockCounterClockwiseIcon size={32} weight='regular' />}
            title={isFiltered ? t('emptyFilterTitle') : t('emptyTitle')}
            titleAs='h2'
            description={isFiltered ? t('emptyFilterBody') : t('emptyBody')}
            lang={lang}
            role='status'
            {...(isFiltered
              ? {
                  action: (
                    <ButtonAtom
                      variant='outlined'
                      size='md'
                      onClick={() => setActiveFilter('all')}>
                      {t('emptyFilterCta')}
                    </ButtonAtom>
                  ),
                }
              : {})}
          />
          {/* Pusty wynik filtra nie może odcinać jedynej drogi do dalszych
              stron (watermark potrafi wstrzymać całą kategorię) — sentinel
              zostaje, dopóki źródła mają kolejne strony. */}
          {hasNextPage && (
            <InfiniteScrollTriggerComposition
              hasNextPage={canAutoFetch}
              isFetchingNextPage={isFetchingNextPage}
              onFetchNextPage={fetchNextPage}
            />
          )}
          {nextPageErrorNotice}
        </>
      ) : (
        <>
          <ActivityTimelineOrganism
            groups={dayGroups}
            tx={tx}
            labels={timelineLabels}
            locale={lang}
          />
          <InfiniteScrollTriggerComposition
            hasNextPage={canAutoFetch}
            isFetchingNextPage={isFetchingNextPage}
            onFetchNextPage={fetchNextPage}
          />
          {nextPageErrorNotice}
          {/* The true total, once, and only when it IS the total. */}
          {!hasNextPage && !isFiltered && (
            <p className={styles.endNote}>
              {t('endOfHistory', { count: totalCount })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
