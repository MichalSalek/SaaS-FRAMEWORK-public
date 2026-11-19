// UI/features/admin/AdminHealthPage.services.organism.tsx
// The verdict and the list of services: one panel, the shared DataTable.
// The small parts (service name, status pill, latency) are also used by the
// dashboard's status panel, so both screens draw a service the same way.

import { useTranslations } from 'next-intl';
import {
  CheckCircleIcon,
  WarningIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import type { ServiceStatus } from '@kernel/models/admin/admin.dto';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../components/DataTable/DataTable.organism';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { AdminPanelMolecule } from './components/AdminPanel.molecule';
import {
  serviceLabelKey,
  type HealthVerdict,
  type ServiceCard,
} from './admin-health.model';
import styles from './AdminHealthPage.module.css';

// The service list, the verdict and the display names live in
// admin-health.model.ts (one reading for the health page AND the dashboard).

/* Domain map status -> role token. It stays at the call site, like every such
 * map in the product; the visual recipe lives in StatusPill. */
const STATUS_COLOR: Record<ServiceStatus, string> = {
  healthy: 'var(--color-success)',
  degraded: 'var(--color-warning)',
  down: 'var(--color-error)',
};

function StatusIcon({ status }: { status: ServiceStatus }) {
  if (status === 'healthy') {
    return <CheckCircleIcon size={14} weight='fill' aria-hidden='true' />;
  }
  if (status === 'degraded') {
    return <WarningIcon size={14} weight='fill' aria-hidden='true' />;
  }
  return <XCircleIcon size={14} weight='fill' aria-hidden='true' />;
}

/** The status word of a service or of the whole system. „Degraded” means over
 *  the latency budget of the service CLASS (kernel health.config). */
export function ServiceStatusPillAtom({ status }: { status: ServiceStatus }) {
  const t = useTranslations('admin.health');
  return (
    <StatusPillAtom
      color={STATUS_COLOR[status]}
      icon={<StatusIcon status={status} />}
      label={t(`status.${status}`)}
    />
  );
}

/** Display name of a service: translated when known, as sent otherwise. */
export function ServiceNameAtom({ name }: { name: string }) {
  const t = useTranslations('admin.health');
  const key = serviceLabelKey(name);
  return <>{key === null ? name : t(key)}</>;
}

/** A response time with its unit as one piece; no sample = said in words. */
export function ServiceLatencyAtom({ value }: { value: number | null }) {
  const t = useTranslations('admin.health');
  return (
    <span className={styles.nowrap}>
      {value === null ? t('noMeasurement') : `${String(value)}\u00a0ms`}
    </span>
  );
}

/* ─── Verdict + services ─── */

export function HealthServicesOrganism({
  verdict,
}: {
  /** `null` = the first read is still on its way. */
  verdict: HealthVerdict | null;
}) {
  const t = useTranslations('admin.health');
  const cards = verdict?.cards ?? [];
  const count = (status: ServiceStatus) =>
    cards.filter(card => card.status === status).length;

  const columns: DataTableColumn<ServiceCard>[] = [
    {
      id: 'service',
      header: t('columnService'),
      priority: 'primary',
      cell: card => <ServiceNameAtom name={card.name} />,
    },
    {
      id: 'status',
      header: t('columnStatus'),
      priority: 'secondary',
      cell: card => <ServiceStatusPillAtom status={card.status} />,
    },
    {
      id: 'latency',
      header: t('responseTime'),
      priority: 'meta',
      align: 'end',
      labelInCard: true,
      cell: card => <ServiceLatencyAtom value={card.responseTime} />,
    },
  ];

  // The time of the measurement is said ONCE, under the verdict: every row is
  // from the same snapshot (the old cards repeated it five times). The backend
  // uptime moved to „Wydajność”, where it already stood a second time.
  return (
    <AdminPanelMolecule
      title={
        verdict === null
          ? t('sectionServices')
          : t(`overall.${verdict.overall}`)
      }
      {...(verdict !== null && {
        aside: <ServiceStatusPillAtom status={verdict.overall} />,
        note: (
          <>
            {t('summary', {
              services: cards.length,
              healthy: count('healthy'),
              degraded: count('degraded'),
              down: count('down'),
            })}
            {'. '}
            <span className={styles.nowrap}>
              {t('measuredAt', { time: verdict.measuredAt })}
            </span>
          </>
        ),
      })}>
      <DataTableOrganism
        caption={t('sectionServices')}
        columns={columns}
        rows={cards}
        rowKey={card => card.name}
        state={verdict === null ? 'loading' : 'ready'}
        empty={null}
        skeletonRows={5}
        surface='flush'
      />
    </AdminPanelMolecule>
  );
}
