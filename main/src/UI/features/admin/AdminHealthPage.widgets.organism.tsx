// UI/features/admin/AdminHealthPage.widgets.organism.tsx
// The health page's numbers (two bands of shared stat tiles) and the list of
// the latest errors (the shared DataTable).

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../components/DataTable/DataTable.organism';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import {
  StatTileBandMolecule,
  StatTileMolecule,
} from '../../components/StatTile/StatTile.molecule';
import { formatDateTimePL } from '../../../application/date/date.utils';
import { describeAdminEvent } from './AdminAuditPage.helpers';
import { AdminPanelMolecule } from './components/AdminPanel.molecule';
import { formatUptime, type HealthResponse } from './admin-health.model';
import { SoftBreakTextAtom } from '../../components/SoftBreakText/SoftBreakText.atom';
import styles from './AdminHealthPage.module.css';

const ENVIRONMENT_LABEL_KEY = {
  DEVELOPMENT: 'environmentValue.DEVELOPMENT',
  STAGING: 'environmentValue.STAGING',
  PRODUCTION: 'environmentValue.PRODUCTION',
} as const;

function isKnownEnvironment(
  value: string
): value is keyof typeof ENVIRONMENT_LABEL_KEY {
  return Object.prototype.hasOwnProperty.call(ENVIRONMENT_LABEL_KEY, value);
}

const formatCount = (value: number): string => value.toLocaleString('pl-PL');

/** A number with its unit: one unbreakable piece. */
function withUnit(value: number, unit: string): ReactNode {
  return (
    <span
      className={styles.nowrap}>{`${formatCount(value)}\u00a0${unit}`}</span>
  );
}

/* The numbers stand in the same frame as the lists of this page (AdminPanel);
   the band is flush inside it and its tiles' text starts on the title's edge. */
function TileSection({
  title,
  note,
  children,
}: {
  title: string;
  /** Facts that are words, not numbers (environment, runtime version). */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AdminPanelMolecule title={title} {...(note !== undefined && { note })}>
      <StatTileBandMolecule
        ariaLabel={title}
        surface='flush'
        className={styles.band}>
        {children}
      </StatTileBandMolecule>
    </AdminPanelMolecule>
  );
}

interface HealthProps {
  /** `null` = the first read is still on its way: labels stand, values wait. */
  health: HealthResponse | null;
}

/* ─── Performance and runtime ─── */

// One colour for every value: the old tiles painted a zero green and anything
// above it red (one colour axis, DESIGN.md Style Policy). The states that need
// a reaction are counted in „Wymaga reakcji” on the dashboard and in the menu.
export function HealthPerformanceOrganism({ health }: HealthProps) {
  const t = useTranslations('admin.health');
  const loading = health === null;
  const environment = health?.backend.environment ?? '';
  const knownEnvironment = isKnownEnvironment(environment);

  return (
    <TileSection
      title={t('sectionPerformance')}
      // The environment and the Node version are WORDS, not numbers: one line
      // of text, in the product's language (the raw enum is what logs print,
      // not what a person reads). The line holds its place while loading.
      note={
        health === null
          ? '\u00a0'
          : t('runtimeNote', {
              environment: knownEnvironment
                ? t(ENVIRONMENT_LABEL_KEY[environment])
                : environment,
              node: health.backend.node_version,
            })
      }>
      <StatTileMolecule
        label={t('avgResponseTime')}
        value={withUnit(health?.performance.avg_response_time_ms ?? 0, 'ms')}
        loading={loading}
      />
      <StatTileMolecule
        label={t('totalRequests')}
        value={formatCount(health?.performance.total_requests_tracked ?? 0)}
        loading={loading}
      />
      <StatTileMolecule
        label={t('errorsLastHour')}
        value={formatCount(health?.errors.count_last_hour ?? 0)}
        loading={loading}
      />
      <StatTileMolecule
        label={t('memoryUsage')}
        value={withUnit(health?.backend.memory_usage_mb ?? 0, 'MB')}
        {...(health !== null && {
          hint: t('memoryOf', { total: health.backend.memory_total_mb }),
        })}
        loading={loading}
      />
      <StatTileMolecule
        label={t('uptimeFull')}
        value={
          <span className={styles.nowrap}>
            {formatUptime(health?.backend.uptime_seconds ?? 0)}
          </span>
        }
        loading={loading}
      />
    </TileSection>
  );
}

/* ─── E-mail ─── */

export function HealthEmailOrganism({ health }: HealthProps) {
  const t = useTranslations('admin.health');
  const loading = health === null;
  const oldestDeadLetter = health?.email_stats.dead_letter_oldest_at ?? null;

  return (
    <TileSection title={t('sectionEmail')}>
      <StatTileMolecule
        label={t('emailSentToday')}
        value={formatCount(health?.email_stats.sent_today ?? 0)}
        loading={loading}
      />
      <StatTileMolecule
        label={t('emailSentWeek')}
        value={formatCount(health?.email_stats.sent_this_week ?? 0)}
        loading={loading}
      />
      <StatTileMolecule
        label={t('emailFailedToday')}
        value={formatCount(health?.email_stats.failed_today ?? 0)}
        loading={loading}
      />
      <StatTileMolecule
        label={t('emailDeadLetter')}
        value={formatCount(health?.email_stats.dead_letter_unresolved ?? 0)}
        // The age of the oldest one used to hide in a `title` tooltip, which a
        // phone never shows.
        {...(oldestDeadLetter !== null && {
          hint: t('emailDeadLetterOldest', {
            date: formatDateTimePL(oldestDeadLetter),
          }),
        })}
        loading={loading}
      />
    </TileSection>
  );
}

/* ─── Latest errors ─── */

type RecentError = HealthResponse['errors']['recent'][number];

const ERROR_ROWS = 5;

function payloadMessage(error: RecentError): string | null {
  const payload = error.event_payload;
  return payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    typeof payload.message === 'string'
    ? payload.message
    : null;
}

export function RecentErrorsPanelOrganism({ health }: HealthProps) {
  const t = useTranslations('admin.health');
  const rows = (health?.errors.recent ?? []).slice(0, ERROR_ROWS);

  const readableError = (error: RecentError): string =>
    payloadMessage(error) ??
    (error.event === 'AI_CRAWLER_TRACK'
      ? t('events.AI_CRAWLER_TRACK')
      : describeAdminEvent(error.event)) ??
    error.event;

  const columns: DataTableColumn<RecentError>[] = [
    {
      id: 'message',
      header: t('columnError'),
      priority: 'primary',
      cell: error => readableError(error),
    },
    {
      id: 'event',
      header: t('columnEvent'),
      priority: 'secondary',
      // An error with no readable name already leads with its key: the key
      // is not said a second time under it.
      cell: error =>
        readableError(error) === error.event ? null : (
          <code className={styles.code}>
            <SoftBreakTextAtom>{error.event}</SoftBreakTextAtom>
          </code>
        ),
    },
    {
      id: 'time',
      header: t('columnTime'),
      priority: 'meta',
      align: 'end',
      // Date AND time: the list reaches back days, and a bare clock time made
      // yesterday's error look like today's.
      cell: error => (
        <time dateTime={error.created_at} className={styles.nowrap}>
          {formatDateTimePL(error.created_at)}
        </time>
      ),
    },
  ];

  return (
    <AdminPanelMolecule title={t('sectionErrors')}>
      <DataTableOrganism
        caption={t('sectionErrors')}
        columns={columns}
        rows={rows}
        rowKey={error => error.event_log_id}
        state={
          health === null ? 'loading' : rows.length === 0 ? 'empty' : 'ready'
        }
        empty={
          <EmptyStateAtom
            title={t('noErrors')}
            titleAs='p'
            description={t('noErrorsHint')}
          />
        }
        skeletonRows={ERROR_ROWS}
        surface='flush'
      />
    </AdminPanelMolecule>
  );
}
