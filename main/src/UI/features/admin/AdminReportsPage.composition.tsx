// UI/features/admin/AdminReportsPage.composition.tsx
// Admin reports: six chart cards for the chosen period. The period control
// and the CSV export sit in the title band; loading keeps the cards' boxes, a failed first read
// is the shared error state with retry. Zero chart libs.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChartBarIcon, DownloadIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useAdminReports } from './hooks/useAdminReports';
import type { ReportPeriod } from './hooks/useAdminReports';
import { FunnelChartOrganism } from './components/FunnelChart.organism';
import { RetentionChartOrganism } from './components/RetentionChart.organism';
import { UserGrowthChartOrganism } from './components/UserGrowthChart.organism';
import { ChurnRateChartOrganism } from './components/ChurnRateChart.organism';
import { PlanDistributionChartOrganism } from './components/PlanDistributionChart.organism';
import { exportReportsToCSV } from './reports-csv';
import styles from './AdminReportsPage.module.css';

/* ─── Period options ─── */

const PERIODS = [
  { value: 'week', labelKey: 'day7' },
  { value: 'month', labelKey: 'day30' },
  { value: 'quarter', labelKey: 'day90' },
] as const satisfies readonly { value: ReportPeriod; labelKey: string }[];

/* ─── Skeleton (the boxes of the five chart cards) ─── */

const SKELETON_BAR_HEIGHTS = ['30%', '55%', '80%', '45%'];

function ChartsSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
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

  // DECISION: no global toast for a load error; the error state below (ErrorStateMolecule with
  // retry) is the only channel. The snackbar accepts only events.json keys, so an `admin.reports`
  // string leaked as "events.…".

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('eyebrow')}
      title={t('pageTitle')}
      subtitle={t('pageSubtitle')}
      actions={
        <div className={styles.headerActions}>
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
          {/* The file holds the period on screen; while another period loads
              there is nothing of it to export yet. */}
          <ButtonAtom
            size='sm'
            variant='outlined'
            icon={<DownloadIcon size={14} />}
            onClick={() => {
              if (reports !== null && !isLoading) {
                exportReportsToCSV(reports);
              }
            }}
            disabled={reports === null || isLoading}>
            {t('exportCsv')}
          </ButtonAtom>
        </div>
      }>
      {}
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
          {/* DECISION: a product with no account says so ONCE, in one empty state, instead of
              six panels each with their own "no data". The period stays in the title bar. A
              single chart without data says so in its own panel. */}
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
