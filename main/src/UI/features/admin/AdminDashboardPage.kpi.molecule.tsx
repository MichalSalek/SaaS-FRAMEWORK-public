// UI/features/admin/AdminDashboardPage.kpi.molecule.tsx
// The dashboard's numbers: one band of shared stat tiles.

import { useTranslations } from 'next-intl';
import { ROUTES_FRONT_APP } from '@kernel/domain/routing/routing.config';
import {
  StatTileBandMolecule,
  StatTileMolecule,
} from '../../components/StatTile/StatTile.molecule';
import type { AdminMetricsResponse } from './hooks/useAdminMetrics';
import styles from './AdminDashboardPage.module.css';

const formatCount = (value: number): string => value.toLocaleString('pl-PL');

interface DashboardKpiBandProps {
  /** `null` = the first read is still on its way: labels stand, values wait. */
  metrics: AdminMetricsResponse | null;
  /** `undefined` = the report is still loading; `null` = it has no answer. */
  mrrEstimate: number | null | undefined;
}

// DECISION (nie usuwaj tego komentarza):
// No trend badge and no sparkline. ADMIN_GET_METRICS returns no period-over-
// period comparison and no historical series, so a „+12%” or a curve would be
// an invented metric drawn like a real one. The placeholder sparkline (a hash
// of the label) and its gate were removed in S126 with the local tile; when
// the backend returns real history, the series goes into the shared tile
// (StatTileMolecule needs a slot for it: reported as a primitive gap), never
// back into a page-local card.
//
// DECISION (nie usuwaj tego komentarza):
// No 7d / 30d / 90d switch. The endpoint returns newThisWeek and newThisMonth
// only (no quarter), so the switch changed ONE tile and its „90d” showed the
// monthly number. Both real values now stand side by side; a period control
// returns when the API has periods to choose from.
//
// A tile is a door only where a list of exactly the counted records exists:
// the users list for the total. Sessions, gallery entries and blocked accounts
// have no list with the same query yet, so those tiles are information.
export function DashboardKpiBandMolecule({
  metrics,
  mrrEstimate,
}: DashboardKpiBandProps) {
  const t = useTranslations('admin.dashboard');
  const loading = metrics === null;
  const users = metrics?.users;

  return (
    <StatTileBandMolecule ariaLabel={t('kpiAriaLabel')}>
      <StatTileMolecule
        label={t('kpiTotalUsers')}
        value={formatCount(users?.total ?? 0)}
        loading={loading}
        href={ROUTES_FRONT_APP.ADMIN_USERS}
      />
      <StatTileMolecule
        label={t('kpiNewThisWeek')}
        value={formatCount(users?.newThisWeek ?? 0)}
        loading={loading}
      />
      <StatTileMolecule
        label={t('kpiNewThisMonth')}
        value={formatCount(users?.newThisMonth ?? 0)}
        loading={loading}
      />
      <StatTileMolecule
        label={t('kpiActiveSessions')}
        value={formatCount(metrics?.sessions.activeSessions ?? 0)}
        loading={loading}
      />
      <StatTileMolecule
        label={t('kpiMrr')}
        // The estimate comes from ADMIN_GET_REPORTS: a failed report is „no
        // value”, never a zero.
        value={
          <span className={styles.nowrap}>
            {mrrEstimate === null || mrrEstimate === undefined
              ? t('kpiNoValue')
              : `${formatCount(mrrEstimate)}\u00a0PLN`}
          </span>
        }
        loading={mrrEstimate === undefined}
      />
      <StatTileMolecule
        label={t('kpiGalleryRecords')}
        value={formatCount(metrics?.gallery.totalRecords ?? 0)}
        loading={loading}
      />
      <StatTileMolecule
        label={t('kpiTrialConversions')}
        value={
          <span className={styles.nowrap}>
            {`${String(metrics?.conversion_funnel.conversion_rate_pct ?? 0)}%`}
          </span>
        }
        loading={loading}
      />
      <StatTileMolecule
        label={t('kpiDisabledAccounts')}
        value={formatCount(users?.disabled ?? 0)}
        loading={loading}
      />
    </StatTileBandMolecule>
  );
}
