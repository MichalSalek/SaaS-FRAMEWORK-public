// UI/features/admin/AdminLogsStream.organism.tsx
// Strumień pojedynczych wystąpień (rekordy AppLogRecord) na wspólnej tabeli:
// od 768px własnej szerokości tabela, węziej karta na wpis. Wiadomość stoi
// pierwsza i nigdy nie jest ucinana; wiersz otwiera szczegóły wpisu.

import { useTranslations } from 'next-intl';
import type { EventLogRecordFromDB } from '@kernel/models/admin/admin.dto';
import {
  LOG_APPLICATIONS,
  LOG_ENVIRONMENTS,
} from '@kernel/domain/admin/log-triage.config';
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

// `application` and `environment` are plain text columns: a historic row may
// carry a value outside today's lists, shown as stored rather than as a key.
const logOriginLabel = (
  application: string,
  environment: string,
  t: (key: string) => string
): string => {
  const layer = (LOG_APPLICATIONS as readonly string[]).includes(application)
    ? t(`application_${application}`)
    : application;
  const env = (LOG_ENVIRONMENTS as readonly string[]).includes(environment)
    ? t(`environment_${environment}`)
    : environment;
  return `${layer}, ${env}`;
};

export function AdminLogsStreamOrganism({
  rows,
  isLoading,
  isFetching,
  onOpenLog,
  pagination,
}: {
  rows: readonly EventLogRecordFromDB[];
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

  // DECISION (nie usuwaj tego komentarza) — S126: lista nie niesie już
  // jednolinijkowego podglądu payloadu uciętego wielokropkiem. Pełny payload
  // jest o jedno dotknięcie dalej (wiersz otwiera szczegóły), a ucięty kod w
  // karcie na telefonie zajmował linię i nie dawał się przeczytać.
  const columns: DataTableColumn<EventLogRecordFromDB>[] = [
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
      // `client_url` niesie od 2026-08 realny endpoint (METHOD /ścieżka) albo
      // marker `system` dla logów spoza obsługi żądania.
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
