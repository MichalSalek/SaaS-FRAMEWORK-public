// UI/features/admin/AdminLogsStream.organism.tsx
// Stream of single occurrences (AppLogRecord rows) on the shared table: from 768px of its own width
// a table, narrower a card per entry. The message stands first and is never cut; a row opens the
// entry details.

import { useTranslations } from 'next-intl';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type LogRow = ADMIN_DTO_API_V1['GET_LOGS']['RESPONSE']['records'][number];
import { formatTimestampPL } from '../../../application/date/date.utils';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../components/DataTable/DataTable.organism';
import { PaginationMolecule } from '../../components/Pagination/Pagination.molecule';
import {
  LogMessageMolecule,
  LogNamespaceMolecule,
  TypeBadgeMolecule,
} from './AdminLogsPage.parts.molecule';
import styles from './AdminLogsPage.module.css';
import { logApplicationLabel, logEnvironmentLabel } from './log-origin.labels';

const logOriginLabel = (
  application: string,
  environment: string,
  t: ReturnType<typeof useTranslations<'admin.logs'>>
): string =>
  `${logApplicationLabel(application, t)}, ${logEnvironmentLabel(environment, t)}`;

export function AdminLogsStreamOrganism({
  rows,
  isLoading,
  isFetching,
  onOpenLog,
  pagination,
}: {
  rows: readonly LogRow[];
  isLoading: boolean;
  /** A page is on its way: the pager waits. */
  isFetching: boolean;
  onOpenLog: (id: string) => void;
  pagination: {
    hasPrev: boolean;
    hasNext: boolean;
    onPrev: () => void;
    onNext: () => void;
  };
}) {
  const t = useTranslations('admin.logs');

  // DECISION: the list carries no one-line payload preview cut with an ellipsis. The full payload
  // is one tap away (the row opens the details), and a truncated code line on a phone card took a
  // line without being readable.
  const columns: DataTableColumn<LogRow>[] = [
    {
      id: 'message',
      header: t('columnMessage'),
      priority: 'primary',
      width: 'minmax(0, 2fr)',
      cell: log => <LogMessageMolecule text={log.message} />,
    },
    {
      id: 'namespace',
      header: t('columnNamespace'),
      priority: 'secondary',
      cell: log => <LogNamespaceMolecule value={log.namespace} />,
    },
    {
      // `client_url` has carried a real endpoint (METHOD /path) since 2026-08, or the marker `system` for
      // logs outside request handling.
      id: 'source',
      header: t('columnSource'),
      priority: 'secondary',
      cell: log => (
        <>
          {log.client_url}
          <span className={styles.cellQuiet}>
            {logOriginLabel(log.application, log.environment, t)}
          </span>
        </>
      ),
    },
    {
      id: 'type',
      header: t('columnType'),
      priority: 'meta',
      // Fits the longest type pill (icon + „ostrzeżenie” / „Information”).
      width: '9rem',
      cell: log => <TypeBadgeMolecule type={log.type} />,
    },
    {
      id: 'time',
      header: t('columnTimestamp'),
      priority: 'meta',
      width: '9.5rem',
      cell: log => (
        <span className={styles.nowrap}>
          {formatTimestampPL(log.created_at)}
        </span>
      ),
    },
  ];

  return (
    <DataTableOrganism
      caption={t('title')}
      columns={columns}
      rows={rows}
      rowKey={log => log.id}
      rowLabel={() => t('openLogAria')}
      onRowClick={log => onOpenLog(log.id)}
      state={isLoading ? 'loading' : rows.length === 0 ? 'empty' : 'ready'}
      empty={t('noLogs')}
      footer={
        <PaginationMolecule
          mode='cursor'
          ariaLabel={t('paginationAriaLabel')}
          prevLabel={t('paginationPrev')}
          nextLabel={t('paginationNext')}
          isBusy={isFetching}
          {...pagination}
        />
      }
    />
  );
}
