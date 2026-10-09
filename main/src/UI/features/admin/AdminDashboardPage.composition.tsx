// UI/features/admin/AdminDashboardPage.composition.tsx
// Admin dashboard: what needs a reaction, the platform's numbers, the newest
// accounts and the state of the services. Read-only.
// The numbers live in .kpi.molecule.tsx, the two panels in .panels.organism.tsx.

import { useTranslations } from 'next-intl';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { useAdminMetrics } from './hooks/useAdminMetrics';
import { useAdminReports } from './hooks/useAdminReports';
import { DashboardKpiBandMolecule } from './AdminDashboardPage.kpi.molecule';
import {
  RecentActivityOrganism,
  SystemStatusMiniOrganism,
} from './AdminDashboardPage.panels.organism';
import { AdminAttentionPanelOrganism } from './components/AdminAttentionPanel.organism';

export function AdminDashboardPageComposition() {
  const t = useTranslations('admin.dashboard');
  const { metrics, isLoading, isFetching, isError, refetch } =
    useAdminMetrics();
  // The MRR estimate lives in ADMIN_GET_REPORTS (revenue.mrr_estimate); the
  // period does not matter for it (a snapshot of the state, not a range).
  const reportsQuery = useAdminReports('month');
  const mrrEstimate = reportsQuery.reports
    ? reportsQuery.reports.revenue.mrr_estimate
    : reportsQuery.isLoading
      ? undefined
      : null;

  // DECISION (nie usuwaj tego komentarza):
  // No global toast for a failed read: the inline error below is the only
  // channel (a read stays silent, CLAUDE.md „Reads stay silent”). An earlier
  // pushNewSnackbar(t('loadError')) was a BUG: the snackbar re-translates its
  // argument through the `events` namespace, where this key does not exist.
  //
  // A failed re-read with metrics in cache keeps the numbers and the list.
  const metricsFailed = isError && !isLoading && metrics === null;

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}>
      {/* „Wymaga reakcji” has its own query (the counters), so it stands above
          the numbers also when those did not load. */}
      <AdminAttentionPanelOrganism />
      {metricsFailed ? (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retry')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      ) : (
        <DashboardKpiBandMolecule metrics={metrics} mrrEstimate={mrrEstimate} />
      )}
      {/* The services are a separate read: they stay when the metrics fail. */}
      {metricsFailed ? (
        <PageColumnsMolecule main={<SystemStatusMiniOrganism />} />
      ) : (
        <PageColumnsMolecule
          main={
            <RecentActivityOrganism
              entries={metrics?.recentRegistrations ?? null}
            />
          }
          aside={<SystemStatusMiniOrganism />}
        />
      )}
    </AdminPageLayoutComposition>
  );
}
