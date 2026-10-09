// UI/features/admin/AdminDashboardPage.panels.organism.tsx
// The dashboard's two lists of records: the newest accounts and the services.
// Both are the shared DataTable inside one white box with a title row.

import { useTranslations } from 'next-intl';
import { ROUTES_FRONT_APP } from '@kernel/domain/routing/routing.config';
import { adminUserHref } from '@kernel/domain/admin/admin-users-url.config';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../components/DataTable/DataTable.organism';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { AdminPanelMolecule } from './components/AdminPanel.molecule';
import { formatDateTimePL } from '../../../application/date/date.utils';
import { useAdminHealth } from './hooks/useAdminHealth';
import { readHealthVerdict, type ServiceCard } from './admin-health.model';
import {
  ServiceLatencyAtom,
  ServiceNameAtom,
  ServiceStatusPillAtom,
} from './AdminHealthPage.services.organism';
import type { AdminMetricsResponse } from './hooks/useAdminMetrics';
import { SoftBreakTextAtom } from '../../components/SoftBreakText/SoftBreakText.atom';
import styles from './AdminDashboardPage.module.css';

/* ─── Newest accounts ─── */

type Registration = AdminMetricsResponse['recentRegistrations'][number];

const ACTIVITY_ROWS = 5;

/** A name is shown only when it says more than the e-mail does. */
function readableName(entry: Registration): string | null {
  const name = entry.name.trim();
  const email = entry.email.trim();
  return name.length > 0 && name.toLowerCase() !== email.toLowerCase()
    ? name
    : null;
}

export function RecentActivityOrganism({
  entries,
}: {
  /** `null` = the metrics are still loading. */
  entries: readonly Registration[] | null;
}) {
  const t = useTranslations('admin.dashboard');
  const rows = (entries ?? []).slice(0, ACTIVITY_ROWS);

  // The row is about a person: her name when she gave one, her e-mail
  // otherwise (five rows of „Bez nazwy” told nobody apart).
  const columns: DataTableColumn<Registration>[] = [
    {
      id: 'who',
      header: t('activityColumnWho'),
      priority: 'primary',
      cell: entry =>
        readableName(entry) ?? (
          <SoftBreakTextAtom>{entry.email.trim()}</SoftBreakTextAtom>
        ),
    },
    {
      id: 'email',
      header: t('activityColumnEmail'),
      priority: 'secondary',
      // A row without a name already leads with the e-mail: saying „Bez nazwy”
      // under it on every such row was noise, so the line stays empty.
      cell: entry =>
        readableName(entry) === null ? null : (
          <SoftBreakTextAtom>{entry.email.trim()}</SoftBreakTextAtom>
        ),
    },
    {
      id: 'created',
      header: t('activityColumnCreated'),
      priority: 'meta',
      align: 'end',
      width: 'max-content',
      cell: entry => (
        <time dateTime={entry.created_at} className={styles.nowrap}>
          {formatDateTimePL(entry.created_at)}
        </time>
      ),
    },
  ];

  return (
    <AdminPanelMolecule title={t('activityTitle')} aside={t('activityHint')}>
      <DataTableOrganism
        caption={t('activityTitle')}
        columns={columns}
        rows={rows}
        rowKey={entry => entry.id}
        rowHref={entry =>
          adminUserHref({ search: entry.email.trim(), userId: entry.id })
        }
        rowLabel={entry =>
          t('activityOpenUser', {
            name: readableName(entry) ?? entry.email.trim(),
          })
        }
        state={
          entries === null ? 'loading' : rows.length === 0 ? 'empty' : 'ready'
        }
        empty={
          <EmptyStateAtom
            title={t('activityEmpty')}
            titleAs='p'
            description={t('activityEmptyHint')}
          />
        }
        skeletonRows={ACTIVITY_ROWS}
        surface='flush'
      />
    </AdminPanelMolecule>
  );
}

/* ─── Services ─── */

export function SystemStatusMiniOrganism() {
  const t = useTranslations('admin.dashboard');
  const tHealth = useTranslations('admin.health');
  const { health, isLoading, isFetching, isError, refetch } = useAdminHealth();

  // DECISION (nie usuwaj tego komentarza) — S126, census P0: the verdict, the
  // service list, the service names and the status words are the health
  // page's (admin-health.model.ts + `admin.health` copy). This widget used to
  // compute its own and contradicted that page; it also prints the time of
  // the measurement it shows, like the health page does.
  const verdict = health ? readHealthVerdict(health) : null;

  const columns: DataTableColumn<ServiceCard>[] = [
    {
      id: 'service',
      header: tHealth('columnService'),
      priority: 'primary',
      cell: card => <ServiceNameAtom name={card.name} />,
    },
    {
      id: 'status',
      header: tHealth('columnStatus'),
      priority: 'secondary',
      width: 'max-content',
      cell: card => <ServiceStatusPillAtom status={card.status} />,
    },
    {
      id: 'latency',
      header: tHealth('responseTime'),
      priority: 'meta',
      align: 'end',
      width: 'max-content',
      labelInCard: true,
      cell: card => <ServiceLatencyAtom value={card.responseTime} />,
    },
  ];

  return (
    <AdminPanelMolecule
      title={t('statusTitle')}
      {...(verdict !== null && {
        aside: <ServiceStatusPillAtom status={verdict.overall} />,
      })}
      footer={
        <>
          <span className={styles.nowrap}>
            {verdict !== null
              ? t('statusMeasuredAt', { time: verdict.measuredAt })
              : '\u00a0'}
          </span>
          <LinkButtonAtom
            href={ROUTES_FRONT_APP.ADMIN_HEALTH}
            size='sm'
            variant='outlined'
            direction='forward'>
            {t('statusOpenHealth')}
          </LinkButtonAtom>
        </>
      }>
      <DataTableOrganism
        caption={t('statusTitle')}
        columns={columns}
        rows={verdict?.cards ?? []}
        rowKey={card => card.name}
        // A failed read is an error with retry, never an endless skeleton; a
        // failed re-read keeps the last measurement (its time is printed).
        state={
          verdict !== null
            ? 'ready'
            : isError && !isLoading
              ? 'error'
              : 'loading'
        }
        error={{
          message: t('statusLoadError'),
          retryLabel: t('retry'),
          onRetry: () => void refetch(),
          isRetrying: isFetching,
        }}
        empty={null}
        skeletonRows={5}
        surface='flush'
      />
    </AdminPanelMolecule>
  );
}
