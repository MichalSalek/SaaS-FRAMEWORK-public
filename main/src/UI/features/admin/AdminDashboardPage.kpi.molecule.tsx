// UI/features/admin/AdminDashboardPage.kpi.molecule.tsx
// The dashboard's numbers: one band of shared stat tiles.

import { useTranslations } from 'next-intl';
import { ROUTES_FRONT_APP } from '@kernel/domain/routing/routing.config';
import {
  ADMIN_NEW_USERS_WINDOW_DAYS,
  adminNewUsersWindowStartDay,
  adminUsersBlockedHref,
  adminUsersRegisteredFromHref,
} from '@kernel/domain/admin/admin-users-url.config';
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
}

// DECISION: no trend badge and no sparkline. ADMIN_GET_METRICS returns no period-over-period
// comparison and no history, so "+12%" or a curve would be an invented metric drawn like a real
// one. When the backend returns real history it goes into the shared StatTileMolecule (which needs
// a slot for it), never into a page-local card.
//
// DECISION: no 7d / 30d / 90d switch. The endpoint returns only newThisWeek and newThisMonth, so a
// switch would label the monthly number "90d". Both real values stand side by side; a period
// control returns when the API has periods to choose from.
//
// DECISION: a tile is a door only where a list of exactly the counted records exists. The users
// list holds four: total, new accounts in 7 and 30 days (`created_from` = the UTC day the counter
// starts from, adminNewUsersWindowStartDay) and blocked accounts (`is_active = false`). Active
// sessions, gallery entries and trial conversion have no admin list, so those tiles stay flat
// information (div, no hover, no arrow), never a link to a list that counts something else.
export function DashboardKpiBandMolecule({ metrics }: DashboardKpiBandProps) {
  const t = useTranslations('admin.dashboard');
  const loading = metrics === null;
  const users = metrics?.users;
  // Read when rendering: the boundary follows the clock like the counter's.
  const now = new Date();

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
        href={adminUsersRegisteredFromHref(
          adminNewUsersWindowStartDay(now, ADMIN_NEW_USERS_WINDOW_DAYS.week)
        )}
      />
      <StatTileMolecule
        label={t('kpiNewThisMonth')}
        value={formatCount(users?.newThisMonth ?? 0)}
        loading={loading}
        href={adminUsersRegisteredFromHref(
          adminNewUsersWindowStartDay(now, ADMIN_NEW_USERS_WINDOW_DAYS.month)
        )}
      />
      <StatTileMolecule
        label={t('kpiActiveSessions')}
        value={formatCount(metrics?.sessions.activeSessions ?? 0)}
        loading={loading}
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
        href={adminUsersBlockedHref()}
      />
    </StatTileBandMolecule>
  );
}
