// UI/features/admin/AdminReportsPage.composition.tsx
// Admin reports: six chart cards for the chosen period. The period control
// sits in the title band; loading keeps the cards' boxes, a failed first read
// is the shared error state with retry. Zero chart libs.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChartBarIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useAdminReports } from './hooks/useAdminReports';
import type { ReportPeriod } from './hooks/useAdminReports';
import { FunnelChartOrganism } from './components/FunnelChart.organism';
import { RetentionChartOrganism } from './components/RetentionChart.organism';
import { RevenueChartOrganism } from './components/RevenueChart.organism';
import { UserGrowthChartOrganism } from './components/UserGrowthChart.organism';
import { ChurnRateChartOrganism } from './components/ChurnRateChart.organism';
import { PlanDistributionChartOrganism } from './components/PlanDistributionChart.organism';
import styles from './AdminReportsPage.module.css';

/* ─── Period options ─── */

const PERIODS: { value: ReportPeriod; labelKey: string }[] = [
  { value: 'week', labelKey: 'day7' },
  { value: 'month', labelKey: 'day30' },
  { value: 'quarter', labelKey: 'day90' },
];

/* ─── Skeleton (the boxes of the six chart cards) ─── */

const SKELETON_BAR_HEIGHTS = ['30%', '55%', '80%', '45%'];

function ChartsSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={styles.skeletonCard} aria-hidden='true'>
          <div className={styles.skeletonHeader}>
            <SkeletonAtom variant='text' width='45%' height={20} />
            <SkeletonAtom variant='text' width='65%' height={16} />
          </div>
          <div className={styles.skeletonBars}>
            {SKELETON_BAR_HEIGHTS.map(height => (
              <SkeletonAtom key={height} height={height} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/* ─── Main feature component ─── */

export function AdminReportsPageComposition() {
  const t = useTranslations('admin.reports');
  const tButtons = useTranslations('buttons');
  const [period, setPeriod] = useState<ReportPeriod>('month');
  const { reports, isLoading, isFetching, isError, refetch } =
    useAdminReports(period);

  // DECISION (nie usuwaj tego komentarza):
  // BRAK globalnego toastu dla błędu ładowania — stan błędu niżej
  // (ErrorStateMolecule z ponowieniem) jest jedynym kanałem błędu. Poprzedni pushNewSnackbar(t('loadError')) był BUGIEM:
  // snackbar re-tłumaczy string przez useTranslations('events'), a klucz z
  // admin.reports nie istnieje w events.json → wyciekał "events.Nie udało
  // się…". Snackbar przyjmuje TYLKO klucze events.json.

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('eyebrow')}
      title={t('pageTitle')}
      subtitle={t('pageSubtitle')}
      actions={
        <div className={styles.periodControl}>
          <span className={styles.periodLabel}>{t('periodLabel')}</span>
          <SegmentedControlMolecule
            semantics='radio'
            size='sm'
            shape='control'
            ariaLabel={t('periodLabel')}
            value={period}
            onChange={setPeriod}
            options={PERIODS.map(option => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
          />
        </div>
      }>
      {/* DECISION (nie usuwaj tego komentarza): on isError `reports` is null,
          so the old `isLoading || !reports` guard fell through to the skeleton
          FOREVER with no retry. The error branch takes priority over the
          skeleton. A failed re-read with charts already in cache keeps the
          charts and puts the retry above them. */}
      {isError && !isLoading && !reports ? (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      ) : (
        <div className={styles.charts}>
          {isError && reports && (
            <ErrorStateMolecule
              message={t('loadError')}
              retryLabel={tButtons('retry')}
              onRetry={() => void refetch()}
              isRetrying={isFetching}
            />
          )}
          {/* DECISION (nie usuwaj tego komentarza) — S126: produkt bez
              żadnego konta mówi to RAZ, jednym stanem pustym, zamiast sześciu
              paneli z własnym „brak danych”. Okres zostaje w pasku tytułu.
              Pojedynczy wykres bez danych mówi to w swoim panelu. */}
          {reports && !isLoading && reports.retention.total_users === 0 ? (
            <EmptyStateAtom
              icon={<ChartBarIcon size={24} weight='regular' />}
              title={t('emptyTitle')}
              titleAs='h2'
              description={t('emptyText')}
            />
          ) : (
            <div className={styles.chartsGrid}>
              {isLoading || !reports ? (
                <ChartsSkeleton />
              ) : (
                <>
                  <FunnelChartOrganism
                    funnel={reports.funnel}
                    growth={reports.growth}
                  />
                  <RetentionChartOrganism retention={reports.retention} />
                  <RevenueChartOrganism revenue={reports.revenue} />
                  <UserGrowthChartOrganism growth={reports.growth} />
                  <ChurnRateChartOrganism churn={reports.churn} />
                  <PlanDistributionChartOrganism revenue={reports.revenue} />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </AdminPageLayoutComposition>
  );
}
